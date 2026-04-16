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

  // 16ms microbatch queue
  private queue: Array<() => void> = []
  private timer?: ReturnType<typeof setTimeout>
  private lastFlush = 0

  // Runs API feature detection: null = untested, true/false = known
  private runsAvailable: boolean | null = null

  // Track tool names to IDs for runs API (tool.completed only sends name, not id)
  private toolIds: Map<string, string> = new Map()
  private toolCounter = 0

  constructor(cfg: ApiConfig = {}) {
    super()
    this.url = cfg.url || "http://localhost:8642/v1"
    this.key = cfg.key
    this.session = cfg.session || `herm-${Date.now()}`
    this.model = cfg.model || "hermes-agent"
  }

  private flush() {
    const batch = this.queue
    this.queue = []
    this.timer = undefined
    this.lastFlush = Date.now()
    for (const fn of batch) fn()
  }

  private schedule(fn: () => void) {
    this.queue.push(fn)
    if (this.timer) return
    if (Date.now() - this.lastFlush < 16) {
      this.timer = setTimeout(() => this.flush(), 16)
      return
    }
    this.flush()
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
    // Feature-detect runs API on first call
    if (this.runsAvailable === null) {
      try {
        await this.sendViaRuns(content)
        this.runsAvailable = true
        return
      } catch (err: unknown) {
        const is404 = err instanceof Error && err.message.includes("404")
        if (is404) {
          this.runsAvailable = false
          // Fall through to chat completions
        } else {
          throw err
        }
      }
    }

    if (this.runsAvailable) return this.sendViaRuns(content)

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
      this.flush()
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
      const chunk = choice.delta.content
      this.schedule(() => this.emit("content", chunk))
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
          const tool = { id: tc.id || `tc-${tc.index}`, name: tc.function?.name || "unknown", status: "running" }
          this.schedule(() => this.emit("tool", tool))
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
        const ev = { id: tc.id, name: tc.name, status: "done" }
        this.schedule(() => this.emit("tool", ev))
      }
      const payload = { reason: choice.finish_reason, usage, duration, tools: collected } satisfies DonePayload
      this.schedule(() => this.emit("done", payload))
    }
  }

  private async sendViaRuns(content: string): Promise<void> {
    this.abort = new AbortController()
    this.start = Date.now()
    this.toolIds.clear()
    this.toolCounter = 0

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`

    // 1. Start the run
    const res = await fetch(`${this.url}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: content, session_id: this.session }),
      signal: this.abort.signal,
    })

    if (res.status === 404) throw new Error("404")
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Runs API ${res.status}: ${body}`)
    }

    const { run_id } = await res.json() as { run_id: string }

    // 2. Subscribe to SSE events
    const sse = await fetch(`${this.url}/runs/${run_id}/events`, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: this.abort.signal,
    })

    if (!sse.ok) throw new Error(`Runs SSE ${sse.status}`)

    const reader = sse.body?.getReader()
    if (!reader) throw new Error("No SSE body")

    this.emit("start")

    const decoder = new TextDecoder()
    let buf = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith(": ")) continue // keepalive / comments
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          try {
            const evt = JSON.parse(raw) as {
              event: string
              run_id: string
              timestamp: number
              delta?: string
              tool?: string
              preview?: string
              duration?: number
              error?: boolean | string
              output?: string
              text?: string
              usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
            }
            this.handleRunEvent(evt)
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        this.emit("aborted")
      } else {
        this.emit("error", err)
      }
    } finally {
      this.flush()
      this.abort = undefined
      this.toolIds.clear()
    }
  }

  private handleRunEvent(evt: {
    event: string
    delta?: string
    tool?: string
    preview?: string
    duration?: number
    error?: boolean | string
    output?: string
    text?: string
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
  }) {
    switch (evt.event) {
      case "message.delta":
        if (evt.delta) {
          const chunk = evt.delta
          this.schedule(() => this.emit("content", chunk))
        }
        break

      case "tool.started": {
        this.toolCounter++
        const id = `run-tool-${this.toolCounter}`
        const name = evt.tool || "unknown"
        this.toolIds.set(name, id)
        this.schedule(() => this.emit("tool", {
          id, name, status: "running", preview: evt.preview,
        }))
        break
      }

      case "tool.completed": {
        const name = evt.tool || "unknown"
        const id = this.toolIds.get(name) || `run-tool-${name}`
        const status = evt.error ? "error" : "done"
        const duration = evt.duration ? evt.duration * 1000 : undefined // seconds → ms
        this.schedule(() => this.emit("tool", { id, name, status, duration }))
        break
      }

      case "reasoning.available":
        if (evt.text) {
          const text = evt.text
          this.schedule(() => this.emit("thinking", text))
        }
        break

      case "run.completed": {
        const usage: Usage | undefined = evt.usage
          ? { input: evt.usage.input_tokens, output: evt.usage.output_tokens, total: evt.usage.total_tokens }
          : undefined
        const duration = Date.now() - this.start
        const payload: DonePayload = { reason: "stop", usage, duration, tools: [] }
        this.schedule(() => this.emit("done", payload))
        break
      }

      case "run.failed":
        this.schedule(() => this.emit("error", new Error(String(evt.error || "Run failed"))))
        break
    }
  }

  interrupt(): void {
    this.abort?.abort()
  }

  disconnect(): void {
    if (this.timer) clearTimeout(this.timer)
    this.interrupt()
    this.removeAllListeners()
  }
}
