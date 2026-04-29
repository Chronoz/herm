import { memo } from "react"
import { useTheme } from "../../theme"
import type { SessionInfo } from "../../utils/gateway-types"
import { formatTokens } from "../../utils/tokens"

// Context-compaction gauge for the sidebar. Three-line block:
//   258K / 1M      (used / limit)
//  [███░░░░░░░]    (10-cell bar)
//      26%         (percent)
//
// Color ramps with ratio:
//   <0.50 → textMuted   (plenty of room)
//   <0.75 → primary     (normal working range)
//   <0.90 → warning     (approaching compression)
//   ≥0.90 → error       (hot)
//
// Hidden entirely when live usage is unavailable — never renders a
// stale or fabricated value.

const CELLS = 10
const FILL = "█"
const EMPTY = "░"

type Ramp = "muted" | "primary" | "warning" | "error"

const ramp = (ratio: number): Ramp => {
  if (ratio >= 0.90) return "error"
  if (ratio >= 0.75) return "warning"
  if (ratio >= 0.50) return "primary"
  return "muted"
}

const centered = (s: string, width: number): string => {
  const pad = Math.max(0, width - s.length)
  const left = Math.floor(pad / 2)
  const right = pad - left
  return " ".repeat(left) + s + " ".repeat(right)
}

const formatPct = (ratio: number): string => {
  const pct = ratio * 100
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

export const ContextGauge = memo((props: {
  info?: SessionInfo | null
  width: number
}) => {
  const theme = useTheme().theme
  const info = props.info

  const used = info?.usage?.context_used ?? info?.context_used
  const max = info?.usage?.context_max ?? info?.context_max

  // No live data → hide. Stale gauges are worse than no gauge.
  if (!used || !max || max <= 0) return null

  const ratio = Math.max(0, Math.min(1, used / max))
  const filled = Math.round(ratio * CELLS)
  const bar = FILL.repeat(filled) + EMPTY.repeat(CELLS - filled)

  const color = (() => {
    switch (ramp(ratio)) {
      case "error":   return theme.error
      case "warning": return theme.warning
      case "primary": return theme.primary
      default:        return theme.hermBodyTextMuted
    }
  })()

  const top = `${formatTokens(used)} / ${formatTokens(max)}`
  const pct = formatPct(ratio)

  return (
    <box flexDirection="column" marginTop={1}>
      <box height={1}>
        <text><span fg={theme.hermBodyTextMuted}>{centered(top, props.width)}</span></text>
      </box>
      <box height={1}>
        <text><span fg={color}>{centered(`[${bar}]`, props.width)}</span></text>
      </box>
      <box height={1}>
        <text><span fg={theme.hermBodyTextMuted}>{centered(pct, props.width)}</span></text>
      </box>
    </box>
  )
})
