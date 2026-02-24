require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const Groq = require("groq-sdk");
const docs = require("./docs.json");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Rate Limiting (per IP) ─────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again after a minute." },
});
app.use("/api/", apiLimiter);

// ── Groq AI setup ──────────────────────────────────────────────
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// ── Prepared statements ────────────────────────────────────────
const stmts = {
    createSession: db.prepare(
        `INSERT INTO sessions (id) VALUES (?)`
    ),
    getAllSessions: db.prepare(
        `SELECT id, created_at, updated_at FROM sessions ORDER BY updated_at DESC`
    ),
    getSession: db.prepare(
        `SELECT * FROM sessions WHERE id = ?`
    ),
    deleteSession: db.prepare(
        `DELETE FROM sessions WHERE id = ?`
    ),
    updateSessionTime: db.prepare(
        `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
    ),
    getMessages: db.prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
    ),
    // Get last 5 user+assistant pairs (10 messages) for context
    getRecentMessages: db.prepare(
        `SELECT * FROM (
       SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 10
     ) sub ORDER BY id ASC`
    ),
    insertMessage: db.prepare(
        `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`
    ),
};

// ── Build system prompt with docs ──────────────────────────────
function buildSystemPrompt() {
    const docsText = docs
        .map((d) => `### ${d.title}\n${d.content}`)
        .join("\n\n");

    return `You are an AI-powered Support Assistant. You must answer user questions ONLY using the product documentation provided below. Follow these rules strictly:

1. ONLY use the information from the documentation below to answer questions.
2. If the user's question cannot be answered from the documentation, respond EXACTLY with: "Sorry, I don't have information about that."
3. Do NOT hallucinate, guess, or make up answers.
4. Do NOT provide information beyond what is in the documentation.
5. Be concise, helpful, and professional.
6. If the user greets you (e.g., "hi", "hello"), respond politely and briefly mention you can help with product-related questions.

--- PRODUCT DOCUMENTATION ---

${docsText}

--- END OF DOCUMENTATION ---`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ════════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════════

// ── POST /api/chat — Send message and get AI reply ─────────────
app.post("/api/chat", async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        // Validate required fields
        if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
            return res.status(400).json({ error: "sessionId is required" });
        }
        if (!message || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ error: "message is required" });
        }

        const sid = sessionId.trim();
        const userMessage = message.trim();

        // Auto-create session if it doesn't exist
        let session = stmts.getSession.get(sid);
        if (!session) {
            stmts.createSession.run(sid);
            session = stmts.getSession.get(sid);
        }

        // Save user message to DB
        stmts.insertMessage.run(sid, "user", userMessage);
        stmts.updateSessionTime.run(sid);

        // Get last 5 pairs (10 messages) for context from SQLite
        const recentHistory = stmts.getRecentMessages.all(sid);

        let assistantReply = "";
        let tokensUsed = 0;

        if (groq) {
            // Build messages array for LLM
            const llmMessages = [
                { role: "system", content: SYSTEM_PROMPT },
                ...recentHistory.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
            ];

            const completion = await groq.chat.completions.create({
                messages: llmMessages,
                model: "llama-3.3-70b-versatile",
                temperature: 0.3, // Low temp for factual doc-based answers
                max_tokens: 512,
            });

            assistantReply =
                completion.choices[0]?.message?.content ||
                "Sorry, I don't have information about that.";
            tokensUsed = completion.usage?.total_tokens || 0;
        } else {
            // Fallback when no API key
            assistantReply =
                'AI is not configured. Set GROQ_API_KEY in .env to enable AI responses.';
            tokensUsed = 0;
        }

        // Save assistant reply to DB
        stmts.insertMessage.run(sid, "assistant", assistantReply);
        stmts.updateSessionTime.run(sid);

        res.json({
            reply: assistantReply,
            tokensUsed: tokensUsed,
        });
    } catch (err) {
        console.error("Chat error:", err);

        // Handle specific LLM errors
        if (err.status === 401 || err.message?.includes("auth")) {
            return res.status(502).json({ error: "LLM API authentication failed. Check your API key." });
        }
        if (err.status === 429) {
            return res.status(502).json({ error: "LLM API rate limit exceeded. Please try again later." });
        }

        res.status(500).json({ error: "Failed to process chat message" });
    }
});

// ── GET /api/conversations/:sessionId — Get all messages ───────
app.get("/api/conversations/:sessionId", (req, res) => {
    try {
        const sid = req.params.sessionId;
        const session = stmts.getSession.get(sid);
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }
        const messages = stmts.getMessages.all(sid);
        res.json(messages);
    } catch (err) {
        console.error("Get conversations error:", err);
        res.status(500).json({ error: "Failed to retrieve conversation" });
    }
});

// ── GET /api/sessions — List all sessions ──────────────────────
app.get("/api/sessions", (req, res) => {
    try {
        const sessions = stmts.getAllSessions.all();
        res.json(sessions);
    } catch (err) {
        console.error("List sessions error:", err);
        res.status(500).json({ error: "Failed to list sessions" });
    }
});

// ── DELETE /api/sessions/:id — Delete session (extra) ──────────
app.delete("/api/sessions/:id", (req, res) => {
    try {
        const result = stmts.deleteSession.run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ error: "Session not found" });
        }
        res.json({ message: "Session deleted" });
    } catch (err) {
        console.error("Delete session error:", err);
        res.status(500).json({ error: "Failed to delete session" });
    }
});

// ── GET /api/health — Health check ─────────────────────────────
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        ai_enabled: !!groq,
        docs_loaded: docs.length,
    });
});

// ── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🤖 AI: ${groq ? "Groq enabled (llama-3.3-70b)" : "Fallback mode (set GROQ_API_KEY)"}`);
    console.log(`📄 Docs loaded: ${docs.length} articles`);
});
