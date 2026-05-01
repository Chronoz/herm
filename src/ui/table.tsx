import { useState, useRef, useEffect, type ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../theme"
import * as prefs from "../utils/preferences"

// Flex-cell column primitive for list tabs. Replaces the .padEnd(N)
// single-<text> pattern that bleeds whenever a value exceeds its pad
// width or the terminal narrows. A Col is either fixed-width-clipped
// (w) or grow-truncated (grow); height=1 + overflow=hidden guarantees
// single-line, so the worst case is an ellipsis-free cut, never a
// shove into the neighbouring column.

// Scrollbox v-bar steals 1 col from body rows. Headers that sit
// outside the scrollbox pad by the same so the grow column lands on
// identical x in both. Requires the scrollbox to force its v-bar
// visible (auto-hide would make the gutter conditional → post-layout
// feedback loop).
export const VBAR_W = 1

export const Col = (p: {
  /** Fixed width in cells. Mutually exclusive with `grow`. */
  w?: number
  /** Take remaining width; truncates under narrow terminals. */
  grow?: boolean
  /** Floor for a grow column (default 12). Ignored when `w` is set. */
  min?: number
  right?: boolean
  fg?: RGBA
  bold?: boolean
  children: string
}) => {
  const theme = useTheme().theme
  const fg = p.fg ?? theme.text
  return (
    <box width={p.w} flexGrow={p.grow ? 1 : 0} flexShrink={p.grow ? 1 : 0}
         minWidth={p.grow ? (p.min ?? 12) : p.w} height={1} overflow="hidden"
         flexDirection="row" justifyContent={p.right ? "flex-end" : "flex-start"}>
      <text>{p.bold
        ? <span fg={fg}><strong>{p.children}</strong></span>
        : <span fg={fg}>{p.children}</span>}</text>
    </box>
  )
}

// Header row container. paddingRight mirrors the body scrollbox's
// v-bar so header and data Cols share available width.
export const Hdr = (p: { children: ReactNode }) => (
  <box flexDirection="row" height={1} paddingRight={VBAR_W}>
    {p.children}
  </box>
)

// A Col that horizontal-scrolls its text while active. The box still
// truncates via overflow; the string is just rotated each tick so the
// clipped slice advances. Only animates when the full text doesn't
// fit (measured post-layout from the renderable's width), so
// non-truncated cells and unselected rows don't tick.
export const Marquee = (p: {
  w?: number; grow?: boolean; min?: number
  fg?: RGBA; bold?: boolean
  active: boolean
  /** ms per character step (default 180). */
  speed?: number
  /** ms to sit still before scrolling starts (default 600). */
  hold?: number
  children: string
}) => {
  const theme = useTheme().theme
  const fg = p.fg ?? theme.text
  const text = p.children
  const ref = useRef<import("@opentui/core").BoxRenderable | null>(null)
  const [off, setOff] = useState(0)

  const animate = prefs.get("animations") !== false && p.active
  useEffect(() => {
    if (!animate) { setOff(0); return }
    // Hold static briefly before scrolling so the cell is readable at
    // rest on select; also keeps frame-snapshot tests deterministic.
    let id: ReturnType<typeof setInterval> | undefined
    const hold = setTimeout(() => {
      id = setInterval(() => {
        const w = ref.current?.width ?? 0
        if (text.length <= w) { setOff(0); return }
        setOff(o => (o + 1) % (text.length + GAP.length))
      }, p.speed ?? 180)
    }, p.hold ?? 600)
    return () => { clearTimeout(hold); if (id) clearInterval(id); setOff(0) }
  }, [animate, text, p.speed, p.hold])

  const loop = text + GAP + text
  const shown = off > 0 ? loop.slice(off, off + text.length + GAP.length) : text
  return (
    <box ref={ref}
         width={p.w} flexGrow={p.grow ? 1 : 0} flexShrink={p.grow ? 1 : 0}
         minWidth={p.grow ? (p.min ?? 12) : p.w} height={1} overflow="hidden">
      <text>{p.bold
        ? <span fg={fg}><strong>{shown}</strong></span>
        : <span fg={fg}>{shown}</span>}</text>
    </box>
  )
}
const GAP = "   "
