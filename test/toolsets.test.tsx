import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Toolsets } from "../src/tabs/Toolsets"

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")

const SETS = [
  { name: "file", description: "read/write files", tool_count: 7, enabled: true },
  { name: "web", description: "search & fetch", tool_count: 2, enabled: false },
  { name: "hermes-cli", description: "cli platform bundle", tool_count: 38, enabled: true },
  { name: "hermes-discord", description: "discord platform bundle", tool_count: 40, enabled: false },
  { name: "mcp:linear", description: "linear mcp", tool_count: 5, enabled: true },
]

describe("Toolsets tab", () => {
  test("groups by core/platform/mcp with ─ section headers", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: SETS }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (5)"))
    const f = strip(t.frame())
    expect(f).toContain("─ core (2)")
    expect(f).toContain("─ platform bundles (2)")
    expect(f).toContain("─ mcp (1)")
    t.destroy()
  })

  test("renders status glyphs", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: SETS }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (5)"))
    const f = strip(t.frame())
    expect(f).toContain("● file")
    expect(f).toContain("○ web")
    expect(f).toContain("Space toggle")
    // no expand affordance now that detail pane is the single surface
    expect(f).not.toMatch(/\bexpand\b/)
    t.destroy()
  })

  test("Space → tools.configure with correct action + names in flat order", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: SETS }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (5)"))

    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.gw.last("tools.configure")?.params)
      .toMatchObject({ action: "disable", names: ["file"] })

    act(() => t.keys.pressArrow("down"))
    await t.settle()
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.gw.last("tools.configure")?.params)
      .toMatchObject({ action: "enable", names: ["web"] })

    // ↓ crosses the section header into platform bundles
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.gw.last("tools.configure")?.params)
      .toMatchObject({ action: "disable", names: ["hermes-cli"] })
    t.destroy()
  })

  test("available=false → ◌ glyph, 'unavailable' status, Space refuses", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: [
      { name: "spotify", description: "music", tool_count: 7, enabled: false, available: false },
    ] }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (1)"))
    const f = strip(t.frame())
    expect(f).toContain("◌ spotify")
    expect(f).toContain("unavailable")
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(t.gw.last("tools.configure")).toBeUndefined()
    t.destroy()
  })

  test("detail pane shows includes/requirements/tools when wire provides them", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: [
      { name: "safe", description: "read-only bundle", tool_count: 5, enabled: true,
        includes: ["web", "vision"], requirements: ["EXA_API_KEY"],
        tools: ["web_search", "web_extract", "vision_analyze"] },
    ] }) })
    const t = await mountNode(<Toolsets focused />, { gw, width: 180 })
    await until(t, () => t.frame().includes("Toolsets (1)"))
    const f = strip(t.frame())
    expect(f).toContain("web, vision")
    expect(f).toContain("EXA_API_KEY")
    expect(f).toContain("Tools (3):")
    expect(f).toContain("· web_search")
    t.destroy()
  })

  // o3d: scroll follows selection at the viewport edge. With 30 rows in
  // a short viewport, row-29 is clipped; End key → selection jumps to it
  // and scrollChildIntoView brings it into frame.
  test("scroll follows selection (End reveals last row)", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `ts-${String(i).padStart(2, "0")}`, description: "", tool_count: i, enabled: true,
    }))
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: many }) })
    const t = await mountNode(<Toolsets focused />, { gw, width: 160, height: 18 })
    await until(t, () => t.frame().includes("Toolsets (30)"))
    expect(strip(t.frame())).not.toContain("ts-29")

    act(() => t.keys.pressKey("END"))
    await t.settle(); await t.settle()
    const f = strip(t.frame())
    expect(f).toContain("▸ ● ts-29")
    expect(f).not.toContain("ts-00")
    t.destroy()
  })
})
