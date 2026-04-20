import { memo } from "react"
import { useTheme } from "../../theme"
import { Spinner } from "../../ui/spinner"

export const TypingIndicator = memo((props: { label?: string }) => {
  const theme = useTheme().theme
  return (
    <box height={1} paddingLeft={1}>
      <Spinner color={theme.info} label={props.label ?? "Generating…"} />
    </box>
  )
})
