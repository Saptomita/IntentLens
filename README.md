# IntentLens AI

**"Understand the message before you trust it."**

## Problem Statement

People regularly receive suspicious messages — fake job offers, bank
impersonation texts, prize/lottery scams, and social-engineering
conversations — but often can't tell why a message is risky or what
specifically about it should raise concern. Simple "SCAM / NOT SCAM"
labels don't teach anyone anything and are easy to distrust.

## Target Users

Students and everyday internet users who want to understand *why* a
message might be dangerous, not just whether it is.

## Solution

IntentLens is an AI-powered scam-risk analysis chatbot. A user pastes a
single message or an entire conversation, and Gemini analyzes it for
context, intent, urgency, impersonation, and manipulation tactics. Instead
of a binary verdict, IntentLens returns an explainable risk assessment:
a risk score, risk level, scam category, specific red flags with evidence,
a plain-language explanation, and recommended next steps — plus a
follow-up chatbot to ask more questions about the analysis.

## Key Features

1. **Message Analyzer** — paste a message or conversation and get an
   AI-generated risk assessment.
2. **Risk Dashboard** — risk score (0-100), risk level (LOW/MEDIUM/HIGH),
   scam type, summary, evidence-based red flags with severity, an
   explanation, and recommended actions.
3. **Follow-up Chatbot ("Ask IntentLens")** — ask contextual questions
   about the analyzed message; the chatbot remembers what was analyzed.
4. **Conversation Analysis** — supports multi-message conversations, not
   just single texts, so context across turns is considered.
5. **Demo Examples** — three one-click example messages for fast judging
   demonstrations.
6. **Multilingual support** — Gemini can understand and respond in
   English, Hindi, Bengali, Hinglish, and informal mixed text.

## Technology Stack

- **Frontend:** React + Vite + plain CSS
- **Backend:** Python + FastAPI
- **AI:** Gemini API via the official `google-genai` Python SDK

## How Gemini Is Used

The backend sends the user's message/conversation to Gemini with a
carefully designed system prompt (see `backend/main.py`,
`ANALYSIS_SYSTEM_PROMPT`) that instructs it to:

- Consider full context rather than keyword-matching.
- Identify evidence-based red flags (urgency, money requests, OTP/password
  requests, impersonation, fake job offers, fake prizes, social
  engineering, pressure tactics).
- Avoid claiming certainty — this is a *risk assessment*, not a verdict.
- Return **only** structured JSON matching a strict schema.

For follow-up questions, the backend sends Gemini the original message,
the prior JSON analysis, and the user's new question in a single prompt
(`CHAT_SYSTEM_PROMPT`) so the model stays grounded in what was already
analyzed — this is what gives the chatbot "memory" of the conversation
without needing a database.

The backend also defensively parses Gemini's JSON response
(`extract_json` + `normalize_analysis` in `main.py`) so a malformed
response or an API error never crashes the server or the UI.

## Architecture

```
React (Vite) frontend  --HTTP-->  FastAPI backend  --API-->  Gemini
     (no state on server, no DB, no auth)
```

- The frontend never talks to Gemini directly and never sees the API key.
- The backend is the only component with `GEMINI_API_KEY`.
- No database — the "conversation memory" for the follow-up chatbot is
  just the original message + analysis JSON, sent back to Gemini on every
  question. This keeps the architecture simple and stateless.

## Environment Variables

**Backend** (`backend/.env`, copy from `backend/.env.example`):

```
GEMINI_API_KEY=your_gemini_api_key_here
ALLOWED_ORIGINS=http://localhost:5173,https://your-netlify-site.netlify.app
```

**Frontend** (`frontend/.env`, copy from `frontend/.env.example`):

```
VITE_API_URL=http://localhost:8000
```

⚠️ **Never commit your Gemini API key.** `.env` files are already listed
in `.gitignore`. Only `.env.example` files (with placeholder values) are
committed.

## Local Setup

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env and add your real key
uvicorn main:app --reload
```

The backend runs at `http://localhost:8000`. Check `http://localhost:8000/api/health`.

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env            # defaults to http://localhost:8000
npm run dev
```

The frontend runs at `http://localhost:5173`.

## Deployment

### Backend → Render

1. Push this repo to GitHub.
2. On Render, create a new **Web Service** from the repo, root directory `backend`.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variable `GEMINI_API_KEY` (and optionally `ALLOWED_ORIGINS`
   set to your Netlify URL) in Render's dashboard — never in code.

### Frontend → Netlify

1. On Netlify, create a new site from the same GitHub repo, base directory `frontend`.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Add environment variable `VITE_API_URL` set to your deployed Render backend URL
   (e.g. `https://intentlens-backend.onrender.com`).
5. Once deployed, add the Netlify URL to the backend's `ALLOWED_ORIGINS` on Render.

## Example Use Cases

- A student pastes a "you've won a prize, pay a small fee to claim it"
  message and gets a HIGH risk assessment explaining the upfront-payment
  red flag.
- Someone pastes a multi-turn conversation where a caller claims to be
  from their bank and asks for an OTP — IntentLens flags impersonation
  and OTP-harvesting as high-severity red flags.
- A legitimate college club announcement is correctly assessed as LOW risk.

## Limitations

- This is a **risk assessment tool**, not a fraud-detection guarantee — it
  can be wrong in either direction.
- No memory across sessions (no database); each analysis is independent.
- Analysis quality depends on Gemini's output and the text the user
  provides — screenshots or images are not currently supported (no OCR).
- Not a substitute for verifying suspicious contacts through official,
  independently-looked-up channels.

## Future Improvements

- Optional screenshot/image upload with OCR.
- Browser extension for inline analysis of emails/messages.
- Persisted history of past analyses (would require a database).
- Community-reported scam pattern database to enrich context.
