import { memo, useState, useEffect } from "react"
import { useTheme } from "../../theme"
import { Spinner } from "../../ui/spinner"

// Shown in the brief window between message.start and the first
// assistant part. The gateway's thinking.delta verb text shows in
// the Composer status bar; this is the in-transcript placeholder.
// Rotates a small local verb list so it doesn't read as frozen.

const VERBS = ["Thinking…", "Considering…", "Working…", "Pondering…"]

export const TypingIndicator = memo((props: { label?: string }) => {
  const theme = useTheme().theme
  const [i, setI] = useState(0)
  useEffect(() => {
    if (props.label) return
    const id = setInterval(() => setI(n => (n + 1) % VERBS.length), 2200)
    return () => clearInterval(id)
  }, [props.label])
  return (
    <box height={1} paddingLeft={1}>
      <Spinner color={theme.info} label={props.label ?? VERBS[i]} />
    </box>
  )
})
