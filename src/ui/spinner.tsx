// Single shared braille spinner. oc uses a native <spinner> element
// from opentui-spinner; Herm drives a setInterval so the only moving
// state is one integer. All spinners on screen share the same tick
// via a module-level clock — N spinners = 1 interval, not N.

import { useState, useEffect, memo, type ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../theme"
import * as prefs from "../utils/preferences"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const MS = 80

type Sub = (n: number) => void
const subs = new Set<Sub>()
let tick = 0
let timer: ReturnType<typeof setInterval> | null = null

function sub(fn: Sub) {
  subs.add(fn)
  if (!timer) timer = setInterval(() => {
    tick = (tick + 1) % FRAMES.length
    for (const s of subs) s(tick)
  }, MS)
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && timer) { clearInterval(timer); timer = null }
  }
}

function useFrame(active: boolean): number {
  const [n, set] = useState(tick)
  useEffect(() => (active ? sub(set) : undefined), [active])
  return n
}

export const Spinner = memo((props: { color?: RGBA; label?: ReactNode }) => {
  const theme = useTheme().theme
  const color = props.color ?? theme.textMuted
  const on = prefs.get("animations") !== false
  const n = useFrame(on)
  return (
    <text>
      <span fg={color}>{on ? FRAMES[n] : "⋯"}</span>
      {props.label ? <span fg={color}> {props.label}</span> : null}
    </text>
  )
})

/**
 * Inline glyph only — for embedding inside an existing <text>. Pass
 * `active=false` for rows that aren't spinning: the hook won't
 * subscribe to the clock, so completed rows don't re-render 12×/s.
 */
export function useSpinnerGlyph(active = true): string {
  const on = prefs.get("animations") !== false && active
  const n = useFrame(on)
  return on ? FRAMES[n] : "⋯"
}
