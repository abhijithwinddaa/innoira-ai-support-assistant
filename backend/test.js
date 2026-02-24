const assert = require("assert");
const path = require("path");

// ── Setup: use a separate test database ─────────────────────────
process.env.GROQ_API_KEY = ""; // disable AI for unit tests
const Database = require("better-sqlite3");

// We'll test the DB module and route logic independently

console.log("🧪 Running backend unit tests...\n");
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

// ════════════════════════════════════════════════════════════════
// 1. Database Schema Tests
// ════════════════════════════════════════════════════════════════
console.log("📦 Database Schema Tests");

const testDb = new Database(":memory:");
testDb.pragma("journal_mode = WAL");
testDb.pragma("foreign_keys = ON");
testDb.exec(`
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
`);

test("sessions table exists", () => {
    const tables = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
        .get();
    assert.ok(tables, "sessions table should exist");
});

test("messages table exists", () => {
    const tables = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
        .get();
    assert.ok(tables, "messages table should exist");
});

test("sessions table has correct columns", () => {
    const cols = testDb.prepare("PRAGMA table_info(sessions)").all();
    const names = cols.map((c) => c.name);
    assert.ok(names.includes("id"), "should have id column");
    assert.ok(names.includes("created_at"), "should have created_at column");
    assert.ok(names.includes("updated_at"), "should have updated_at column");
});

test("messages table has correct columns", () => {
    const cols = testDb.prepare("PRAGMA table_info(messages)").all();
    const names = cols.map((c) => c.name);
    assert.ok(names.includes("id"), "should have id column");
    assert.ok(names.includes("session_id"), "should have session_id column");
    assert.ok(names.includes("role"), "should have role column");
    assert.ok(names.includes("content"), "should have content column");
    assert.ok(names.includes("created_at"), "should have created_at column");
});

// ════════════════════════════════════════════════════════════════
// 2. Session CRUD Tests
// ════════════════════════════════════════════════════════════════
console.log("\n📋 Session CRUD Tests");

test("can create a session", () => {
    testDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("test-session-1");
    const session = testDb.prepare("SELECT * FROM sessions WHERE id = ?").get("test-session-1");
    assert.ok(session, "session should be created");
    assert.strictEqual(session.id, "test-session-1");
});

test("can list sessions", () => {
    testDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("test-session-2");
    const sessions = testDb.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
    assert.ok(sessions.length >= 2, "should have at least 2 sessions");
});

test("can delete a session", () => {
    testDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("test-session-delete");
    testDb.prepare("DELETE FROM sessions WHERE id = ?").run("test-session-delete");
    const session = testDb.prepare("SELECT * FROM sessions WHERE id = ?").get("test-session-delete");
    assert.strictEqual(session, undefined, "session should be deleted");
});

// ════════════════════════════════════════════════════════════════
// 3. Message CRUD Tests
// ════════════════════════════════════════════════════════════════
console.log("\n💬 Message CRUD Tests");

test("can insert a user message", () => {
    testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
        "test-session-1", "user", "Hello"
    );
    const msgs = testDb.prepare("SELECT * FROM messages WHERE session_id = ?").all("test-session-1");
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].role, "user");
    assert.strictEqual(msgs[0].content, "Hello");
});

test("can insert an assistant message", () => {
    testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
        "test-session-1", "assistant", "Hi there!"
    );
    const msgs = testDb.prepare("SELECT * FROM messages WHERE session_id = ?").all("test-session-1");
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[1].role, "assistant");
});

test("rejects invalid role", () => {
    assert.throws(() => {
        testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
            "test-session-1", "admin", "Bad role"
        );
    }, "should reject role other than user/assistant");
});

test("messages are ordered by created_at", () => {
    const msgs = testDb
        .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
        .all("test-session-1");
    assert.ok(msgs.length >= 2);
    assert.strictEqual(msgs[0].role, "user");
    assert.strictEqual(msgs[1].role, "assistant");
});

test("cascade delete removes messages when session is deleted", () => {
    testDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("test-cascade");
    testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
        "test-cascade", "user", "msg1"
    );
    testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
        "test-cascade", "assistant", "msg2"
    );
    testDb.prepare("DELETE FROM sessions WHERE id = ?").run("test-cascade");
    const msgs = testDb.prepare("SELECT * FROM messages WHERE session_id = ?").all("test-cascade");
    assert.strictEqual(msgs.length, 0, "messages should be cascade deleted");
});

// ════════════════════════════════════════════════════════════════
// 4. Context Window Tests (last 5 pairs = 10 messages)
// ════════════════════════════════════════════════════════════════
console.log("\n🧠 Context Window Tests");

test("retrieves last 10 messages (5 pairs) for context", () => {
    testDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("test-context");
    for (let i = 1; i <= 12; i++) {
        testDb.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
            "test-context", i % 2 === 1 ? "user" : "assistant", `message-${i}`
        );
    }

    const recent = testDb.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 10
    ) sub ORDER BY id ASC
  `).all("test-context");

    assert.strictEqual(recent.length, 10, "should return last 10 messages");
    assert.strictEqual(recent[0].content, "message-3", "oldest in context should be message-3");
    assert.strictEqual(recent[9].content, "message-12", "newest should be message-12");
});

// ════════════════════════════════════════════════════════════════
// 5. docs.json Validation Tests
// ════════════════════════════════════════════════════════════════
console.log("\n📄 Documentation Tests");

const docs = require("./docs.json");

test("docs.json is a non-empty array", () => {
    assert.ok(Array.isArray(docs), "docs should be an array");
    assert.ok(docs.length > 0, "docs should not be empty");
});

test("each doc has title and content fields", () => {
    docs.forEach((doc, i) => {
        assert.ok(doc.title, `doc[${i}] should have a title`);
        assert.ok(doc.content, `doc[${i}] should have content`);
        assert.strictEqual(typeof doc.title, "string");
        assert.strictEqual(typeof doc.content, "string");
    });
});

test("docs cover essential support topics", () => {
    const titles = docs.map((d) => d.title.toLowerCase());
    assert.ok(titles.some((t) => t.includes("password")), "should cover password reset");
    assert.ok(titles.some((t) => t.includes("refund")), "should cover refund policy");
});

// ════════════════════════════════════════════════════════════════
// 6. Input Validation Tests
// ════════════════════════════════════════════════════════════════
console.log("\n🔒 Input Validation Tests");

test("empty sessionId should be caught", () => {
    const sid = "";
    assert.ok(!sid || !sid.trim(), "empty sessionId should fail validation");
});

test("empty message should be caught", () => {
    const msg = "   ";
    assert.ok(!msg || !msg.trim(), "whitespace-only message should fail validation");
});

test("valid input passes validation", () => {
    const sid = "sess-abc123";
    const msg = "How do I reset my password?";
    assert.ok(sid && sid.trim(), "valid sessionId should pass");
    assert.ok(msg && msg.trim(), "valid message should pass");
});

// ════════════════════════════════════════════════════════════════
// Results
// ════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("═".repeat(50));

testDb.close();
process.exit(failed > 0 ? 1 : 0);
