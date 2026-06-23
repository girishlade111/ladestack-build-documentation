import type { Context, Next } from "hono";

interface Session {
  id: string;
  userId: string;
  createdAt: number;
}

const DEMO_ENABLED = process.env["DEMO_MODE"] !== "false";

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  const cookieToken = c.req.header("Cookie")?.match(/session_token=([^;]+)/)?.[1];

  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? cookieToken;

  if (!token) {
    if (DEMO_ENABLED) {
      const demoSession: Session = {
        id: `demo-${crypto.randomUUID()}`,
        userId: "anonymous",
        createdAt: Date.now(),
      };
      c.set("session", demoSession);
      return next();
    }
    return c.json({ error: "Unauthorized: no session token provided" }, 401);
  }

  try {
    const session: Session = {
      id: token,
      userId: token.startsWith("demo-") ? "anonymous" : "authenticated",
      createdAt: Date.now(),
    };
    c.set("session", session);
    return next();
  } catch {
    return c.json({ error: "Unauthorized: invalid session token" }, 401);
  }
}
