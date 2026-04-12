import { EventEmitter } from "events"
import type { Usage } from "../types/message"

export type ApiConfig = {
  url?: string
  key?: string
  session?: string
  model?: string
}

export type StreamDelta = {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// Accumulated tool call from streamed deltas
export type ToolCall = {
  id: string
  name: string
  args: string
}

export type DonePayload = {
  reason: string
  usage?: Usage
  duration: number
  tools: ToolCall[]
}

export class HermesApiClient extends EventEmitter {
  private url: string
  private key?: string
  private session: string
  private model: string
  private abort?: AbortController

  // Accumulated tool calls for current response
  private pending: Map<number, ToolCall> = new Map()
  private start = 0

  constructor(cfg: ApiConfig = {}) {
    super()
    this.url = cfg.url || "http://localhost:8642/v1"
    this.key = cfg.key
    this.session = cfg.session || `herm-${Date.now()}`
    this.model = cfg.model || "hermes-agent"
  }

  async connect(): Promise<void> {
    for (let i = 1; i <= 3; i++) {
      try {
        const res = await fetch(`${this.url.replace("/v1", "")}/health`)
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
        const data = await res.json()
        if (data.status === "ok") {
          this.emit("connected", { session: this.session })
          return
        }
      } catch (err: unknown) {
        if (i === 3) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Failed to connect to Hermes API at ${this.url}: ${msg}`)
        }
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  async send(content: string): Promise<void> {
    this.abort = new AbortController()
    this.pending.clear()
    this.start = Date.now()

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "X-Hermes-Session-Id": this.session,
    }
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`

    try {
      const res = await fetch(`${this.url}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content }],
          stream: true,
        }),
        signal: this.abort.signal,
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`API ${res.status}: ${body}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body")

      this.emit("start")

      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6)
          if (raw === "[DONE]") continue

          try {
            const evt: StreamDelta = JSON.parse(raw)
            this.handle(evt)
          } catch {
            // skip malformed
          }
        }
      }

      // Finalize
      const duration = Date.now() - this.start
      const collected = Array.from(this.pending.values())
      this.emit("done", { reason: "stop", duration, tools: collected } satisfies DonePayload)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        this.emit("aborted")
      } else {
        this.emit("error", err)
      }
    } finally {
      this.abort = undefined
      this.pending.clear()
    }
  }

  private handle(evt: StreamDelta) {
    const choice = evt.choices?.[0]
    if (!choice) return

    // Text content
    if (choice.delta?.content) {
      this.emit("content", choice.delta.content)
    }

    // Tool call deltas — accumulate
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const existing = this.pending.get(tc.index)
        if (existing) {
          if (tc.function?.arguments) existing.args += tc.function.arguments
        } else {
          this.pending.set(tc.index, {
            id: tc.id || `tc-${tc.index}`,
            name: tc.function?.name || "unknown",
            args: tc.function?.arguments || "",
          })
          // Emit tool start
          this.emit("tool", {
            id: tc.id || `tc-${tc.index}`,
            name: tc.function?.name || "unknown",
            status: "running",
          })
        }
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      const usage: Usage | undefined = evt.usage
        ? { input: evt.usage.prompt_tokens, output: evt.usage.completion_tokens, total: evt.usage.total_tokens }
        : undefined
      const duration = Date.now() - this.start
      const collected = Array.from(this.pending.values())
      // Mark tools as done
      for (const tc of collected) {
        this.emit("tool", { id: tc.id, name: tc.name, status: "done" })
      }
      this.emit("done", { reason: choice.finish_reason, usage, duration, tools: collected } satisfies DonePayload)
    }
  }

  interrupt(): void {
    this.abort?.abort()
  }

  disconnect(): void {
    this.interrupt()
    this.removeAllListeners()
  }
}
