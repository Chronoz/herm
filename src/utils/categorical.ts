/**
 * Categorical color ramp — golden-angle HSL walk anchored on a seed color.
 *
 * Used by the Context grid where N adjacent category swatches must be
 * mutually distinguishable. Theme-semantic keys (info/accent/…) weren't
 * designed for that; this generates the ramp at runtime so no per-theme
 * palette is needed.
 */

import { RGBA } from "@opentui/core"

/** Golden angle in degrees — maximally irrational, so successive hues spread evenly for any N. */
const GOLDEN_ANGLE = 137.50776405003785

export function luminance(c: RGBA): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
}

/** RGBA (0–1 floats) → [h°, s, l] with h in [0,360), s/l in [0,1]. */
export function rgbaToHsl(c: RGBA): [number, number, number] {
  const r = c.r, g = c.g, b = c.b
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break
    case g: h = (b - r) / d + 2; break
    default: h = (r - g) / d + 4
  }
  return [h * 60, s, l]
}

/** [h°, s, l] → RGBA (0–1 floats, alpha=1). */
export function hslToRgba(h: number, s: number, l: number): RGBA {
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) return RGBA.fromValues(l, l, l, 1)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const ch = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return RGBA.fromValues(ch(h + 1 / 3), ch(h), ch(h - 1 / 3), 1)
}

/**
 * Generate N categorical colors.
 *
 * Hue starts at `seed`'s hue and steps by the golden angle. Saturation and
 * lightness are picked from `bg` luminance so swatches stay legible on both
 * dark and light themes without per-theme tuning. Slot i is stable across
 * calls: same id → same slot → same hue family on every theme.
 */
export function categorical(seed: RGBA, bg: RGBA, n: number): RGBA[] {
  const [h0] = rgbaToHsl(seed)
  const dark = luminance(bg) < 0.5
  const s = dark ? 0.60 : 0.70
  const l = dark ? 0.62 : 0.42
  const out: RGBA[] = []
  for (let i = 0; i < n; i++) out.push(hslToRgba(h0 + i * GOLDEN_ANGLE, s, l))
  return out
}

/** Minimum hue separation (degrees) across N golden-angle slots. Useful for test assertions. */
export function minHueSeparation(n: number): number {
  const hs = Array.from({ length: n }, (_, i) => (i * GOLDEN_ANGLE) % 360).sort((a, b) => a - b)
  let min = 360 - hs[n - 1] + hs[0]
  for (let i = 1; i < n; i++) min = Math.min(min, hs[i] - hs[i - 1])
  return min
}
