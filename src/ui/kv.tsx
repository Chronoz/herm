import type { ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../theme"

// Single key/value line for detail panels. Label is a fixed-width
// muted column; value takes remaining width and hard-truncates at
// one line (overflow=hidden on a height=1 box) rather than wrapping,
// so a long value can't push the panel layout.
export const KV = (props: { label: string; value: string; fg?: RGBA }) => {
  const theme = useTheme().theme
  return (
    <box height={1} flexDirection="row">
      <box width={11} flexShrink={0}><text fg={theme.textMuted}>{props.label}</text></box>
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <text fg={props.fg ?? theme.text}>{props.value}</text>
      </box>
    </box>
  )
}

// Stack of KV lines. Rows with an undefined value are skipped so
// callers can inline conditionals without ternary noise.
export const KVBlock = (props: { rows: Array<[string, string | undefined, RGBA?]> }): ReactNode =>
  props.rows.map(([k, v, fg]) =>
    v === undefined ? null : <KV key={k} label={k} value={v} fg={fg} />,
  )
