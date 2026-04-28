import { describe, test, expect, afterEach } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Config } from "../src/tabs/Config"

const CFG = { terminal: { backend: "local", container_persistent: false } }

describe("Config tab", () => {
  test("toggle dirties; title shows count; Ctrl+S routes through cli.exec and reloads", async () => {
    let cfg = structuredClone(CFG)
    const gw = new MockGateway({
      "config.get": () => ({ config: cfg }),
      "cli.exec": (p) => {
        const [, , k, v] = p.argv as string[]
        if (k === "terminal.container_persistent")
          cfg = { terminal: { ...cfg.terminal, container_persistent: v === "true" } }
        return { blocked: false, code: 0, output: "✓" }
      },
    })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("terminal"))

    // Move to terminal category → fields pane → row[1] → Space.
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
    expect(t.frame()).toContain("terminal.container_persistent: false → true")

    await act(async () => { await t.keys.typeText("y") })
    // terminal.* is not whitelisted → cli lane, serialized, bool → "true".
    await until(t, () => gw.last("cli.exec") !== undefined)
    const c = gw.last("cli.exec")
    expect(c?.params.argv).toEqual(["config", "set", "terminal.container_persistent", "true"])
    expect(gw.last("config.set")).toBeUndefined()
    // terminal.* → restart tier: confirm dialog offers [restart now]/[later].
    await until(t, () => t.frame().includes("need a gateway restart"))
    expect(t.frame()).toContain("interrupts any running turn")
    expect(t.frame()).toContain("restart now")
    // Decline.
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()
    // Pill cleared after reload from disk truth.
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

  afterEach(() => { delete process.env.HERMES_MANAGED })

  test("managed install: read-only, edits blocked, notice shown", async () => {
    process.env.HERMES_MANAGED = "nixos"
    const gw = new MockGateway({ "config.get": () => ({ config: CFG }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("managed install"))
    expect(t.frame()).toContain("read-only · managed by NixOS")
    expect(t.frame()).toContain("configuration.nix")

    // Navigate to a boolean field and hit Space — should NOT dirty.
    act(() => { for (let i = 0; i < 2; i++) t.keys.pressArrow("down") })
    act(() => t.keys.pressArrow("right"))
    act(() => t.keys.pressArrow("down"))
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.frame()).not.toContain("unsaved")
    expect(t.frame()).toContain("🔒")

    // Ctrl+S short-circuits with managed toast, no confirm dialog.
    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("Managed by NixOS"))
    expect(t.frame()).not.toContain("Write")
    expect(gw.last("cli.exec")).toBeUndefined()
    expect(gw.last("config.set")).toBeUndefined()
    t.destroy()
  })

  test("inline validation: bad value blocks commit, shows error, clears on fix", async () => {
    const cfg = { agent: { max_turns: 90 } }
    const gw = new MockGateway({ "config.get": () => ({ config: cfg }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("agent"))

    // agent category → fields → row[0]=max_turns → Enter to edit.
    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressArrow("right"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await t.settle()
    // Clear buffer then type "0".
    await act(async () => { for (let i = 0; i < 2; i++) t.keys.pressBackspace() })
    await act(async () => { await t.keys.typeText("0") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("✗ expected"))
    expect(t.frame()).toContain("✗ expected 1–10000")
    // Still editing — buffer cursor visible, no dirty dot.
    expect(t.frame()).not.toContain("unsaved")

    // Fix: backspace, type "5", Enter → error clears, value commits.
    await act(async () => { t.keys.pressBackspace() })
    await act(async () => { await t.keys.typeText("5") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(t.frame()).not.toContain("✗ expected")
    await until(t, () => t.frame().includes("1 unsaved"))
    t.destroy()
  })
})
