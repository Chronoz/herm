import { describe, test, expect } from "bun:test"
import { loadTips, splitTip, randomTip } from "../src/utils/tips"

describe("tips", () => {
  test("loadTips parses hermes_cli/tips.py into a flat string list", () => {
    const t = loadTips()
    expect(t.length).toBeGreaterThan(10)
    // Every entry is a single non-empty line (source is one string per line).
    for (const tip of t) {
      expect(tip.length).toBeGreaterThan(0)
      expect(tip).not.toContain("\n")
    }
    // Known stable entry (first slash-command tip in corpus).
    expect(t.some(s => s.startsWith("/btw "))).toBe(true)
    // Escaped quotes round-trip.
    expect(t.some(s => s.includes('/title "my project"'))).toBe(true)
  })

  test("splitTip highlights /slash, @ref, keybind, `code`, quoted", () => {
    const p = splitTip('Use /model or Ctrl+G to edit `foo.ts` with @file:bar and "baz".')
    const hl = p.filter(x => x.hl).map(x => x.t)
    expect(hl).toEqual(["/model", "Ctrl+G", "foo.ts", "@file:bar", '"baz"'])
    // Reassembly covers whole input (modulo stripped backticks).
    const joined = p.map(x => x.t).join("")
    expect(joined).toBe('Use /model or Ctrl+G to edit foo.ts with @file:bar and "baz".')
  })

  test("splitTip on plain text yields single non-highlight part", () => {
    const p = splitTip("nothing special here")
    expect(p).toEqual([{ t: "nothing special here", hl: false }])
  })

  test("randomTip avoids immediate repeat", () => {
    const first = randomTip()
    for (let i = 0; i < 20; i++) expect(randomTip(first)).not.toBe(first)
  })
})
