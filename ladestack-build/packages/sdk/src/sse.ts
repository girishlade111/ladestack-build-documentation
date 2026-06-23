interface SSECallbacks {
  onEvent?: (event: { type: string; data: unknown }) => void
  onError?: (error: Error) => void
  onComplete?: () => void
}

export function createSSEConnection(
  url: string,
  body: unknown,
  { onEvent, onError, onComplete }: SSECallbacks
): AbortController {
  const controller = new AbortController()

  const run = async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`SSE request failed: ${response.status} ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("Response body is not readable")

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let currentEvent = ""
        let currentData = ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6).trim()
          } else if (line === "" && currentData) {
            try {
              const parsed = JSON.parse(currentData)
              onEvent?.({ type: currentEvent || "message", data: parsed })
            } catch {
              onEvent?.({ type: currentEvent || "message", data: currentData })
            }
            currentEvent = ""
            currentData = ""
          }
        }
      }

      onComplete?.()
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  run()
  return controller
}
