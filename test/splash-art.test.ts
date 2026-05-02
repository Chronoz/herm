import { describe, test, expect } from "bun:test"
import { frame, FRAME } from "../src/ui/splash-art"

const gw = (s: string) => [...s].length

describe("splash-art frame()", () => {
  for (const [w, h] of [[80, 30], [100, 40], [120, 48]] as const) {
    test(`rows exactly ${w} cols at ${w}×${h}`, () => {
      const { lines, inner } = frame(w, h)
      expect(lines.length).toBe(h)
      for (const l of lines) expect(gw(l)).toBe(w)
      expect(inner).toEqual({ x: FRAME.cw, y: FRAME.ch, w: w - 2 * FRAME.cw, h: h - 2 * FRAME.ch })
    })
  }

  test("below minimum → no lines, clamped inner", () => {
    const { lines, inner } = frame(30, 12)
    expect(lines).toEqual([])
    expect(inner.w).toBe(0)
  })
})
