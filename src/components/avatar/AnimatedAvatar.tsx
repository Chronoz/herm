import { useState, useEffect, useRef, memo } from "react"
import { STATE_FRAMES, FPS, type AvatarState } from "./states"
import type { ParsedEikon } from "./eikon"
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
 *
 * When an `eikon` is supplied and it defines the current state, its
 * frames and fps take precedence over the baked-in set; states missing
 * from the eikon fall back to the baked-in frames.
 */

export const AnimatedAvatar = memo(({ state = "idle", eikon }: { state?: AvatarState; eikon?: ParsedEikon }) => {
  const theme = useTheme().theme
  const [frame, setFrame] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ext = eikon?.states.get(state)
  const frames: string[][] = ext ? ext.frames : STATE_FRAMES[state]
  const fps = ext?.fps ?? FPS
  const count = frames.length

  // Restart animation loop when state or source changes
  useEffect(() => {
    let idx = 0
    let dir = 1

    const tick = () => {
      perf.count("avatar:tick")
      idx += dir
      if (idx >= count - 1) dir = -1
      if (idx <= 0) dir = 1
      setFrame(idx)
      timer.current = setTimeout(tick, 1000 / fps)
    }

    setFrame(0)
    timer.current = setTimeout(tick, 1000 / fps)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [state, count, fps])

  const end = perf.mark("avatar:render")
  const idx = Math.min(frame, count - 1)
  const lines = frames[idx] ?? []

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
