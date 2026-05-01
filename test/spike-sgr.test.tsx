// Spike for herm-tji.1 — does OpenTUI <text> render raw SGR escapes as
// color, or print them literally?
//
// This matters for herm-mzb.7 (inline images via chafa). chafa's default
// output for --format=symbols --colors=full is a stream of ESC[38;2;R;G;Bm
// per-cell SGR escapes. If OpenTUI parses them, mzb.7 is trivial. If not,
// we need to either parse them into <span fg={...}> or bypass React entirely.

import { describe, expect, test } from "bun:test"
import { mountNode } from "./harness"

const ESC = "\x1b"

describe("spike: SGR passthrough in <text>", () => {
  test("baseline: plain text renders as-is", async () => {
    const t = await mountNode(<text>HELLO</text>, { width: 20, height: 3 })
    expect(t.frame()).toContain("HELLO")
    t.destroy()
  })

  test("raw 16-color SGR: \\x1b[31mRED\\x1b[0m", async () => {
    const body = `${ESC}[31mRED${ESC}[0m`
    const t = await mountNode(<text>{body}</text>, { width: 20, height: 3 })
    const f = t.frame()
    console.log("=== 16-color frame ===")
    console.log(JSON.stringify(f))
    // If OpenTUI parses → frame shows "RED" without the escape bytes.
    // If OpenTUI prints literally → frame includes "[31m" somewhere.
    const parsed = f.includes("RED") && !f.includes("[31m")
    const literal = f.includes("[31m")
    console.log(`parsed=${parsed}  literal=${literal}`)
    t.destroy()
  })

  test("raw 24-bit SGR: \\x1b[38;2;255;0;0mRED\\x1b[0m (chafa format)", async () => {
    const body = `${ESC}[38;2;255;0;0mRED${ESC}[0m`
    const t = await mountNode(<text>{body}</text>, { width: 20, height: 3 })
    const f = t.frame()
    console.log("=== 24-bit frame ===")
    console.log(JSON.stringify(f))
    const parsed = f.includes("RED") && !f.includes("38;2;255")
    const literal = f.includes("38;2;255")
    console.log(`parsed=${parsed}  literal=${literal}`)
    t.destroy()
  })

  test("chafa-like multi-cell: two adjacent colored half-blocks", async () => {
    // What one row of `chafa --format=symbols --colors=full` actually looks
    // like: per-cell fg+bg SGR then a Unicode block, then a reset.
    const body =
      `${ESC}[38;2;255;0;0m${ESC}[48;2;0;0;255m▀` +
      `${ESC}[38;2;0;255;0m${ESC}[48;2;255;255;0m▀${ESC}[0m`
    const t = await mountNode(<text>{body}</text>, { width: 20, height: 3 })
    const f = t.frame()
    console.log("=== chafa-like frame ===")
    console.log(JSON.stringify(f))
    console.log("visible chars:", [...f].filter(c => c === "▀").length)
    t.destroy()
  })
})
