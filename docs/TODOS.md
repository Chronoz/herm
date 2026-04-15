# TODOS

Actionable work items for Herm. Ordered by priority. Each has enough context to execute without preamble.

---

## ~~1. Fix deleteSession bug — sessions never actually delete~~ ✅

Fixed in `8bd455a`. Changed `DELETE FROM sessions WHERE session_id = ?` to `WHERE id = ?`.

---

## ~~2. Batch stream content updates (16ms flush)~~ ✅

Fixed in `47422f2`. Implemented as 16ms frame-aligned microbatch in `hermes-api-client.ts` at the
emit level — `schedule()` queues events and `flush()` coalesces within 16ms. All SSE event emissions
(content, tool, done) go through the batch. This is the same pattern OpenCode uses in their SDK
event handler.

---

## ~~3. Show tool call elapsed time~~ ✅

Fixed in `36b8a07`. Added `startedAt`/`duration` fields to `ToolPart`, tracked in the tool event
handler. `ToolCallItem` shows a live second counter while running (1s setInterval) and final
duration for completed tools >1s.

---

## 4. Adopt /v1/runs API for richer tool + reasoning events

Herm currently uses `POST /v1/chat/completions` (SSE streaming). The Hermes gateway also
exposes `/v1/runs` which gives structured lifecycle events including tool timing, tool
previews, and reasoning/thinking text. Herm gets none of this today.

### Runs API protocol

**Start a run:**
```
POST /v1/runs
Content-Type: application/json
X-Hermes-Session-Id: <session>
Authorization: Bearer ***     (if configured)

{ "input": "user message", "session_id": "<session>" }
→ 202 { "run_id": "run_<uuid>", "status": "started" }
```

**Subscribe to events:**
```
GET /v1/runs/<run_id>/events
Accept: text/event-stream

data: {"event":"tool.started","run_id":"...","timestamp":...,"tool":"terminal","preview":"ls -la"}
data: {"event":"tool.completed","run_id":"...","timestamp":...,"tool":"terminal","duration":1.234,"error":false}
data: {"event":"reasoning.available","run_id":"...","timestamp":...,"text":"Let me think about..."}
data: {"event":"message.delta","run_id":"...","timestamp":...,"delta":"Here is "}
data: {"event":"run.completed","run_id":"...","timestamp":...,"output":"full response","usage":{...}}
data: {"event":"run.failed","run_id":"...","timestamp":...,"error":"..."}
```

### Implementation plan

**a) Add `sendViaRuns()` to `hermes-api-client.ts`:**

```ts
async sendViaRuns(content: string): Promise<void> {
  this.abort = new AbortController()
  this.start = Date.now()

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Hermes-Session-Id": this.session,
  }
  if (this.key) headers["Authorization"] = `Bearer ${this.key}`

  // 1. Start the run
  const res = await fetch(`${this.url}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: content, session_id: this.session }),
    signal: this.abort.signal,
  })
  if (!res.ok) throw new Error(`Runs API ${res.status}: ${await res.text()}`)
  const { run_id } = await res.json()

  // 2. Subscribe to events
  const sse = await fetch(`${this.url}/runs/${run_id}/events`, {
    headers: { ...headers, Accept: "text/event-stream" },
    signal: this.abort.signal,
  })

  this.emit("start")
  const reader = sse.body!.getReader()
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
      const raw = line.slice(6).trim()
      if (!raw || raw === ": keepalive" || raw === ": stream closed") continue

      try {
        const evt = JSON.parse(raw)
        switch (evt.event) {
          case "message.delta":
            this.emit("content", evt.delta)
            break
          case "tool.started":
            this.emit("tool", { id: evt.tool, name: evt.tool, status: "running", preview: evt.preview })
            break
          case "tool.completed":
            this.emit("tool", { id: evt.tool, name: evt.tool, status: evt.error ? "error" : "done", duration: evt.duration })
            break
          case "reasoning.available":
            this.emit("thinking", evt.text)
            break
          case "run.completed": {
            const usage = evt.usage ? {
              input: evt.usage.input_tokens,
              output: evt.usage.output_tokens,
              total: evt.usage.total_tokens,
            } : undefined
            this.emit("done", { reason: "stop", usage, duration: Date.now() - this.start, tools: [] })
            return
          }
          case "run.failed":
            this.emit("error", new Error(evt.error))
            return
        }
      } catch { /* skip malformed */ }
    }
  }
}
```

**b) Add `ThinkingPart` to `types/message.ts`:**
```ts
export type ThinkingPart = {
  type: "thinking"
  content: string
  streaming: boolean
}

export type Part = TextPart | ToolPart | ThinkingPart
```

**c) Handle `"thinking"` event in `app.tsx`:**
Same pattern as `"content"` — accumulate into the last assistant message's ThinkingPart,
render above the text response.

**d) Render thinking in MessageItem.tsx:**
Collapsible block, muted color, with a ‣ or 💭 prefix. Start simple — a single
`<text>` with `fg={theme.textMuted}`.

**e) Wire `tool.started` preview** into ToolCallItem as a `preview` field on ToolPart,
shown when args aren't available yet.

**Note:** Keep `send()` (chat/completions) as a fallback. Feature-detect `/v1/runs`
during `connect()` by checking if the POST returns 404 or 202 — older gateway versions
won't have it.

---

## ~~5. Shared data cache for tabs~~ ✅

Fixed in `e02a8ee`. Added `src/utils/cache.ts` with 5s TTL cache. Overview, Context, Memory
tabs use `snapshot()` instead of direct `readHermesHome()`. Sessions tab calls `invalidate()`
after deletions. Perf counters track cache hit/miss.

---

## 6. Handle approval/clarify prompts (architectural decision)

Herm has zero handling for tool approval, clarify, or sudo prompts. When the agent
needs permission, the Python thread blocks silently. Currently papered over by YOLO mode.

Three options (pick one):

**a) Stay on HTTP, extend api_server** — Add approval/clarify events to the `/v1/runs`
SSE stream (requires upstream PR to hermes-agent). Add response endpoints like
`POST /v1/runs/{run_id}/approve` and `POST /v1/runs/{run_id}/clarify`.

**b) Switch to tui_gateway protocol** — Spawn `python -m tui_gateway.entry` as a child
process, communicate via stdio JSON-RPC. Gives full 35+ method surface including
`approval.respond`, `clarify.respond`, `sudo.respond`, etc. Major architectural change —
Herm becomes a subprocess manager instead of an HTTP client.

**c) Hybrid** — Keep HTTP for chat, add a WebSocket sidecar for blocking prompts.
The api_server would need a `/ws` endpoint that surfaces approval/clarify events.

**For now:** Ensure YOLO mode is enabled. Document this limitation in Herm's README.
Revisit after the ink-refactor branch merges — it may change the api_server surface
and clarify which approach is intended for external TUI clients.

See `docs/hermes-tui-ink-refactor/hermes-tui-gateway-protocol.md` for the full
blocking prompt flow (clarify.request → threading.Event.wait(300s) → clarify.respond).
