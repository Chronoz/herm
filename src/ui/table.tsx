import type { ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../theme"

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
