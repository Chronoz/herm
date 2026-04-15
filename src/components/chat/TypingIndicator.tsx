import { useState, useEffect, useRef, memo } from "react"
import { useTheme } from "../../theme"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export const TypingIndicator = memo(() => {
  const { theme } = useTheme()
  const [frame, setFrame] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timer.current = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length)
    }, 80)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])

  return (
    <box height={1} paddingLeft={1}>
      <text>
        <span fg={theme.info}>{FRAMES[frame]}</span>
        <span fg={theme.textMuted}> Generating...</span>
      </text>
    </box>
  )
})
