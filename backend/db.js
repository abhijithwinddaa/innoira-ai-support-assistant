const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "chat.db");

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Create tables ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT     PRIMARY KEY,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id TEXT     NOT NULL,
    role       TEXT     NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT     NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id);
`);

module.exports = db;
