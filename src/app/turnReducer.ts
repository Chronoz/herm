// Chat turn state — messages, streaming flags, and the streaming text buffer.
// Every gateway event that mutates the message list goes through one action.

import type { Message, ToolPart, ThinkingPart, Usage } from "../types/message"
import { mid } from "../types/message"
import type { SubagentPayload, TranscriptMessage } from "../utils/gateway-types"

export type TurnState = {
  messages: Message[]
  streaming: boolean
  hasContent: boolean
  toolActive: boolean
  buf: string      // streaming assistant text buffer
}

export const initialTurn: TurnState = {
  messages: [],
  streaming: false,
  hasContent: false,
  toolActive: false,
  buf: "",
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
      return { ...state, streaming: true, hasContent: false, toolActive: false, buf: "" }

    case "message.delta": {
      const buf = state.buf + a.chunk
      return {
        ...state,
        hasContent: true,
        toolActive: false,
        buf,
        messages: upsertStreamingText(state.messages, buf),
      }
    }

    case "message.complete": {
      const messages = finalizeAssistantText(state.messages, a.text, a.usage)
      return { ...state, streaming: false, hasContent: false, toolActive: false, buf: "", messages }
    }

    case "tool.start": {
      const part: ToolPart = {
        type: "tool", id: a.id, name: a.name, args: "",
        status: "running", startedAt: Date.now(),
        preview: a.preview,
      }
      return {
        ...state,
        toolActive: true,
        hasContent: false,
        messages: appendToAssistantOrNew(state.messages, part),
      }
    }

    case "tool.progress":
      return {
        ...state,
        messages: updateLastRunningTool(state.messages, a.name, p => ({
          ...p, preview: a.preview || p.preview,
        })),
      }

    case "tool.generating":
      return {
        ...state,
        messages: updateLastRunningTool(state.messages, a.name, p => ({
          ...p, preview: p.preview ?? "generating…",
        })),
      }

    case "tool.complete": {
      const messages = updateToolById(state.messages, a.id, p => ({
        ...p,
        status: (a.error ? "error" : "done") as ToolPart["status"],
        duration: p.startedAt ? Date.now() - p.startedAt : undefined,
        preview: a.summary || a.inline_diff || p.preview,
      }))
      return { ...state, toolActive: false, messages }
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
        buf: "",
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

// ── Helpers ────────────────────────────────────────────────────────

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

function upsertStreamingText(messages: Message[], text: string): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant" && last.parts.some(p => p.type === "text" && p.streaming)) {
    const parts = last.parts.map(p => p.type === "text" && p.streaming ? { ...p, content: text } : p)
    return [...messages.slice(0, -1), { ...last, parts }]
  }
  return [...messages, {
    id: mid(), role: "assistant",
    parts: [{ type: "text", content: text, streaming: true }],
    timestamp: Date.now() / 1000,
  }]
}

function finalizeAssistantText(messages: Message[], final?: string, usage?: Usage): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") {
    const parts = last.parts.map(p => {
      if (p.type === "text" && p.streaming) return { ...p, content: final || p.content, streaming: false }
      return p
    })
    return [...messages.slice(0, -1), { ...last, parts, usage }]
  }
  if (final) {
    return [...messages, {
      id: mid(), role: "assistant" as const,
      parts: [{ type: "text" as const, content: final, streaming: false }],
      timestamp: Date.now() / 1000, usage,
    }]
  }
  return messages
}

function appendToAssistantOrNew(messages: Message[], part: ToolPart): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant")
    return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }]
  return [...messages, {
    id: mid(), role: "assistant",
    parts: [part], timestamp: Date.now() / 1000,
  }]
}

function updateLastRunningTool(
  messages: Message[],
  name: string | undefined,
  fn: (p: ToolPart) => ToolPart,
): Message[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant") return messages
  let updated = false
  const parts = last.parts.map(p => {
    if (updated) return p
    if (p.type !== "tool" || p.status !== "running") return p
    if (name && p.name !== name) return p
    updated = true
    return fn(p)
  })
  if (!updated) return messages
  return [...messages.slice(0, -1), { ...last, parts }]
}

function updateToolById(messages: Message[], id: string, fn: (p: ToolPart) => ToolPart): Message[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant") return messages
  const parts = last.parts.map(p => p.type === "tool" && p.id === id ? fn(p) : p)
  return [...messages.slice(0, -1), { ...last, parts }]
}

function upsertThinking(messages: Message[], text: string, final: boolean): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") {
    const existing = last.parts.find(p => p.type === "thinking") as ThinkingPart | undefined
    if (existing) {
      const content = final ? text : existing.content + text
      const parts = last.parts.map(p =>
        p.type === "thinking" ? { ...p, content, streaming: !final } as ThinkingPart : p
      )
      return [...messages.slice(0, -1), { ...last, parts }]
    }
    return [...messages.slice(0, -1), {
      ...last,
      parts: [{ type: "thinking" as const, content: text, streaming: !final }, ...last.parts],
    }]
  }
  return [...messages, {
    id: mid(), role: "assistant" as const,
    parts: [{ type: "thinking" as const, content: text, streaming: !final }],
    timestamp: Date.now() / 1000,
  }]
}

function renderSubagent(
  messages: Message[],
  event: "start" | "thinking" | "tool" | "progress" | "complete",
  p: SubagentPayload,
): Message[] {
  // Render subagent updates as tool parts tagged with `subagent:` prefix.
  const id = `sub-${p.task_index}`
  const name = `subagent[${p.task_index}]`
  const preview = p.tool_name
    ? `${p.tool_name}${p.tool_preview ? `: ${p.tool_preview}` : ""}`
    : p.text ?? p.goal

  if (event === "start") {
    const part: ToolPart = {
      type: "tool", id, name, args: "",
      status: "running", startedAt: Date.now(),
      preview: p.goal,
    }
    return appendToAssistantOrNew(messages, part)
  }

  if (event === "complete") {
    return updateToolById(messages, id, t => ({
      ...t,
      status: (p.status === "failed" ? "error" : "done") as ToolPart["status"],
      duration: p.duration_seconds ? p.duration_seconds * 1000 : (t.startedAt ? Date.now() - t.startedAt : undefined),
      preview: p.summary || t.preview,
    }))
  }

  // thinking / tool / progress → update preview only
  return updateToolById(messages, id, t => ({ ...t, preview: preview || t.preview }))
}
