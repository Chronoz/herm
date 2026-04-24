// Chat turn state — messages, streaming flags. Parts are appended in the
// order the gateway emits them (text → tool → text → …), so rendering can
// iterate `parts` chronologically without regrouping.

import type { Message, Part, TextPart, ToolPart, Usage } from "../types/message"
import { mid, pid } from "../types/message"
import type { SubagentPayload, TranscriptMessage } from "../utils/gateway-types"

export type TurnState = {
  messages: Message[]
  streaming: boolean
  hasContent: boolean
  toolActive: boolean
}

export const initialTurn: TurnState = {
  messages: [],
  streaming: false,
  hasContent: false,
  toolActive: false,
}

export type Action =
  | { kind: "reset" }
  | { kind: "load"; messages: Message[] }
  | { kind: "push"; message: Message }
  | { kind: "user"; text: string }
  | { kind: "system"; text: string }
  | { kind: "message.start" }
  | { kind: "message.delta"; chunk: string }
  | { kind: "message.complete"; text?: string; usage?: Usage }
  | { kind: "tool.start"; id: string; name: string; preview?: string }
  | { kind: "tool.progress"; name?: string; preview?: string }
  | { kind: "tool.generating"; name?: string }
  | { kind: "tool.complete"; id: string; summary?: string; error?: string; inline_diff?: string }
  | { kind: "thinking"; text: string; final: boolean }
  | { kind: "subagent"; event: "start" | "thinking" | "tool" | "progress" | "complete"; payload: SubagentPayload }
  | { kind: "error"; text: string }
  | { kind: "interrupt.notice"; text: string }

export function turnReducer(state: TurnState, a: Action): TurnState {
  switch (a.kind) {
    case "reset":
      return initialTurn

    case "load":
      return { ...initialTurn, messages: a.messages }

    case "push":
      return { ...state, messages: [...state.messages, a.message] }

    case "user":
      return { ...state, messages: [...state.messages, userMessage(a.text)] }

    case "system":
      return { ...state, messages: [...state.messages, systemMessage(a.text)] }

    case "message.start":
      return { ...state, streaming: true, hasContent: false, toolActive: false }

    case "message.delta":
      return {
        ...state,
        hasContent: true,
        toolActive: false,
        messages: appendText(state.messages, a.chunk),
      }

    case "message.complete":
      return {
        ...state,
        streaming: false,
        hasContent: false,
        toolActive: false,
        messages: finalize(state.messages, a.text, a.usage),
      }

    case "tool.start": {
      // `context` carries the raw tool input; when JSON-shaped we keep it
      // as args so the UI can render KV lines on expand.
      const json = a.preview && /^\s*\{/.test(a.preview)
      const part: ToolPart = {
        type: "tool", id: a.id, name: a.name,
        args: json ? a.preview! : "",
        status: "running", startedAt: Date.now(),
        preview: a.preview,
      }
      return {
        ...state,
        toolActive: true,
        hasContent: false,
        messages: appendPart(state.messages, part, true),
      }
    }

    case "tool.progress":
      return {
        ...state,
        messages: updateRunningTool(state.messages, a.name, p => ({
          ...p, preview: a.preview || p.preview,
        })),
      }

    case "tool.generating":
      return {
        ...state,
        messages: updateRunningTool(state.messages, a.name, p => ({
          ...p, preview: p.preview ?? "generating…",
        })),
      }

    case "tool.complete":
      return {
        ...state,
        toolActive: false,
        messages: updateToolById(state.messages, a.id, p => ({
          ...p,
          status: (a.error ? "error" : "done") as ToolPart["status"],
          duration: p.startedAt ? Date.now() - p.startedAt : undefined,
          preview: a.summary || a.inline_diff || p.preview,
          result: a.error || a.summary,
          diff: a.inline_diff,
        })),
      }

    case "thinking":
      return { ...state, messages: upsertThinking(state.messages, a.text, a.final) }

    case "subagent":
      return { ...state, messages: renderSubagent(state.messages, a.event, a.payload) }

    case "error":
      return {
        ...state,
        streaming: false,
        hasContent: false,
        toolActive: false,
        messages: [...state.messages, systemMessage(`Error: ${a.text}`)],
      }

    case "interrupt.notice": {
      const last = state.messages[state.messages.length - 1]
      const already = last?.role === "system"
        && last.parts[0]?.type === "text"
        && last.parts[0].content.includes(a.text)
      if (already) return state
      return { ...state, messages: [...state.messages, systemMessage(a.text)] }
    }
  }
}

// ── Constructors ────────────────────────────────────────────────────

export function userMessage(text: string): Message {
  return {
    id: mid(), role: "user",
    parts: [{ type: "text", content: text, streaming: false }],
    timestamp: Date.now() / 1000,
  }
}

export function systemMessage(text: string): Message {
  return {
    id: mid(), role: "system",
    parts: [{ type: "text", content: text, streaming: false }],
    timestamp: Date.now() / 1000,
  }
}

export function transcriptToMessages(rows: TranscriptMessage[]): Message[] {
  return rows
    .filter(r => r.text && (r.role === "user" || r.role === "assistant"))
    .map(r => ({
      id: mid(),
      role: r.role as "user" | "assistant",
      parts: [{ type: "text" as const, content: r.text ?? "", streaming: false }],
      timestamp: Date.now() / 1000,
    }))
}

// ── Internals ───────────────────────────────────────────────────────

function assistant(parts: Part[]): Message {
  return { id: mid(), role: "assistant", parts, timestamp: Date.now() / 1000 }
}

function withLastAssistant(
  messages: Message[],
  fn: (m: Message) => Message,
  otherwise: () => Message,
): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") return [...messages.slice(0, -1), fn(last)]
  return [...messages, otherwise()]
}

