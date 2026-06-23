import type { Context, Next } from "hono";

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[API Error] ${message}`, err instanceof Error ? err.stack : "");
    return c.json({ error: message }, 500);
  }
}
