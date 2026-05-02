// Launch splash — ornate braille frame over an empty transcript, with
// wordmark, version/behind info, and a continue-last-session prompt.
// Presentational only: dismissal + Enter-to-continue live in app.tsx.

import { useRef, useState, useEffect, useMemo } from "react"
import { useRenderer } from "@opentui/react"
import { measureText, type ASCIIFontName } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import { useTheme } from "../theme"
import { frame, FRAME } from "./splash-art"
import pkg from "../../package.json" with { type: "json" }

export type SplashInfo = {
  agentVersion?: string
  behind?: number | null
  model?: string
}

export type SplashProps = {
  /** Gateway-derived facts; undefined until session.info arrives. */
  info?: SplashInfo
  /** Last real TUI session — shows the continue prompt when present. */
  last?: { id: string; title: string | null }
  /** True once the user has typed in the composer — hides the prompt. */
  composing?: boolean
}

// Wordmark font tiers, widest first. `measureText` is cheap (table lookup).
const TIERS: ASCIIFontName[] = ["block", "slick", "tiny"]
const pickFont = (innerW: number): ASCIIFontName =>
  TIERS.find(f => measureText({ text: "HERM", font: f }).width <= innerW) ?? "tiny"

const clip = (s: string, w: number) =>
  [...s].length <= w ? s : [...s].slice(0, Math.max(1, w - 1)).join("") + "…"

export function Splash(p: SplashProps) {
  const theme = useTheme().theme
  const ref = useRef<BoxRenderable | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Measure after yoga has laid out. frameCallbacks run once per render
  // tick (before the next layout pass), so this reads the previous
  // frame's computed size — same one-frame latency the old 50ms poll
  // had, but synced to the render loop instead of a free-running timer.
  const renderer = useRenderer()
  useEffect(() => {
    const cb = async () => {
      const r = ref.current
      if (!r) return
      setBox(b => (b.w === r.width && b.h === r.height) ? b : { w: r.width, h: r.height })
    }
    renderer.setFrameCallback(cb)
    return () => renderer.removeFrameCallback(cb)
  }, [renderer])

  const { lines, inner } = useMemo(() => frame(box.w, box.h), [box.w, box.h])
  const font = useMemo(() => pickFont(inner.w), [inner.w])

  const behind = p.info?.behind
  const sub = [
    `v${pkg.version}`,
    p.info ? `hermes ${p.info.agentVersion ?? "?"}` : "…",
    behind == null ? null : behind === 0 ? "up to date" : `${behind} behind`,
    p.info?.model,
  ].filter(Boolean).join("  ·  ")

  const prompt = p.last && !p.composing
  const title = p.last?.title?.trim() || p.last?.id

  return (
    <box ref={ref} position="absolute" left={0} top={0} right={0} bottom={0}
         zIndex={50} backgroundColor={theme.background}>
      {lines.map((l, i) => (
        <box key={i} position="absolute" top={i} left={0} height={1}>
          <text fg={theme.accent}>{l}</text>
        </box>
      ))}
      {lines.length > 0 && (
        <box position="absolute" left={inner.x} top={inner.y}
             width={inner.w} height={inner.h}
             flexDirection="column" alignItems="center" justifyContent="center">
          <ascii-font text="HERM" font={font}
            color={[theme.accent, theme.textMuted]} selectable={false} />
          <text fg={theme.textMuted}>{clip(sub, inner.w)}</text>
          <box height={1} />
          {prompt ? (
            <>
              <text fg={theme.textMuted}>
                {"continue "}
                <span fg={theme.text}>"{clip(title ?? "", Math.max(8, inner.w - 14))}"</span>
                {" ?"}
              </text>
              <text fg={theme.textMuted}>
                <span fg={theme.accent}>[enter]</span>
                {" yes  ·  type to start fresh"}
              </text>
            </>
          ) : (
            <text fg={theme.textMuted}>
              <span fg={theme.accent}>[enter]</span> to send
            </text>
          )}
        </box>
      )}
    </box>
  )
}
