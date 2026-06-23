import { Hono } from "hono";
import { stream } from "hono/streaming";
import { executeWithStreaming } from "../lib/runtime-bridge";

interface ChatRequest {
  messages: { role: string; content: string }[];
  agentId?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  maxSteps?: number;
}

interface Session {
  id: string;
  userId: string;
  createdAt: number;
}

type Variables = {
  session: Session;
};

const chat = new Hono<{ Variables: Variables }>();

chat.post("/", async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required and must not be empty" }, 400);
  }

  const session = c.get("session");
  const agentId = body.agentId ?? session?.id ?? "default";

  const eventStream = await executeWithStreaming(body.messages, {
    apiKey: body.apiKey,
    provider: body.provider as import("@ladestack/runtime").LLMProvider | undefined,
    model: body.model,
    maxSteps: body.maxSteps,
    agentId,
  });

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (streamWriter) => {
    const reader = eventStream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await streamWriter.write(value);
      }
    };
    await pump();
  });
});

export { chat };
