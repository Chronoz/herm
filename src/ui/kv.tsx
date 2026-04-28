import type { ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../theme"

// Single key/value line for detail panels. Label is a fixed-width
// muted column; value takes remaining width. Default hard-truncates
// at one line (overflow=hidden on height=1) so a long value can't
// push panel layout; `wrap` opts into multi-line word-wrap instead.
export const KV = (props: { label: string; value: string; fg?: RGBA; wrap?: boolean }) => {
  const theme = useTheme().theme
  return (
    <box minHeight={1} flexDirection="row">
      <box width={13} flexShrink={0}><text fg={theme.textMuted}>{props.label}</text></box>
      <box flexGrow={1} minWidth={0}
           height={props.wrap ? undefined : 1}
           overflow={props.wrap ? undefined : "hidden"}>
        <text wrapMode={props.wrap ? "word" : undefined} fg={props.fg ?? theme.text}>{props.value}</text>
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
