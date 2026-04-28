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

  // '/' collapses the categories pane and hoists the query row above
  // the results shell so placement matches scope (all entries). Each
  // hit carries its resolved category badge.
  test("search: single-pane, query row above, category badge per hit", async () => {
    const cfg = {
      terminal: { backend: "local" },
      memory: { provider: "sqlite" },
      logging: { level: "INFO" },
    }
    const gw = new MockGateway({ "config.get": () => ({ config: cfg }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("terminal"))
    const panes = () => t.frame().split("\n")
      .filter(l => l.includes("┌")).flatMap(l => l.match(/┌/g)!).length

    expect(panes()).toBe(2)
    expect(t.frame()).toContain("Config")

    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    expect(panes()).toBe(1)
    expect(t.frame()).toContain("Category")
    // Query row sits above the results shell border.
    const lines = t.frame().split("\n")
    expect(lines.findIndex(l => l.includes("┃"))).toBeLessThan(lines.findIndex(l => l.includes("┌")))

    await act(async () => { await t.keys.typeText("prov") })
    await t.settle()
    expect(t.frame()).toMatch(/memory\s+provider/)
    expect(t.frame()).not.toContain("backend")
    expect(t.frame()).toContain("1 of 3")

    act(() => t.keys.pressEscape())
    await t.settle()
    expect(panes()).toBe(2)
    expect(t.frame()).not.toContain("Category")
    t.destroy()
  })
})