/** Seal the trailing streaming text part so the next chunk starts fresh. */
function seal(parts: Part[]): Part[] {
  const last = parts[parts.length - 1]
  if (last?.type === "text" && last.streaming)
    return [...parts.slice(0, -1), { ...last, streaming: false }]
  return parts
}

/** Append a chunk to the trailing streaming text part, or open a new one. */
function appendText(messages: Message[], chunk: string): Message[] {
  return withLastAssistant(
    messages,
    m => {
      const last = m.parts[m.parts.length - 1]
      if (last?.type === "text" && last.streaming) {
        const part: TextPart = { ...last, content: last.content + chunk }
        return { ...m, parts: [...m.parts.slice(0, -1), part] }
      }
      return { ...m, parts: [...m.parts, { type: "text", key: pid(), content: chunk, streaming: true }] }
    },
    () => assistant([{ type: "text", key: pid(), content: chunk, streaming: true }]),
  )
}

/** Append a non-text part, optionally sealing any open text stream first. */
function appendPart(messages: Message[], part: Part, close: boolean): Message[] {
  return withLastAssistant(
    messages,
    m => ({ ...m, parts: [...(close ? seal(m.parts) : m.parts), part] }),
    () => assistant([part]),
  )
}

function finalize(messages: Message[], final?: string, usage?: Usage): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") {
    const tail = last.parts[last.parts.length - 1]
    const parts = tail?.type === "text" && tail.streaming
      ? [...last.parts.slice(0, -1), { ...tail, content: final || tail.content, streaming: false }]
      : final && final !== joinText(last.parts)
        ? [...last.parts, { type: "text" as const, content: final, streaming: false }]
        : seal(last.parts)
    return [...messages.slice(0, -1), { ...last, parts, usage }]
  }
  if (!final) return messages
  return [...messages, { ...assistant([{ type: "text", content: final, streaming: false }]), usage }]
}

function joinText(parts: Part[]): string {
  return parts.filter(p => p.type === "text").map(p => p.content).join("")
}

function updateRunningTool(
  messages: Message[],
  name: string | undefined,
  fn: (p: ToolPart) => ToolPart,
): Message[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant") return messages
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const p = last.parts[i]
    if (p.type !== "tool" || p.status !== "running") continue
    if (name && p.name !== name) continue
    const parts = [...last.parts]
    parts[i] = fn(p)
    return [...messages.slice(0, -1), { ...last, parts }]
  }
  return messages
}

function updateToolById(messages: Message[], id: string, fn: (p: ToolPart) => ToolPart): Message[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant") return messages
  const parts = last.parts.map(p => p.type === "tool" && p.id === id ? fn(p) : p)
  return [...messages.slice(0, -1), { ...last, parts }]
}

function upsertThinking(messages: Message[], text: string, final: boolean): Message[] {
  return withLastAssistant(
    messages,
    m => {
      const idx = m.parts.findIndex(p => p.type === "thinking")
      if (idx >= 0) {
        const prev = m.parts[idx] as Part & { type: "thinking"; content: string }
        // `final` (reasoning.available) is a fallback for providers
        // that don't stream deltas — keep the accumulated buffer if we
        // have one. Matches Ink turnController.recordReasoningAvailable.
        const content = final ? prev.content.trim() || text : prev.content + text
        const parts = [...m.parts]
        parts[idx] = { ...prev, content, streaming: !final }
        return { ...m, parts }
      }
      return { ...m, parts: [{ type: "thinking" as const, key: pid(), content: text, streaming: !final }, ...m.parts] }
    },
    () => assistant([{ type: "thinking", key: pid(), content: text, streaming: !final }]),
  )
}

function renderSubagent(
  messages: Message[],
  event: "start" | "thinking" | "tool" | "progress" | "complete",
  p: SubagentPayload,
): Message[] {
  const id = `sub-${p.task_index}`

  if (event === "start") {
    const part: ToolPart = {
      type: "tool", id, name: "delegate_task", args: "",
      status: "running", startedAt: Date.now(),
      preview: p.goal, goal: p.goal, trail: [],
    }
    return appendPart(messages, part, true)
  }

  if (event === "tool" && p.tool_name) {
    return updateToolById(messages, id, t => ({
      ...t,
      trail: [...(t.trail ?? []), { name: p.tool_name!, preview: p.tool_preview }],
      preview: p.tool_preview ? `${p.tool_name}: ${p.tool_preview}` : p.tool_name,
    }))
  }

  if (event === "complete") {
    return updateToolById(messages, id, t => ({
      ...t,
      status: (p.status === "failed" ? "error" : "done") as ToolPart["status"],
      duration: p.duration_seconds ? p.duration_seconds * 1000 : (t.startedAt ? Date.now() - t.startedAt : undefined),
      result: p.summary,
      preview: t.goal ?? t.preview,
    }))
  }

  // thinking / progress — surface transient text on the row.
  return updateToolById(messages, id, t => ({ ...t, preview: p.text ?? t.preview }))
}
