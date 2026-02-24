const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/api";

async function request(url, options = {}) {
    const res = await fetch(`${API_BASE}${url}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

export const api = {
    // Chat — POST /api/chat
    chat: (sessionId, message) =>
        request("/chat", {
            method: "POST",
            body: JSON.stringify({ sessionId, message }),
        }),

    // Conversations — GET /api/conversations/:sessionId
    getConversation: (sessionId) =>
        request(`/conversations/${sessionId}`),

    // Sessions — GET /api/sessions
    getSessions: () => request("/sessions"),

    // Delete session (extra)
    deleteSession: (id) =>
        request(`/sessions/${id}`, { method: "DELETE" }),

    // Health
    health: () => request("/health"),
};
