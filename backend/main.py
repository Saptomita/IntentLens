"""
IntentLens AI - Backend
------------------------
A FastAPI backend that sends a suspicious message or conversation to Gemini
and returns a structured, explainable scam-risk assessment.

Endpoints:
  GET  /api/health   -> simple health check
  POST /api/analyze  -> analyze a message/conversation for scam risk
  POST /api/chat     -> follow-up chatbot that answers questions about a
                         previously generated analysis
"""

import os
import json
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:5173"
).split(",")

app = FastAPI(title="IntentLens AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The Gemini client is created lazily so the server can still start (and
# report a clear error) even if the API key is missing.
_client = None


def get_client() -> genai.Client:
    global _client
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: GEMINI_API_KEY is not set.",
        )
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


MODEL_NAME = "gemini-3.6-flash"

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    message: str = Field(..., min_length=1)


class RedFlag(BaseModel):
    title: str
    evidence: str
    severity: str


class AnalyzeResponse(BaseModel):
    risk_score: int
    risk_level: str
    scam_type: str
    summary: str
    red_flags: list[RedFlag]
    explanation: str
    recommended_actions: list[str]


class ChatRequest(BaseModel):
    message: str
    analysis: dict
    question: str = Field(..., min_length=1)


class ChatResponse(BaseModel):
    answer: str


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

ANALYSIS_SYSTEM_PROMPT = """You are IntentLens, an AI scam-risk analysis assistant.

Your job is to analyze a message or an entire conversation that a user has
received, and produce an explainable, evidence-based scam-risk assessment.

Rules you MUST follow:
- Do not automatically assume that every suspicious-sounding message is a scam.
- Look at the overall context, not just isolated keywords.
- Identify evidence-based warning signs (urgency, requests for money, requests
  for OTP/passwords/personal information, impersonation of banks or
  institutions, suspicious job offers, fake prizes/rewards, social
  engineering, pressure or manipulation tactics, and other contextual scam
  indicators).
- Do not claim certainty. This is a risk assessment, not a verdict.
- The input may contain multiple speakers/messages (a conversation). Analyze
  it as a whole, considering how the conversation evolves.
- The input may be in English, Hindi, Bengali, Hinglish, or informal mixed
  text. Understand it naturally. Write your summary, explanation, and
  recommended actions in the same language/style the user wrote in, when
  reasonably possible. If mixed, prefer English.
- For each red flag, you MUST quote or closely paraphrase the specific
  evidence from the provided text that supports it.
- Provide practical, safe next steps (e.g. verify through official channels,
  do not share OTP, do not send money) rather than dangerous or vague advice.

Respond with ONLY valid JSON, no markdown code fences, no extra commentary,
matching exactly this schema:

{
  "risk_score": <integer 0-100>,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "scam_type": "<short category name, e.g. Job Scam, Bank Impersonation, Prize Scam, Phishing, Not a Scam, etc.>",
  "summary": "<2-3 sentence plain-language summary>",
  "red_flags": [
    {
      "title": "<short red flag name>",
      "evidence": "<specific quote or paraphrase from the input>",
      "severity": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "explanation": "<a few sentences explaining WHY this is risky or not, in plain language>",
  "recommended_actions": ["<action 1>", "<action 2>", "..."]
}

If the message appears to be legitimate/benign, still return the same JSON
shape, with a low risk_score, risk_level "LOW", scam_type "Not a Scam" (or
similar), an empty or minimal red_flags array, and reassuring but cautious
recommended_actions.
"""

CHAT_SYSTEM_PROMPT = """You are IntentLens, an AI scam-risk analysis assistant.

You already analyzed a message/conversation for a user and produced a
structured risk assessment. The user is now asking a follow-up question
about that analysis. Answer helpfully, specifically, and in context, using
the original message and your prior analysis as grounding. Keep answers
concise (a few sentences) and practical. Do not claim certainty about
whether something is definitely a scam - speak in terms of risk and
evidence. Answer in the same language the user is asking in, when
reasonably possible. Respond in plain text (no JSON, no markdown fences).
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def extract_json(text: str) -> dict:
    """Safely extract a JSON object from Gemini's text response.

    Gemini is instructed to return raw JSON, but this strips markdown code
    fences or any stray text just in case, so the backend never crashes on
    a slightly malformed response.
    """
    cleaned = text.strip()
    cleaned = re.sub(r"^```json\s*", "", cleaned)
    cleaned = re.sub(r"^```\s*", "", cleaned)
    cleaned = re.sub(r"```\s*$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Fallback: try to find the first {...} block in the text
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError("Could not parse a valid JSON object from Gemini's response.")


def normalize_analysis(data: dict) -> dict:
    """Fill in safe defaults and clamp values so the response always
    matches the expected schema, even if Gemini omits a field."""

    risk_score = data.get("risk_score", 0)
    try:
        risk_score = int(risk_score)
    except (TypeError, ValueError):
        risk_score = 0
    risk_score = max(0, min(100, risk_score))

    risk_level = str(data.get("risk_level", "LOW")).upper()
    if risk_level not in ("LOW", "MEDIUM", "HIGH"):
        risk_level = "LOW"

    red_flags_raw = data.get("red_flags", []) or []
    red_flags = []
    for flag in red_flags_raw:
        if not isinstance(flag, dict):
            continue
        severity = str(flag.get("severity", "LOW")).upper()
        if severity not in ("LOW", "MEDIUM", "HIGH"):
            severity = "LOW"
        red_flags.append(
            {
                "title": str(flag.get("title", "Unspecified concern")),
                "evidence": str(flag.get("evidence", "")),
                "severity": severity,
            }
        )

    return {
        "risk_score": risk_score,
        "risk_level": risk_level,
        "scam_type": str(data.get("scam_type", "Unknown")),
        "summary": str(data.get("summary", "")),
        "red_flags": red_flags,
        "explanation": str(data.get("explanation", "")),
        "recommended_actions": [
            str(a) for a in (data.get("recommended_actions", []) or [])
        ],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    client = get_client()

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=f"Analyze the following message or conversation:\n\n{message}",
            config={
                "system_instruction": ANALYSIS_SYSTEM_PROMPT,
                "response_mime_type": "application/json",
                "temperature": 0.3,
            },
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean error to the user
        raise HTTPException(
            status_code=502, detail=f"Gemini API request failed: {exc}"
        ) from exc

    raw_text = response.text or ""
    try:
        parsed = extract_json(raw_text)
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="Gemini returned a response that could not be understood. Please try again.",
        ) from exc

    normalized = normalize_analysis(parsed)
    return normalized


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    client = get_client()

    context = (
        f"Original message/conversation analyzed:\n{request.message}\n\n"
        f"Prior analysis (JSON):\n{json.dumps(request.analysis)}\n\n"
        f"User's follow-up question:\n{question}"
    )

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=context,
            config={
                "system_instruction": CHAT_SYSTEM_PROMPT,
                "temperature": 0.4,
            },
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"Gemini API request failed: {exc}"
        ) from exc

    answer = (response.text or "").strip()
    if not answer:
        answer = "I wasn't able to generate a response. Please try rephrasing your question."

    return {"answer": answer}
