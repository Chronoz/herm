import { describe, test, expect, afterEach } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Config } from "../src/tabs/Config"
import { buildFields, groupOf, sections, GROUPS } from "../src/config"

type H = Awaited<ReturnType<typeof mountNode>>

/** Navigate sidebar to <group>, then fields-pane to the row for <key>. */
const navTo = async (t: H, cfg: Record<string, unknown>, key: string) => {
  const g = groupOf(key)
  const gi = GROUPS.indexOf(g)
  const rows = sections(g, buildFields(cfg).filter(f => groupOf(f.key) === g))
    .flatMap(s => s.items)
  const ri = rows.findIndex(f => f.key === key)
  if (gi < 0 || ri < 0) throw new Error(`navTo: ${key} not found (group=${g})`)
  act(() => { for (let i = 0; i < gi; i++) t.keys.pressArrow("down") })
  act(() => t.keys.pressArrow("right"))
  act(() => { for (let i = 0; i < ri; i++) t.keys.pressArrow("down") })
  await t.settle()
}

describe("Config tab", () => {
  afterEach(() => { delete process.env.HERMES_MANAGED })

  test("every schema key renders; defaults shown with empty user config", async () => {
    const gw = new MockGateway({ "config.get": () => ({ config: {} }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    for (const g of ["general", "agent", "terminal", "compression", "platforms"])
      expect(t.frame()).toContain(g)
    await navTo(t, {}, "compression.threshold")
    expect(t.frame()).toMatch(/threshold\s+0\.5/)
    // Doc line under selected row.
    const lines = t.frame().split("\n")
    const i = lines.findIndex(l => l.includes("▸") && l.includes("threshold"))
    expect(lines[i + 1]).toMatch(/compress when/i)
    t.destroy()
  })

  test("user-set value shows '·' gutter dot; default doesn't", async () => {
    const cfg = { compression: { threshold: 0.7 } }
    const gw = new MockGateway({ "config.get": () => ({ config: cfg }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    await navTo(t, cfg, "compression.threshold")
    const lines = t.frame().split("\n")
    const thr = lines.find(l => l.includes("threshold") && l.includes("0.7"))!
    const ratio = lines.find(l => l.includes("target_ratio"))!
    expect(thr).toMatch(/·\s+▸?\s*threshold/)
    expect(ratio).not.toContain("·")
    t.destroy()
  })

  test("list/dict key is read-only: '<N items>' + 🔒, Enter is a no-op", async () => {
    const cfg = { terminal: { docker_volumes: ["/a:/b", "/c:/d"] } }
    const gw = new MockGateway({ "config.get": () => ({ config: cfg }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    await navTo(t, cfg, "terminal.docker_volumes")
    expect(t.frame()).toContain("2 items")
    expect(t.frame()).toContain("🔒")
    expect(t.frame()).toContain("⟳")   // restart-tier glyph on selected row
    act(() => t.keys.pressEnter())
    await t.settle()
    // v1: structured values are locked — no YAML-mode bounce, no edit buf.
    expect(t.frame()).not.toContain("Config · YAML")
    expect(t.frame()).toContain("2 items")
    t.destroy()
  })

  test("toggle dirties; Ctrl+S → cli.exec; restart-tier opens confirm", async () => {
    let cfg: Record<string, unknown> = { terminal: { container_persistent: false } }
    const gw = new MockGateway({
      "config.get": () => ({ config: cfg }),
      "cli.exec": (p) => {
        const [, , k, v] = p.argv as string[]
        if (k === "terminal.container_persistent")
          cfg = { terminal: { container_persistent: v === "true" } }
        return { blocked: false, code: 0, output: "✓" }
      },
    })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    await navTo(t, cfg, "terminal.container_persistent")
    await act(async () => { await t.keys.typeText(" ") })
    await until(t, () => t.frame().includes("1 unsaved"))
    expect(t.frame()).toContain("✓ ON")

    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("Write 1 change to config.yaml?"))
    expect(t.frame()).toContain("terminal.container_persistent: false → true")

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => gw.last("cli.exec") !== undefined)
    expect(gw.last("cli.exec")?.params.argv)
      .toEqual(["config", "set", "terminal.container_persistent", "true"])
    expect(gw.last("config.set")).toBeUndefined()

    await until(t, () => t.frame().includes("need a gateway restart"))
    expect(t.frame()).toContain("interrupts any running turn")
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()
    expect(t.frame()).not.toContain("unsaved")
    t.destroy()
  })

  test("Ctrl+S with no changes toasts 'No changes', no dialog", async () => {
    const gw = new MockGateway({ "config.get": () => ({ config: {} }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("No changes"))
    expect(t.frame()).not.toContain("Write")
    expect(gw.last("cli.exec")).toBeUndefined()
    t.destroy()
  })

  // '/' collapses the categories pane; query row sits above the results
  // shell; each hit carries its resolved group badge.
  test("search: single-pane, query row above, group badge per hit", async () => {
    const gw = new MockGateway({ "config.get": () => ({ config: {} }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    const panes = () => t.frame().split("\n")
      .filter(l => l.includes("┌")).flatMap(l => l.match(/┌/g)!).length

    expect(panes()).toBe(2)
    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    expect(panes()).toBe(1)
    expect(t.frame()).toContain("Category")
    const lines = t.frame().split("\n")
    expect(lines.findIndex(l => l.includes("┃"))).toBeLessThan(lines.findIndex(l => l.includes("┌")))

    await act(async () => { await t.keys.typeText("threshold") })
    await t.settle()
    expect(t.frame()).toMatch(/compression\s+threshold/)
    expect(t.frame()).not.toContain("max_turns")

    act(() => t.keys.pressEscape())
    await t.settle()
    expect(panes()).toBe(2)
    t.destroy()
  })

  test("inline validation: bad value blocks commit, shows error, clears on fix", async () => {
    const cfg = { agent: { max_turns: 90 } }
    const gw = new MockGateway({ "config.get": () => ({ config: cfg }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("general"))
    await navTo(t, cfg, "agent.max_turns")

    act(() => t.keys.pressEnter())
    await t.settle()
    await act(async () => { for (let i = 0; i < 2; i++) t.keys.pressBackspace() })
    await act(async () => { await t.keys.typeText("0") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("✗ expected"))
    expect(t.frame()).toContain("✗ expected 1–10000")
    expect(t.frame()).not.toContain("unsaved")

    await act(async () => { t.keys.pressBackspace() })
    await act(async () => { await t.keys.typeText("5") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(t.frame()).not.toContain("✗ expected")
    await until(t, () => t.frame().includes("1 unsaved"))
    t.destroy()
  })

  test("managed install: read-only, edits blocked, notice shown", async () => {
    process.env.HERMES_MANAGED = "nixos"
    const gw = new MockGateway({ "config.get": () => ({ config: {} }) })
    const t = await mountNode(<Config focused />, { gw, width: 160, height: 48 })
    await until(t, () => t.frame().includes("managed install"))
    expect(t.frame()).toContain("read-only · managed by NixOS")
    expect(t.frame()).toContain("configuration.nix")

    await navTo(t, {}, "terminal.container_persistent")
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.frame()).not.toContain("unsaved")
    expect(t.frame()).toContain("🔒")

    act(() => t.keys.pressKey("s", { ctrl: true }))
    await until(t, () => t.frame().includes("Managed by NixOS"))
    expect(t.frame()).not.toContain("Write")
    expect(gw.last("cli.exec")).toBeUndefined()
    expect(gw.last("config.set")).toBeUndefined()
    t.destroy()
  })
})
