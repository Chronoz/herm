import { useState, useEffect, useRef } from "react"
import { STATE_FRAMES, FPS, type AvatarState } from "./states"
import { useTheme } from "../../theme"

/**
 * Animation loop:
 *   1. Pause on frame 0 for PAUSE_FIRST ms
 *   2. Play forward (0 → last) at FPS
 *   3. Pause on last frame for PAUSE_LAST ms
 *   4. Play reverse (last → 0) at FPS
 *   5. Goto 1
 *
 * Restarts from frame 0 whenever `state` changes.
 */

export const AnimatedAvatar = ({ state = "idle" }: { state?: AvatarState }) => {
  const { theme } = useTheme()
  const [frame, setFrame] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAUSE_FIRST = 5000
  const PAUSE_LAST = 1000

  // Restart animation loop when state changes
  useEffect(() => {
    let idx = 0
    let phase: "pause-first" | "forward" | "pause-last" | "reverse" = "pause-first"

    const tick = () => {
      const frames = STATE_FRAMES[state]
      const count = frames.length

      switch (phase) {
        case "pause-first":
          phase = "forward"
          idx = 0
          timer.current = setTimeout(tick, PAUSE_FIRST)
          break

        case "forward":
          idx++
          setFrame(idx)
          if (idx >= count - 1) phase = "pause-last"
          timer.current = setTimeout(tick, phase === "pause-last" ? PAUSE_LAST : 1000 / FPS)
          break

        case "pause-last":
          phase = "reverse"
          timer.current = setTimeout(tick, 0)
          break

        case "reverse":
          idx--
          setFrame(idx)
          if (idx <= 0) phase = "pause-first"
          timer.current = setTimeout(tick, phase === "pause-first" ? PAUSE_FIRST : 1000 / FPS)
          break
      }
    }

    setFrame(0)
    timer.current = setTimeout(tick, 1)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [state])

  const frames = STATE_FRAMES[state]
  const idx = Math.min(frame, frames.length - 1)
  const lines = frames[idx].split("\n").filter(l => l.length > 0)

  return (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i}>
          <span fg={theme.hermAvatar}>{line}</span>
        </text>
      ))}
    </box>
  )
}
