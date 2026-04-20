import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { Spinner } from "../src/ui/spinner"

const BRAILLE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

describe("Spinner", () => {
  test("renders a braille glyph + label and animates", async () => {
    const t = await mountNode(<Spinner label="working" />)
    await until(t, () => BRAILLE.test(t.frame()))
    expect(t.frame()).toContain("working")
    const first = t.frame().match(BRAILLE)![0]
    // Shared clock ticks at 80ms; two passes ≥ one frame advance.
    await act(async () => { await Bun.sleep(100) })
    await t.settle()
    await act(async () => { await Bun.sleep(100) })
    await t.settle()
    expect(t.frame().match(BRAILLE)![0]).not.toBe(first)
    t.destroy()
  })

  test("multiple spinners share one clock (glyphs stay in sync)", async () => {
    const t = await mountNode(
      <box flexDirection="column">
        <Spinner label="a" />
        <Spinner label="b" />
      </box>,
    )
    await until(t, () => BRAILLE.test(t.frame()))
    await act(async () => { await Bun.sleep(100) })
    await t.settle()
    const glyphs = [...t.frame().matchAll(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g)].map(m => m[0])
    expect(glyphs.length).toBe(2)
    expect(glyphs[0]).toBe(glyphs[1])
    t.destroy()
  })
})
