import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Toolsets } from "../src/tabs/Toolsets"

const SETS = [
  { name: "files", description: "read/write files", tool_count: 7, enabled: true },
  { name: "web", description: "search & fetch", tool_count: 2, enabled: false },
]

describe("Toolsets tab", () => {
  test("loads from toolsets.list and renders state glyphs", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: SETS }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (2)"))
    const f = t.frame()
    expect(f).toContain("● files")
    expect(f).toContain("○ web")
    expect(f).toContain("Space toggle")
    t.destroy()
  })

  test("Space → tools.configure with correct action + names", async () => {
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: SETS }) })
    const t = await mountNode(<Toolsets focused />, { gw })
    await until(t, () => t.frame().includes("Toolsets (2)"))

    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    const c1 = t.gw.last("tools.configure")
    expect(c1?.params).toMatchObject({ action: "disable", names: ["files"] })

    act(() => t.keys.pressArrow("down"))
    await t.settle()
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    const c2 = t.gw.last("tools.configure")
    expect(c2?.params).toMatchObject({ action: "enable", names: ["web"] })
    t.destroy()
  })
})
