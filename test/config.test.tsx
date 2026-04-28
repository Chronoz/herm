import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Config } from "../src/tabs/Config"

const CFG = { terminal: { backend: "local", debug: false } }

describe("Config tab", () => {
  test("toggle dirties; title shows count; Ctrl+S confirms diff then config.set", async () => {
    const gw = new MockGateway({
      "config.get": () => ({ config: CFG }),
      "config.set": () => ({ ok: true }),
    })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("terminal"))

    // Move to terminal category → fields pane → debug row → Space.
    act(() => { for (let i = 0; i < 2; i++) t.keys.pressArrow("down") })
    act(() => t.keys.pressArrow("right"))
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    await act(async () => { await t.keys.typeText(" ") })
    await until(t, () => t.frame().includes("1 unsaved"))
    expect(t.frame()).toContain("✓ ON")

    // Ctrl+S → confirm diff dialog.
    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("Write 1 change to config.yaml?"))
    expect(t.frame()).toContain("terminal.debug: false → true")

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => t.frame().includes("Config saved"))
    const c = gw.last("config.set")
    expect(c?.params).toMatchObject({ key: "terminal.debug", value: true })
    // Pill cleared.
    expect(t.frame()).not.toContain("unsaved")
    t.destroy()
  })

  test("Ctrl+S with no changes toasts 'No changes', no dialog", async () => {
    const gw = new MockGateway({ "config.get": () => ({ config: CFG }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("terminal"))
    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("No changes"))
    expect(t.frame()).not.toContain("Write")
    expect(gw.last("config.set")).toBeUndefined()
    t.destroy()
  })
})
