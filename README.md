# 🤖 AI-Powered Support Assistant

A full-stack AI-powered support assistant that answers user questions based on product documentation, maintains session-wise context, and stores all conversations in SQLite.

## 🔗 Live Demo

- **Frontend:** [https://innoiraassignment.netlify.app](https://innoiraassignment.netlify.app)
- **Backend API:** [https://innoira-ai-support-assistant.onrender.com](https://innoira-ai-support-assistant.onrender.com/api/health)

## 🧠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React.js (Vite) |
| Backend | Node.js (Express) |
| Database | SQLite (better-sqlite3) |
| LLM | Groq (Llama 3.3 70B) |

## 📁 Project Structure

```
├── backend/
│   ├── server.js        # Express server with API routes
│   ├── db.js            # SQLite schema & connection
│   ├── docs.json        # Product documentation (knowledge base)
│   ├── test.js          # Unit tests (20 tests)
│   ├── .env             # API keys (gitignored)
│   ├── .env.example     # Environment template
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Chat UI component
│   │   ├── api.js       # API client
│   │   ├── index.css    # Styles
│   │   └── main.jsx     # Entry point
│   └── package.json
└── README.md
```

## 🚀 Setup & Run

### Prerequisites
- Node.js v18+
- npm

### 1. Install Dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure Environment

```bash
# Copy template
cp backend/.env.example backend/.env

# Edit backend/.env and add your Groq API key
GROQ_API_KEY=your_api_key_here
```

Get a free API key at [console.groq.com](https://console.groq.com)

### 3. Run

```bash
# Terminal 1 — Backend (port 3001)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

## 📡 API Documentation

### `POST /api/chat`
Send a message and get an AI response.

**Request:**
```json
{
  "sessionId": "sess-abc123",
  "message": "How can I reset my password?"
}
```

**Response:**
```json
{
  "reply": "Users can reset their password by going to Settings > Security > Reset Password.",
  "tokensUsed": 142
}
```

### `GET /api/conversations/:sessionId`
Fetch all messages for a session in chronological order.

**Response:**
```json
[
  {
    "id": 1,
    "session_id": "sess-abc123",
    "role": "user",
    "content": "How can I reset my password?",
    "created_at": "2024-01-15 10:30:00"
  },
  {
    "id": 2,
    "session_id": "sess-abc123",
    "role": "assistant",
    "content": "Users can reset their password by going to Settings > Security...",
    "created_at": "2024-01-15 10:30:01"
  }
]
```

### `GET /api/sessions`
List all sessions with timestamps.

**Response:**
```json
[
  {
    "id": "sess-abc123",
    "created_at": "2024-01-15 10:00:00",
    "updated_at": "2024-01-15 10:30:01"
  }
]
```

### `DELETE /api/sessions/:id`
Delete a session and all its messages.

### `GET /api/health`
Health check endpoint.

## 🗄️ Database Schema

### `sessions` table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | Primary key (sessionId) |
| created_at | DATETIME | Auto-generated |
| updated_at | DATETIME | Updated on each message |

### `messages` table
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | PK autoincrement |
| session_id | TEXT | FK → sessions (CASCADE delete) |
| role | TEXT | "user" or "assistant" |
| content | TEXT | Message text |
| created_at | DATETIME | Auto-generated |

## 📄 Document-Based Answering

The assistant answers **only** from `backend/docs.json`. This file contains product FAQs covering:

- Password reset, Account deletion
- Refund policy, Subscription plans
- Billing & invoices
- Two-factor authentication
- Data export, API access
- Browser & mobile app support
- File upload limits, Contact support

If a question is outside the documentation scope, the assistant responds:
> "Sorry, I don't have information about that."

## 🧠 Context & Memory

- Last **5 user+assistant message pairs** (10 messages) are sent as context to the LLM
- Context is loaded from **SQLite** on every request (not in-memory)
- Each session maintains independent conversation history

## 🔒 Rate Limiting & Error Handling

- **Rate limiting**: 30 requests/minute per IP via `express-rate-limit`
- **Validation**: Missing `sessionId` or `message` returns `400` error
- **LLM failures**: Auth errors (401) and rate limits (429) return `502` with descriptive message
- **DB failures**: Caught and returned as `500` with clean JSON errors

## 💡 Assumptions

1. Sessions are auto-created on first message (no separate session creation endpoint needed)
2. `sessionId` is generated client-side as UUID and stored in `localStorage`
3. The product documentation in `docs.json` is the single source of truth for AI responses
4. Groq's Llama 3.3 70B model is used for fast inference (OpenAI-compatible API)
5. Temperature is set low (0.3) to ensure factual, documentation-grounded responses

## 🌟 Bonus Features

### Markdown Rendering
Assistant replies are rendered with full markdown support (bold, italics, code blocks, lists, blockquotes, links) using `react-markdown`.

### Unit Tests
20 backend unit tests covering:
- Database schema validation (4 tests)
- Session CRUD operations (3 tests)
- Message CRUD + role constraints (5 tests)
- Context window — last 5 pairs (1 test)
- `docs.json` structure validation (3 tests)
- Input validation (3 tests)

```bash
cd backend
npm test
```
