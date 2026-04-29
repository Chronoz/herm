import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Sidebar } from "../src/components/sidebar/Sidebar"

const INFO = {
  model: "test-model-v9",
  cwd: "/home/t",
  tools: { file: ["read", "write"], web: ["search"] },
  skills: { dev: ["a"] },
  mcp_servers: [
    { name: "linear", connected: true, transport: "stdio", tools: 5 },
    { name: "broken", connected: false, transport: "stdio", tools: 0 },
  ],
}

describe("Sidebar", () => {
  test("title above Agent, no Identity wrapper, no Tools row, no Stats/Memory/Recent", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} title="my session" />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Hermes"))

    const f = t.frame()

    // Title prepended, muted "Title" label + strong value
    expect(f).toContain("Title")
    expect(f).toContain("my session")

    // Identity rows render flat (no ▾/▸ Identity wrapper)
    expect(f).not.toContain("Identity")
    expect(f).toContain("test-model-v9")

    // Tools row removed, Skills stays
    expect(f).not.toMatch(/^\s*Tools\s/m)
    expect(f).toContain("Skills")

    // Removed sections
    expect(f).not.toContain("▸ Stats")
    expect(f).not.toContain("▸ Memory")
    expect(f).not.toContain("▸ Recent")
    expect(f).not.toContain("Est. cost")

    // Operational sections still present (collapsed by default now)
    expect(f).toContain("▸ MCP")

    // State label at bottom
    expect(f).toContain("idle")
    t.destroy()
  })

  test("title omitted when not provided", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Hermes"))
    expect(t.frame()).not.toContain("Title")
    t.destroy()
  })

  test("MCP section toggles on header click", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("▸ MCP"))

    const find = (needle: string) => {
      const lines = t.frame().split("\n")
      const y = lines.findIndex(l => l.includes(needle))
      return { x: lines[y].indexOf(needle), y }
    }

    let p = find("▸ MCP")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▾ MCP"))
    expect(t.frame()).toContain("● linear")
    expect(t.frame()).toContain("○ broken")

    p = find("▾ MCP")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▸ MCP"))
    expect(t.frame()).not.toContain("● linear")
    t.destroy()
  })
})
