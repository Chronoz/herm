// Single-line styled text that horizontally auto-scrolls when active.
//
// Differs from ui/table.tsx Marquee in two ways:
//   1. Content is a ReactNode (styled <span>s), not a plain string —
//      the component can't slice it, so it animates the text node's
//      native scrollX instead of rebuilding a substring each tick.
//   2. Because scrollX is driven via ref (not React state), there's
//      exactly one React render regardless of scroll position. At
//      35ms/char that's 0 extra renders vs Marquee's ~28/s.
//
// The trade-off: no gap-and-loop. When scrollX hits maxScrollX the
// animation reverses back to 0 (ping-pong). Cheaper than duplicating
// the span tree to fake a seamless loop.

import { useEffect, useRef, type ReactNode } from "react"
import type { TextRenderable } from "@opentui/core"
import * as prefs from "../utils/preferences"

export const Ticker = (p: {
  active: boolean
  /** ms per cell (default 35 — fast). */
  speed?: number
  /** ms to sit still before scrolling (default 150). */
  hold?: number
  fg?: import("@opentui/core").RGBA
  children: ReactNode
}) => {
  const ref = useRef<TextRenderable | null>(null)

  const animate = prefs.get("animations") !== false && p.active
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!animate) { node.scrollX = 0; return }
    let dir = 1
    let id: ReturnType<typeof setInterval> | undefined
    const hold = setTimeout(() => {
      id = setInterval(() => {
        const max = node.maxScrollX
        if (max <= 0) return
        const next = node.scrollX + dir
        if (next >= max) { dir = -1; node.scrollX = max; return }
        if (next <= 0)   { dir =  1; node.scrollX = 0;   return }
        node.scrollX = next
      }, p.speed ?? 35)
    }, p.hold ?? 150)
    return () => {
      clearTimeout(hold)
      if (id) clearInterval(id)
      if (ref.current) ref.current.scrollX = 0
    }
  }, [animate, p.speed, p.hold])

  return (
    <box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
      <text ref={ref} wrapMode="none" fg={p.fg}>{p.children}</text>
    </box>
  )
}

// ─── Inline markdown → spans ─────────────────────────────────────────
// Just enough for a one-line peek: **bold**, `code`, _italic_/*italic*.
// Block syntax (headings, lists, fences) was already flattened by the
// caller's whitespace collapse; we strip the markers we don't style.

type Seg = { t: string; b?: boolean; c?: boolean; i?: boolean }

// Order matters — code first so ** inside backticks stays literal.
// Single * / _ require a non-word char (or start/end) on the outer
// side so snake_case and a*b don't become italics.
const RX = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|((?<![\w*])\*[^*\s][^*]*\*(?![\w*]))|((?<!\w)_[^_\s][^_]*_(?!\w))/g

/** Tokenize one line of collapsed markdown into styled segments. */
export const inline = (s: string): Seg[] => {
  const out: Seg[] = []
  let last = 0
  for (const m of s.matchAll(RX)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: s.slice(last, at) })
    const hit = m[0]
    if (hit.startsWith("`"))       out.push({ t: hit.slice(1, -1), c: true })
    else if (hit.startsWith("**") || hit.startsWith("__"))
                                   out.push({ t: hit.slice(2, -2), b: true })
    else                           out.push({ t: hit.slice(1, -1), i: true })
    last = at + hit.length
  }
  if (last < s.length) out.push({ t: s.slice(last) })
  // Scrub residual block markers that survived the collapse.
  return out.map(seg => seg.c ? seg : { ...seg, t: seg.t.replace(/^#{1,6}\s+/, "") })
}
