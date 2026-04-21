import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"

describe("steer", () => {
  test("Shift+Enter while streaming → session.steer + system line", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))

    await act(async () => { await t.keys.typeText("also check foo") })
    await t.settle()
    act(() => t.keys.pressEnter({ shift: true }))
    await until(t, () => t.gw.last("session.steer") !== undefined)

    expect(t.gw.last("session.steer")?.params.text).toBe("also check foo")
    await until(t, () => t.frame().includes("↪ steered: also check foo"))
    // stopPropagation: input didn't also enqueue the same text
    expect(t.frame()).not.toContain("⏸ 1.")
    // input cleared
    expect(t.frame()).toContain("Type to queue")
    t.destroy()
  })

  test("Shift+Enter idle is a no-op (no steer, no submit)", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("hello") })
    act(() => t.keys.pressEnter({ shift: true }))
    await t.settle()

    expect(t.gw.last("session.steer")).toBeUndefined()
    t.destroy()
  })
})
