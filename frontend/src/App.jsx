import { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import { api } from "./api";
import "./index.css";

// ── Helpers ───────────────────────────────────────────────────
function generateSessionId() {
  return "sess-" + crypto.randomUUID();
}

function getOrCreateSessionId() {
  let sid = localStorage.getItem("chat_sessionId");
  if (!sid) {
    sid = generateSessionId();
    localStorage.setItem("chat_sessionId", sid);
  }
  return sid;
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "Z");
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMsgTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "Z");
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ════════════════════════════════════════════════════════════════
export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(getOrCreateSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // ── Load sessions list ──────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getSessions();
      setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ── Load conversation when session changes ──────────
  useEffect(() => {
    if (!activeSessionId) return;
    (async () => {
      try {
        const data = await api.getConversation(activeSessionId);
        setMessages(data);
      } catch {
        // Session may not exist yet (no messages sent), that's fine
        setMessages([]);
      }
    })();
  }, [activeSessionId]);

  // ── Auto-scroll ─────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── Auto-resize textarea ────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  // ── New Chat ────────────────────────────────────────
  const handleNewChat = () => {
    const newId = generateSessionId();
    localStorage.setItem("chat_sessionId", newId);
    setActiveSessionId(newId);
    setMessages([]);
    setError(null);
    setSidebarOpen(false);
    // Refresh sessions list after a short delay
    setTimeout(loadSessions, 300);
  };

  // ── Switch session ──────────────────────────────────
  const handleSelectSession = (sid) => {
    localStorage.setItem("chat_sessionId", sid);
    setActiveSessionId(sid);
    setError(null);
    setSidebarOpen(false);
  };

  // ── Delete session ──────────────────────────────────
  const handleDeleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        handleNewChat();
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  // ── Send message ────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setError(null);

    // Optimistic: add user message immediately
    const tempUserMsg = {
      id: Date.now(),
      session_id: activeSessionId,
      role: "user",
      content: text,
      created_at: new Date().toISOString().replace("Z", ""),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const data = await api.chat(activeSessionId, text);

      // Add assistant reply
      const assistantMsg = {
        id: Date.now() + 1,
        session_id: activeSessionId,
        role: "assistant",
        content: data.reply,
        created_at: new Date().toISOString().replace("Z", ""),
        tokensUsed: data.tokensUsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh sessions list
      loadSessions();
    } catch (err) {
      setError(err.message || "Failed to send message");
      // Remove optimistic user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ──────────────────────────────────────────
  return (
    <div className="app">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="logo">✦</div>
            <h1>Support AI</h1>
          </div>
          <button className="new-chat-btn" onClick={handleNewChat}>
            ＋ New Chat
          </button>
        </div>

        <div className="session-list">
          <span className="session-list-label">Sessions</span>
          {sessions.length === 0 ? (
            <div className="empty-sessions">
              <div className="empty-icon">💬</div>
              <p>No sessions yet.<br />Start chatting to begin!</p>
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`session-item ${activeSessionId === s.id ? "active" : ""}`}
                onClick={() => handleSelectSession(s.id)}
              >
                <span className="session-icon">💬</span>
                <div className="session-info">
                  <div className="session-title">
                    {s.id.length > 20 ? s.id.substring(0, 20) + "…" : s.id}
                  </div>
                  <div className="session-time">{formatTime(s.updated_at)}</div>
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  title="Delete session"
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="chat-area">
        {/* Mobile header */}
        <div className="mobile-header">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <span style={{ fontWeight: 600 }}>Support AI</span>
        </div>

        {/* Chat Header */}
        <div className="chat-header">
          <div className="header-dot" />
          <span className="header-title">AI Support Assistant</span>
          <span className="header-subtitle">
            Session: {activeSessionId.substring(0, 12)}…
          </span>
        </div>

        {/* Messages */}
        <div className="messages-container">
          {messages.length === 0 && !loading && (
            <div className="empty-chat">
              <div className="hero-icon">✨</div>
              <h2>How can I help you?</h2>
              <p>
                I'm your AI Support Assistant. Ask me about passwords, refunds,
                subscriptions, billing, and more from our product documentation.
              </p>
              <div className="suggestion-chips">
                {["How do I reset my password?", "What is the refund policy?", "What subscription plans are available?"].map((q) => (
                  <button
                    key={q}
                    className="chip"
                    onClick={() => { setInput(q); }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="avatar">
                {msg.role === "user" ? "U" : "AI"}
              </div>
              <div className="bubble">
                {msg.role === "assistant" ? (
                  <Markdown className="markdown-content">{msg.content}</Markdown>
                ) : (
                  msg.content
                )}
                <span className="msg-time">
                  {formatMsgTime(msg.created_at)}
                  {msg.tokensUsed ? ` · ${msg.tokensUsed} tokens` : ""}
                </span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="typing-indicator">
              <div className="avatar">AI</div>
              <div className="dots">
                <div className="dot" />
                <div className="dot" />
                <div className="dot" />
              </div>
            </div>
          )}

          {error && (
            <div className="error-toast">
              ⚠️ {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about our product…"
              rows={1}
              disabled={loading}
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              title="Send message"
            >
              ➤
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
