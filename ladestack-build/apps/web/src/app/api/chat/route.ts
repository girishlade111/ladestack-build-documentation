import { NextRequest } from "next/server"
import { z } from "zod"

const RequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  agentId: z.string().optional(),
  provider: z.enum(["openai", "anthropic", "google", "openrouter", "custom"]),
  model: z.string().min(1),
  apiKey: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { messages, provider, model, apiKey } = parsed.data

    const honoResponse = await fetch("http://localhost:3001/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        messages,
        provider,
        model,
      }),
    })

    if (!honoResponse.ok) {
      const errorBody = await honoResponse.text()
      return Response.json(
        { error: `Upstream error: ${honoResponse.status}`, details: errorBody },
        { status: honoResponse.status }
      )
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const reader = honoResponse.body?.getReader()
        if (!reader) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "No response body" })}\n\n`
            )
          )
          controller.close()
          return
        }

        const decoder = new TextDecoder()

        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            controller.enqueue(encoder.encode(text))
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`
            )
          )
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Stream processing error"
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
            )
          )
        } finally {
          controller.close()
          reader.releaseLock()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error"
    return Response.json({ error: msg }, { status: 500 })
  }
}
