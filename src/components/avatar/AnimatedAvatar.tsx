import { useState, useEffect, useRef, memo } from "react"
import { STATE_FRAMES, FPS, type AvatarState } from "./states"
import { useTheme } from "../../theme"
import * as perf from "../../utils/perf"

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

export const AnimatedAvatar = memo(({ state = "idle" }: { state?: AvatarState }) => {
  const theme = useTheme().theme
  const [frame, setFrame] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restart animation loop when state changes
  useEffect(() => {
    let idx = 0
    let dir = 1

    const tick = () => {
      perf.count("avatar:tick")
      const count = STATE_FRAMES[state].length
      idx += dir
      if (idx >= count - 1) dir = -1
      if (idx <= 0) dir = 1
      setFrame(idx)
      timer.current = setTimeout(tick, 1000 / FPS)
    }

    setFrame(0)
    timer.current = setTimeout(tick, 1000 / FPS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [state])

  const end = perf.mark("avatar:render")
  const frames = STATE_FRAMES[state]
  const idx = Math.min(frame, frames.length - 1)
  const lines = frames[idx].split("\n").filter(l => l.length > 0)

  const result = (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i}>
          <span fg={theme.hermAvatar}>{line}</span>
        </text>
      ))}
    </box>
  )
  end()
  return result
})
