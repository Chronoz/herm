import type { ReactNode } from "react"
import { useTheme } from "../theme"

// Bordered panel chrome shared by every tab: title + keybinding hint
// on one header line, optional error line, a one-row gap, then the
// body. Body is wrapped in a flexGrow column with minWidth=0 so
// children can truncate instead of forcing the panel wider than the
// terminal.
//
// `focus` switches the border to theme.primary — used when a tab
// hosts multiple panels and wants to show which has keyboard focus.
// `grow` lets side-by-side panels set their flex ratio directly;
// flexBasis=0 makes the ratio authoritative regardless of content.

export const TabShell = (props: {
  title: string
  hint: string
  error?: string | null
  focus?: boolean
  grow?: number
  children?: ReactNode
}) => {
  const theme = useTheme().theme
  return (
    <box flexDirection="column" flexGrow={props.grow ?? 1} flexBasis={0} minWidth={0}
         border borderColor={props.focus ? theme.primary : theme.border}
         backgroundColor={theme.backgroundPanel} padding={1}>
      <box height={1} flexDirection="row" overflow="hidden">
        <box flexShrink={0}>
          <text fg={theme.primary}><strong>{props.title}</strong></text>
        </box>
        <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
          <text fg={theme.textMuted}>{`  ${props.hint}`}</text>
        </box>
      </box>
      {props.error
        ? <box height={1}><text fg={theme.error}>{`⚠ ${props.error}`}</text></box>
        : null}
      <box height={1} />
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        {props.children}
      </box>
    </box>
  )
}

// Two panels side by side. `ratio` is left:right — e.g. 3 gives the
// left pane three times the width of the right. Both slots get
// flexBasis=0 so the ratio holds independent of intrinsic content
// width.
export const SplitShell = (props: { left: ReactNode; right: ReactNode; ratio?: number }) => (
  <box flexDirection="row" flexGrow={1}>
    <box flexDirection="column" flexGrow={props.ratio ?? 3} flexBasis={0} minWidth={0}>
      {props.left}
    </box>
    <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
      {props.right}
    </box>
  </box>
)
