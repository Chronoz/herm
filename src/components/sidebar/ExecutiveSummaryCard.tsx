import { memo } from "react"
import { useTheme } from "../../theme"
import type { GoalState } from "../../utils/sessions-db"
import type { Usage } from "../../types/message"
import type { SessionInfo } from "../../utils/gateway-types"
import type { OpenCodeActivity } from "../../app/opencode"
import { formatTokens } from "../../utils/tokens"
import type { RGBA } from "@opentui/core"

const LABEL_W = 9
const PAD = "  "
const INNER = 44
const VALUE_W = INNER - LABEL_W - PAD.length

const FILL = "█"
const EMPTY = "░"

const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

const bar = (ratio: number, cells: number) => {
  const f = Math.round(Math.max(0, Math.min(1, ratio)) * cells)
  return `[${FILL.repeat(f)}${EMPTY.repeat(cells - f)}]`
}

const wrap = (s: string, first: number, rest: number, max: number) => {
  const out: string[] = []
  let rem = s
  while (rem.length > 0 && out.length < max) {
    const w = out.length === 0 ? first : rest
    out.push(rem.slice(0, w))
    rem = rem.slice(w)
  }
  if (rem.length > 0 && out.length === max) {
    const lastW = out.length === 1 ? first : rest
    out[max - 1] = out[max - 1].slice(0, lastW - 3) + "..."
  }
  return out
}

const shortModel = (model: string) => {
  const i = model.lastIndexOf("/")
  return i >= 0 ? model.slice(i + 1) : model
}

export const ExecutiveSummaryCard = memo((props: {
  goal?: GoalState | null
  usage?: Usage
  info?: SessionInfo | null
  ocActivity?: OpenCodeActivity | null
  pulse?: boolean
}) => {
  const theme = useTheme().theme
  const { ocActivity, goal, pulse, usage, info } = props

  const used = usage?.context_used ?? info?.usage?.context_used ?? info?.context_used
  const max = usage?.context_max ?? info?.usage?.context_max ?? info?.context_max

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    if (m < 60) return `${m}m ${rem}s`
    const h = Math.floor(m / 60)
    const remM = m % 60
    return `${h}h ${remM}m`
  }

  if (ocActivity) {
    const running = pulse && ocActivity.stage !== "done"
    const model = shortModel(ocActivity.model)
    const status = running ? "running" : ocActivity.status
    const statusColor = status === "error" ? theme.error : status === "blocked" ? theme.warning : theme.success
    const elapsed = fmtTime(Date.now() - ocActivity.startedAt)
    const statusToken = `[${status}]`
    const objLines = wrap(ocActivity.task, VALUE_W, VALUE_W, 2)

    const hasContext = typeof used === "number" && typeof max === "number" && max > 0
    const ratio = hasContext ? Math.max(0, Math.min(1, used / max)) : 0
    const barStr = hasContext ? bar(ratio, 7) : ""
    const usageStr = hasContext ? `${formatTokens(used)}/${formatTokens(max)} ${Math.round(ratio * 100)}%` : ""

    const suffix = hasContext ? ` ${barStr} ${usageStr}` : ""
    const modelLine = " ".repeat(LABEL_W) + PAD + trunc(model, VALUE_W - suffix.length) + suffix

    return (
      <box flexDirection="column" marginBottom={1}>
        {objLines.map((line, i) => (
          <box key={`obj-${i}`} height={1}>
            <text>
              <span fg={theme.textMuted}>{(i === 0 ? "Objective" : "").padEnd(LABEL_W) + PAD}</span>
              <span fg={theme.text}>{line}</span>
            </text>
          </box>
        ))}
        <box height={1}>
          <text>
            <span fg={theme.textMuted}>{"OpenCode".padEnd(LABEL_W) + PAD}</span>
            <span fg={statusColor}>{statusToken}</span>
            <span fg={theme.text}>{` ${elapsed}`}</span>
          </text>
        </box>
        <box height={1}>
          <text>
            <span fg={theme.textMuted}>{modelLine}</span>
          </text>
        </box>
        {ocActivity.stage === "done" && ocActivity.result && (
          <box height={1}>
            <text>
              <span fg={theme.textMuted}>{"Result".padEnd(LABEL_W) + PAD}</span>
              <span fg={theme.text}>{trunc(ocActivity.result, VALUE_W)}</span>
            </text>
          </box>
        )}
      </box>
    )
  }

  if (goal && goal.status !== "cleared") {
    const hasContext = typeof used === "number" && typeof max === "number" && max > 0
    const fixed = 1 + (hasContext ? 1 : 0)
    const objBudget = 5 - fixed
    const objLines = wrap(goal.goal, VALUE_W, VALUE_W, objBudget)

    const lines: Array<{ label: string; value: string; success?: boolean }> = []
    objLines.forEach((line, i) => {
      lines.push({ label: i === 0 ? "Objective" : "", value: line })
    })

    const turnText = (typeof goal.turn_count === "number" || typeof goal.max_turns === "number")
      ? ` · Turns ${goal.turn_count ?? 0}${typeof goal.max_turns === "number" ? ` / ${goal.max_turns}` : ""}`
      : ""
    lines.push({ label: "Status", value: `${goal.status}${turnText}`, success: goal.status === "done" })

    if (hasContext) {
      lines.push({
        label: "Context",
        value: `${formatTokens(used)} / ${formatTokens(max)} (${Math.round((used / max) * 100)}%)`,
      })
    }

    return (
      <box flexDirection="column" marginBottom={1}>
        {lines.map((line, i) => (
          <box key={i} height={1}>
            <text>
              <span fg={theme.textMuted}>{line.label.padEnd(LABEL_W) + PAD}</span>
              <span fg={line.success ? theme.success : theme.text}>{line.value}</span>
            </text>
          </box>
        ))}
      </box>
    )
  }

  return null
})
