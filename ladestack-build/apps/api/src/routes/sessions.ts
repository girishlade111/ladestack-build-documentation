import { Hono } from "hono";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Session {
  id: string;
  messages: ChatMessage[];
  context: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Hono();
const store = new Map<string, Session>();

function cleanup() {
  const now = Date.now();
  for (const [id, session] of store) {
    if (session.expiresAt <= now) {
      store.delete(id);
    }
  }
}

setInterval(cleanup, 60_000);

sessions.post("/", (c) => {
  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    messages: [],
    context: {},
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  store.set(session.id, session);
  return c.json({ id: session.id, createdAt: session.createdAt }, 201);
});

sessions.get("/:id", (c) => {
  const id = c.req.param("id");
  const session = store.get(id);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.expiresAt <= Date.now()) {
    store.delete(id);
    return c.json({ error: "Session expired" }, 410);
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;

  return c.json({
    id: session.id,
    messages: session.messages,
    context: session.context,
    createdAt: session.createdAt,
  });
});

sessions.delete("/:id", (c) => {
  const id = c.req.param("id");

  if (!store.has(id)) {
    return c.json({ error: "Session not found" }, 404);
  }

  store.delete(id);
  return c.json({ success: true });
});

export { sessions, type Session, type ChatMessage };
