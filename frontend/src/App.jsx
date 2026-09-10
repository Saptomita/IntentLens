import { useState, useRef, useEffect } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const EXAMPLES = [
  {
    label: "Job scam",
    icon: "💼",
    text:
      "Congratulations! You have been selected for a work-from-home job. Pay ₹999 registration fee immediately to confirm your position.",
  },
  {
    label: "Bank impersonation",
    icon: "🏦",
    text:
      "Your bank account will be suspended today. Send your OTP immediately to verify your account.",
  },
  {
    label: "Legitimate message",
    icon: "✅",
    text:
      "Hi, our college club meeting has been moved to 4 PM tomorrow. Please bring your project presentation.",
  },
];

function riskColor(level) {
  if (level === "HIGH") return "#ef4444";
  if (level === "MEDIUM") return "#f59e0b";
  return "#22c55e";
}

/* SVG radial progress ring */
function ScoreRing({ score, riskLevel }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    // Animate stroke
    const timer = setTimeout(() => {
      const pct = score / 100;
      setOffset(circumference - pct * circumference);
    }, 80);

    // Animate number count-up
    const duration = 800;
    const start = performance.now();
    let raf;
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out quad
      const ease = 1 - (1 - progress) * (1 - progress);
      setDisplayScore(Math.round(ease * score));
      if (progress < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [score, circumference]);

  return (
    <div className="score-ring-container">
      <svg className="score-ring-svg" viewBox="0 0 100 100">
        <circle className="score-ring-bg" cx="50" cy="50" r={radius} />
        <circle
          className="score-ring-fg"
          cx="50"
          cy="50"
          r={radius}
          stroke={riskColor(riskLevel)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="score-ring-text">
        <div className="score-number">{displayScore}</div>
        <div className="score-max">/100</div>
      </div>
    </div>
  );
}

/* Animated checkmark for recommended actions */
function CheckIcon({ delay }) {
  return (
    <span className="action-check">
      <svg viewBox="0 0 16 16">
        <path
          className="action-check-path"
          d="M3 8.5 L6.5 12 L13 4"
          style={{ animationDelay: `${delay}ms` }}
        />
      </svg>
    </span>
  );
}

/* Typing dots component */
function TypingDots() {
  return (
    <div className="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );
}

/* Skeleton / scanning loading state */
function ScanningState() {
  return (
    <div className="scanning-container">
      <div className="scanning-label">
        <span className="status-dot"></span>
        Scanning message for threats…
      </div>
      <div className="skeleton-circle"></div>
      <div className="skeleton-bar" style={{ width: "100%" }}></div>
      <div className="skeleton-bar"></div>
      <div className="skeleton-bar"></div>
      <div className="skeleton-bar"></div>
      <div className="skeleton-bar"></div>
    </div>
  );
}

function App() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzedMessage, setAnalyzedMessage] = useState("");

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Intersection Observer for scroll-triggered fades
  const dashboardRef = useRef(null);
  const chatRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.1 }
    );

    const refs = [dashboardRef.current, chatRef.current];
    refs.forEach((el) => el && observer.observe(el));

    return () => refs.forEach((el) => el && observer.unobserve(el));
  }, [analysis]);

  async function handleAnalyze() {
    setError("");
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Please paste a message or conversation before analyzing.");
      return;
    }

    setLoading(true);
    setAnalysis(null);
    setChatMessages([]);

    try {
      const res = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Something went wrong while analyzing the message.");
      }

      const data = await res.json();
      setAnalysis(data);
      setAnalyzedMessage(trimmed);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Could not reach the server. Please check your connection and try again."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleAskFollowUp(question) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !analysis) return;

    setChatMessages((prev) => [...prev, { role: "user", text: trimmedQuestion }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: analyzedMessage,
          analysis,
          question: trimmedQuestion,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Something went wrong while getting a response.");
      }

      const data = await res.json();
      setChatMessages((prev) => [...prev, { role: "ai", text: data.answer }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            err.message === "Failed to fetch"
              ? "Could not reach the server. Please try again."
              : `Error: ${err.message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const suggestedQuestions = [
    "Why is this suspicious?",
    "Which part is the biggest red flag?",
    "How can I verify this?",
    "What should I do now?",
  ];

  const wordCount = message.trim() ? message.trim().split(/\s+/).length : 0;

  return (
    <div className="page">
      <header className="header">
        <div className="header-inner">
          <div className="logo">IntentLens AI</div>
          <p className="tagline">Understand the message before you trust it.</p>
          <div className="status-indicator">
            <span className="status-dot"></span>
            AI-powered scam detection
          </div>
        </div>
      </header>

      <main className="container">
        <section className="analyzer-card">
          <label className="field-label" htmlFor="message-input">
            Message or Conversation
          </label>
          <div className="textarea-wrapper">
            <textarea
              id="message-input"
              className="message-input"
              placeholder="Paste a suspicious message or conversation here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
            />
            <span className={`char-counter ${message.length > 0 ? "visible" : ""}`}>
              {message.length} chars · {wordCount} words
            </span>
          </div>

          <div className="examples">
            <span className="examples-label">Try an example:</span>
            <div className="examples-buttons">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  className="example-btn"
                  type="button"
                  onClick={() => setMessage(ex.text)}
                >
                  <span>{ex.icon}</span> {ex.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <span>⚠️</span> {error}
            </div>
          )}

          <button
            className="analyze-btn"
            onClick={handleAnalyze}
            disabled={loading}
            type="button"
          >
            {loading ? (
              <>
                <span className="btn-spinner"></span>
                <span className="analyzing-text">Analyzing</span>
              </>
            ) : (
              "Analyze Message"
            )}
          </button>

          <p className="disclaimer">
            IntentLens provides an AI-generated risk assessment. It does not
            guarantee that a message is legitimate or fraudulent. When in
            doubt, verify through official channels.
          </p>
        </section>

        {/* Scanning skeleton while loading */}
        {loading && <ScanningState />}

        {analysis && (
          <section className="dashboard-card observe-fade" ref={dashboardRef}>
            <div className="score-row">
              <ScoreRing score={analysis.risk_score} riskLevel={analysis.risk_level} />
              <div className="score-meta">
                <div
                  className="risk-pill"
                  style={{ backgroundColor: riskColor(analysis.risk_level) }}
                >
                  {analysis.risk_level} RISK
                </div>
                <div className="scam-type">{analysis.scam_type}</div>
              </div>
            </div>

            <div className="section-block">
              <h3>Summary</h3>
              <p>{analysis.summary}</p>
            </div>

            {analysis.red_flags && analysis.red_flags.length > 0 && (
              <div className="section-block">
                <h3>Red Flags</h3>
                <div className="flags-list">
                  {analysis.red_flags.map((flag, idx) => (
                    <div
                      className={`flag-item severity-${flag.severity.toLowerCase()}`}
                      key={idx}
                      style={{ animationDelay: `${idx * 80}ms` }}
                    >
                      <div className="flag-title">
                        🚩 {flag.title}
                        <span
                          className="severity-badge"
                          style={{ backgroundColor: riskColor(flag.severity) }}
                        >
                          {flag.severity}
                        </span>
                      </div>
                      {flag.evidence && (
                        <div className="flag-evidence">
                          Evidence: <em>"{flag.evidence}"</em>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section-block">
              <h3>Why is this suspicious?</h3>
              <p>{analysis.explanation}</p>
            </div>

            {analysis.recommended_actions && analysis.recommended_actions.length > 0 && (
              <div className="section-block">
                <h3>Recommended Actions</h3>
                <ul className="actions-list">
                  {analysis.recommended_actions.map((action, idx) => (
                    <li
                      className="action-item"
                      key={idx}
                      style={{ animationDelay: `${idx * 100}ms` }}
                    >
                      <CheckIcon delay={300 + idx * 100} />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {analysis && (
          <section className="chat-card observe-fade" ref={chatRef}>
            <h3>Ask IntentLens</h3>

            <div className="suggested-questions">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="suggested-btn"
                  onClick={() => handleAskFollowUp(q)}
                  disabled={chatLoading}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="chat-window">
              {chatMessages.length === 0 && (
                <p className="chat-empty">
                  Ask a question about this message, e.g. "How can I verify this?"
                </p>
              )}
              {chatMessages.map((m, idx) => (
                <div key={idx} className={`chat-bubble-row ${m.role}`}>
                  <span
                    className={`chat-avatar ${m.role === "ai" ? "ai-avatar" : "user-avatar"
                      }`}
                  >
                    {m.role === "ai" ? "🛡️" : "🙂"}
                  </span>
                  <div className={`chat-bubble ${m.role}`}>{m.text}</div>
                </div>
              ))}
              {chatLoading && (
                <div className="chat-bubble-row ai">
                  <span className="chat-avatar ai-avatar">🛡️</span>
                  <div className="chat-bubble ai">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              className="chat-input-row"
              onSubmit={(e) => {
                e.preventDefault();
                handleAskFollowUp(chatInput);
              }}
            >
              <input
                type="text"
                className="chat-input"
                placeholder="Ask a follow-up question..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="chat-send-btn"
                disabled={chatLoading || !chatInput.trim()}
              >
                Send
              </button>
            </form>
          </section>
        )}
      </main>

      <footer className="footer">
        Built for ML AlgoRush — IntentLens AI, powered by Gemini.
      </footer>
    </div>
  );
}

export default App;
