// Maps a GatewayEvent to a turn-reducer Action plus fire-and-forget side effects.

import * as perf from "../utils/perf"
import type { GatewayEvent, SessionInfo } from "../utils/gateway-types"
import type { Action } from "./turnReducer"
import type { Usage } from "../types/message"

export type Side = {
  onReady?: () => void
  onSessionInfo?: (info: SessionInfo) => void
  onUsage?: (u: Usage) => void
  onTurnComplete?: () => void
  onClarify?: (req: { request_id: string; question: string; choices: string[] | null }) => void
  onApproval?: (req: { command: string; description: string }) => void
  onSudo?: (req: { request_id: string }) => void
  onSecret?: (req: { request_id: string; prompt: string; env_var: string }) => void
  onBackground?: (task_id: string, text: string) => void
  onBtw?: (text: string) => void
}

export function mapEvent(ev: GatewayEvent, side: Side): Action | null {
  switch (ev.type) {
    case "gateway.ready":
      side.onReady?.()
      return null

    case "session.info": {
      const si = ev.payload
      side.onSessionInfo?.(si)
      const label = si.model
        ? `Connected — ${si.model} · ${si.tools?.length ?? 0} tools · ${si.skills?.length ?? 0} skills`
        : "Connected to Hermes"
      return { kind: "system", text: label }
    }

    case "message.start":
      perf.count("stream:start")
      perf.mem("stream-start")
      return { kind: "message.start" }

    case "message.delta": {
      const chunk = ev.payload?.text ?? ""
      if (!chunk) return null
      perf.count("stream:chunk")
      return { kind: "message.delta", chunk }
    }

    case "message.complete": {
      perf.count("stream:done")
      perf.mem("stream-done")
      const u = ev.payload?.usage
      if (u) side.onUsage?.(u)
      side.onTurnComplete?.()
      return { kind: "message.complete", text: ev.payload?.text, usage: u }
    }

    case "tool.start":
      return {
        kind: "tool.start",
        id: ev.payload.tool_id,
        name: ev.payload.name ?? "unknown",
        preview: ev.payload.context,
      }

    case "tool.progress":
      return { kind: "tool.progress", name: ev.payload.name, preview: ev.payload.preview }

    case "tool.generating":
      return { kind: "tool.generating", name: ev.payload.name }

    case "tool.complete":
      return {
        kind: "tool.complete",
        id: ev.payload.tool_id,
        summary: ev.payload.summary,
        error: ev.payload.error,
        inline_diff: ev.payload.inline_diff,
      }

    case "thinking.delta":
    case "reasoning.delta":
    case "reasoning.available": {
      const text = ev.payload?.text
      if (!text) return null
      return { kind: "thinking", text, final: ev.type === "reasoning.available" }
    }

    case "subagent.start":
      return { kind: "subagent", event: "start", payload: ev.payload }
    case "subagent.thinking":
      return { kind: "subagent", event: "thinking", payload: ev.payload }
    case "subagent.tool":
      return { kind: "subagent", event: "tool", payload: ev.payload }
    case "subagent.progress":
      return { kind: "subagent", event: "progress", payload: ev.payload }
    case "subagent.complete":
      return { kind: "subagent", event: "complete", payload: ev.payload }

    case "error":
      return { kind: "error", text: ev.payload?.message ?? "Unknown error" }

    case "clarify.request":
      side.onClarify?.(ev.payload)
      return null

    case "approval.request":
      side.onApproval?.(ev.payload)
      return null

    case "sudo.request":
      side.onSudo?.(ev.payload)
      return null

    case "secret.request":
      side.onSecret?.(ev.payload)
      return null

    case "background.complete":
      side.onBackground?.(ev.payload.task_id, ev.payload.text)
      return null

    case "btw.complete":
      side.onBtw?.(ev.payload.text)
      return null

    case "gateway.stderr":
    case "gateway.start_timeout":
    case "gateway.protocol_error":
    case "status.update":
    case "skin.changed":
      return null
  }
  return null
}
