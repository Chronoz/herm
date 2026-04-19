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
  onStatus?: (text: string) => void
}

function count(o: Record<string, string[]> | undefined): number {
  return o ? Object.values(o).reduce((n, v) => n + v.length, 0) : 0
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
        ? `Connected — ${si.model} · ${count(si.tools)} tools · ${count(si.skills)} skills`
        : "Connected to Hermes"
      if (si.credential_warning) side.onStatus?.(si.credential_warning)
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
      const p = ev.payload
      if (p?.usage) side.onUsage?.(p.usage)
      side.onTurnComplete?.()
      // The gateway reports in-agent failures via status (exceptions come
      // as a separate `error` event). Without this branch a failed API
      // call ends the turn with no visible output.
      if (p?.status === "error")
        return { kind: "error", text: p.text || "request failed — see messages above" }
      if (p?.status === "interrupted")
        return { kind: "message.complete", text: (p.text || "") + "\n\n*[interrupted]*", usage: p?.usage }
      return { kind: "message.complete", text: p?.text ?? undefined, usage: p?.usage }
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
      // Cosmetic spinner text from the agent's status line, not model
      // reasoning. Surface as transient status only.
      side.onStatus?.(ev.payload?.text ?? "")
      return null

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

    case "gateway.stderr": {
      // Error-ish stderr lines (tracebacks, HTTP 4xx/5xx, auth failures)
      // surface inline; benign chatter stays in gw.tail() only (/logs).
      const line = ev.payload.line
      if (/error|fail|traceback|exception|\b[45]\d\d\b|refused|denied|unauthori/i.test(line))
        return { kind: "system", text: line.slice(0, 200) }
      return null
    }

    case "skin.changed":
      return null

    case "gateway.start_timeout":
      return { kind: "error", text: `gateway startup timed out (${ev.payload?.python ?? "python"} @ ${ev.payload?.cwd ?? "?"})` }

    case "gateway.protocol_error":
      return { kind: "system", text: `protocol error: ${ev.payload?.preview ?? "?"}` }

    case "status.update": {
      const kind = ev.payload?.kind
      const text = ev.payload?.text ?? ""
      side.onStatus?.(text)
      // Generic "status" is cosmetic; lifecycle/error/warn carry real
      // signal (retries, fallbacks, auth failures) and must persist.
      if (!kind || kind === "status") return null
      return { kind: "system", text }
    }
  }
  return null
}
