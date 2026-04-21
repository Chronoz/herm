import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"

describe("composer: image attachments (D4+D7)", () => {
  test("Alt+V → clipboard.paste → chip renders; clears on send", async () => {
    const t = await mount({
      handlers: {
        "clipboard.paste": () => ({
          attached: true, path: "/tmp/clip_1.png", name: "clip_1.png",
          count: 1, width: 800, height: 600, token_estimate: 1105,
        }),
      },
    })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("v", { meta: true }))
    await until(t, () => t.gw.last("clipboard.paste") !== undefined)
    await until(t, () => t.frame().includes("clip_1.png"))

    const f = t.frame()
    expect(f).toContain(" img ")
    expect(f).toContain("800×600")
    expect(f).toContain("~1.1kt")
    // stopPropagation: <input> didn't receive the literal "v"
    expect(f).not.toMatch(/> v\b/)

    // send → chips clear (server drains attached_images on prompt.submit)
    await act(async () => { await t.keys.typeText("describe this") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("prompt.submit") !== undefined)
    await until(t, () => !t.frame().includes("clip_1.png"))
    t.destroy()
  })

  test("Alt+V with no clipboard image → toast, no chip", async () => {
    const t = await mount({
      handlers: {
        "clipboard.paste": () => ({ attached: false, message: "No image found in clipboard" }),
      },
    })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("v", { meta: true }))
    await until(t, () => t.gw.last("clipboard.paste") !== undefined)
    await until(t, () => t.frame().includes("No image found in clipboard"))
    expect(t.frame()).not.toContain(" img ")
    t.destroy()
  })

  test("multiple attachments stack as separate chips", async () => {
    let n = 0
    const t = await mount({
      handlers: {
        "clipboard.paste": () => {
          n++
          return { attached: true, path: `/tmp/i${n}.png`, name: `i${n}.png`, count: n }
        },
      },
    })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("v", { meta: true }))
    await until(t, () => t.frame().includes("i1.png"))
    act(() => t.keys.pressKey("v", { meta: true }))
    await until(t, () => t.frame().includes("i2.png"))

    expect(t.frame()).toContain("i1.png")
    expect(t.frame()).toContain("i2.png")
    t.destroy()
  })
})
