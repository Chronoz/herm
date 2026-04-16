# Runs API Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Switch herm from `/v1/chat/completions` to `/v1/runs` API so tool calls, reasoning, and durations are surfaced — matching what OpenCode shows.

**Architecture:** Add `sendViaRuns()` to the existing `HermesApiClient`. Feature-detect on connect: if POST `/v1/runs` returns 202, use it; if 404, fall back to existing `send()`. Render reasoning as a collapsible left-bordered block (OpenCode style), and enrich tool calls with duration + error state from run events.

**What OpenCode shows that herm doesn't today:**
- Reasoning/thinking text in a muted left-bordered block with "_Thinking:_" prefix
- Tool call duration (e.g. "2.3s") from `tool.completed` events
- Tool error flag from `tool.completed` events
- Tool preview text from `tool.started` (e.g. "ls -la" before args are parsed)

**What the runs API provides:**
- `tool.started` → `{tool, preview}` — tool name + human-readable preview
- `tool.completed` → `{tool, duration, error}` — elapsed seconds + error flag  
- `reasoning.available` → `{text}` — reasoning/thinking text
- `message.delta` → `{delta}` — streaming text (same as chat completions)
- `run.completed` → `{output, usage}` — final response + token counts
- `run.failed` → `{error}` — error string

---

## Task 1: Add `sendViaRuns()` to `HermesApiClient`

**Objective:** New method that uses POST `/v1/runs` + GET `/v1/runs/{run_id}/events` SSE.

**Files:**
- Modify: `src/utils/hermes-api-client.ts`

**Implementation:**

Add `sendViaRuns(content: string): Promise<void>` that:

1. POST `/v1/runs` with `{input: content, session_id: this.session}`
2. Get `run_id` from 202 response
3. Subscribe to `GET /v1/runs/{run_id}/events` as SSE
4. Parse each `data:` line and emit:
   - `message.delta` → `this.emit("content", delta)` (same as today)
   - `tool.started` → `this.emit("tool", {id, name, status: "running", preview})`
   - `tool.completed` → `this.emit("tool", {id, name, status: done/error, duration})`
   - `reasoning.available` → `this.emit("thinking", text)` (new event)
   - `run.completed` → `this.emit("done", {reason, usage, duration})`
   - `run.failed` → `this.emit("error", new Error(...))`

The tool ID for `tool.completed` matches by tool name against the most recent pending tool with that name (runs API doesn't send a call_id in events — just the tool name).

---

## Task 2: Feature-detect runs API on connect

**Objective:** During `connect()`, probe `/v1/runs` availability and store result. `send()` dispatches accordingly.

**Files:**
- Modify: `src/utils/hermes-api-client.ts`

**Implementation:**

After the health check succeeds in `connect()`:
1. Fire a probe: `POST /v1/runs` with `{input: "__probe__"}` or just check server capabilities
2. Actually simpler: just try `sendViaRuns()` on first `send()` call. If it 404s, fall back to the old `send()` and remember.

Better approach: add a `private runsAvailable: boolean | null = null` flag. In `send()`:
- If `null`, try `sendViaRuns()`. If the POST returns 404, set `runsAvailable = false` and retry with old `send()`.
- If `true`, use `sendViaRuns()`.
- If `false`, use old chat completions path.

---

## Task 3: Add `ThinkingPart` rendering in `MessageItem`

**Objective:** Render reasoning/thinking text in OpenCode style — left-bordered muted block.

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`

**OpenCode style reference:**
```
│ _Thinking:_ reasoning text here rendered as muted markdown
│ with a left border in backgroundElement color
```

Implementation:
- For each `ThinkingPart` in message parts, render a `<box>` with:
  - `border={["left"]}` (left border only — OpenTUI supports partial borders)
  - `paddingLeft={2}`, `marginTop={1}`
  - `borderColor={theme.borderSubtle}`
  - Inside: `<text fg={theme.textMuted}>💭 Thinking: {content}</text>`
- Thinking parts render above the text response (same order as in parts array)

---

## Task 4: Wire `"thinking"` event in `app.tsx`

**Objective:** Handle the new `"thinking"` event from the API client and accumulate it into the current assistant message as a `ThinkingPart`.

**Files:**
- Modify: `src/app.tsx` (in the `wire()` callback)

**Implementation:**

Add to `wire(api)`:
```ts
api.on("thinking", (text: string) => {
  setMessages(prev => {
    const last = prev[prev.length - 1]
    if (!last || last.role !== "assistant") {
      // Create new assistant message with thinking part
      return [...prev, {
        id: mid(),
        role: "assistant",
        parts: [{ type: "thinking", content: text, streaming: true }],
        timestamp: Date.now() / 1000,
      }]
    }
    // Append to existing thinking part or create one
    const updated = { ...last, parts: [...last.parts] }
    const thinking = updated.parts.find(p => p.type === "thinking" && p.streaming)
    if (thinking && thinking.type === "thinking") {
      thinking.content += text
    } else {
      updated.parts.push({ type: "thinking", content: text, streaming: true })
    }
    return [...prev.slice(0, -1), updated]
  })
})
```

---

## Task 5: Enrich `ToolCallItem` with duration and preview

**Objective:** Show duration from `tool.completed` and preview from `tool.started` in the tool display.

**Files:**
- Modify: `src/types/message.ts` — add `preview?: string` to `ToolPart`
- Modify: `src/components/chat/ToolCallItem.tsx`

**Changes to ToolPart:**
```ts
export type ToolPart = {
  type: "tool"
  id: string
  name: string
  args: string
  status: "running" | "done" | "error"
  startedAt?: number
  duration?: number
  preview?: string  // NEW: from tool.started event
}
```

**Changes to ToolCallItem:**
- When `preview` exists and `args` is empty, show preview instead of the parsed summary
- Show duration from the `tool.completed` event (already partially wired — runs API gives exact server-side duration in seconds, more accurate than client-side timer)
- When `status === "error"`, show the tool line in error color (already done)

---

## Task 6: Update tool event handling in `app.tsx`

**Objective:** Handle `preview` and server-side `duration` from runs API tool events.

**Files:**
- Modify: `src/app.tsx` (tool event handler in `wire()`)

Currently the tool handler receives `{id, name, status}`. The runs API sends richer data:
- `tool.started`: `{id, name, status: "running", preview: "ls -la"}`
- `tool.completed`: `{id, name, status: "done"|"error", duration: 1.234}`

Update the handler to pass `preview` and `duration` through to the ToolPart.

---

## Task 7: Commit and verify

**Objective:** Build, verify no regressions, commit.

**Commands:**
```bash
cd ~/Dev/herm
bun run build
# Manual test: launch herm, send a message, verify:
# 1. Tool calls show with duration
# 2. Reasoning/thinking shows in muted block
# 3. Fallback works if runs API unavailable
git add -A
git commit -m "feat: integrate /v1/runs API for tool calls and reasoning display"
```

---

## Non-goals (explicitly deferred)
- Tool call output/results (runs API doesn't surface them)
- Expandable tool output blocks (no data source)
- Per-tool-type rendering like OpenCode (Bash, Read, Write, etc.) — herm uses generic tools from Hermes, not a fixed set
- Thinking toggle (can add later via command palette)
