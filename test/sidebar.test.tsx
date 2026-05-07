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
  test("renders avatar and MCP section", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("▸ MCP"))

    const f = t.frame()
    expect(f).toContain("▸ MCP")
    expect(f).toContain("1/2 up")
    expect(f).not.toContain("Title")
    expect(f).not.toContain("Profile")
    expect(f).not.toContain("Model")
    expect(f).not.toContain("Branch")
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

  test("no MCP section when no servers", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const info = { ...INFO, mcp_servers: [] }
    const t = await mountNode(
      <Sidebar agentState="idle" info={info} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    expect(t.frame()).not.toContain("MCP")
    t.destroy()
  })

  test("renders goal dashboard when goal prop provided", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const goal = { goal: "ship it", status: "active" as const, turn_count: 3, max_turns: 10 }
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} goal={goal} usage={{ input: 1, output: 1, total: 2, context_used: 5000, context_max: 200000 }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Status     active")
    expect(f).toContain("Turns 3 / 10")
    expect(f).toContain("Objective")
    expect(f).toContain("ship it")
    expect(f).toContain("Context    5.0K / 200K (3%)")
    t.destroy()
  })

  test("hides goal dashboard when status is cleared", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const goal = { goal: "ship it", status: "cleared" as const }
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} goal={goal} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    expect(t.frame()).not.toContain("Objective")
    expect(t.frame()).not.toContain("ship it")
    t.destroy()
  })

  test("truncates long goals to 3 lines", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const longGoal = "a".repeat(200)
    const goal = { goal: longGoal, status: "active" as const }
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} goal={goal} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Objective")
    // First line: "Objective  " + 33 chars = 44 chars total (INNER width)
    expect(f).toContain("Objective  " + "a".repeat(33))
    // Should have "..." on the last visible line due to truncation
    expect(f).toContain("...")
    t.destroy()
  })

  test("renders done status in success color", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const goal = { goal: "ship it", status: "done" as const }
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} goal={goal} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Status     done")
    expect(f).toContain("Objective")
    t.destroy()
  })

  test("renders OpenCode activity card with context bar", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="working" info={INFO} pulse={true}
        usage={{ input: 1, output: 1, total: 2, context_used: 39000, context_max: 262000 }}
        ocActivity={{ stage: "testing", task: "Fix sidebar refresh", model: "moonshotai/kimi-k2.6", startedAt: Date.now(), seen: ["starting", "testing"], status: "running" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Objective  Fix sidebar refresh")
    expect(f).toMatch(/OpenCode\s+\[running\]\s+\d/)
    expect(f).toContain("kimi-k2.6")
    expect(f).toContain("39K/262K 15%")
    expect(f).toMatch(/\[█+░+\]/)
    expect(f).not.toContain("Stage")
    expect(f).not.toContain("Time")
    t.destroy()
  })

  test("OpenCode card shows done when pulse is false", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} pulse={false}
        ocActivity={{ stage: "done", task: "Ship it", model: "openai/gpt-4", startedAt: Date.now() - 120000, seen: ["starting"], status: "done", result: "done" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toMatch(/OpenCode\s+\[done\]/)
    expect(f).toContain("Result     done")
    expect(f).not.toContain("Time")
    expect(f).not.toContain("Stage")
    t.destroy()
  })

  test("OpenCode card shows model on second line", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="working" info={INFO} pulse={true}
        ocActivity={{ stage: "reviewing", task: "Read files", model: "anthropic/claude-3", startedAt: Date.now(), seen: ["starting", "reviewing"], status: "running" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Objective  Read files")
    expect(f).toMatch(/OpenCode\s+\[running\]/)
    expect(f).toContain("claude-3")
    expect(f).not.toContain("Stage")
    expect(f).not.toContain("Time")
    t.destroy()
  })

  test("OpenCode card shows blocked status", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} pulse={false}
        ocActivity={{ stage: "done", task: "Ship it", model: "openai/gpt-4", startedAt: Date.now() - 120000, seen: ["starting"], status: "blocked", result: "OpenCode blocked" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toMatch(/OpenCode\s+\[blocked\]/)
    expect(f).toContain("Result     OpenCode blocked")
    t.destroy()
  })

  test("OpenCode card shows error status with fallback result", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} pulse={false}
        ocActivity={{ stage: "done", task: "Fix bug", model: "openai/gpt-4", startedAt: Date.now() - 120000, seen: ["starting", "editing", "testing"], status: "error", fallbackUsed: true, result: "OpenCode error; Hermes edited + tested" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toMatch(/OpenCode\s+\[error\]/)
    expect(f).toContain("Result     OpenCode error; Hermes edited + ")
    t.destroy()
  })

  test("OpenCode objective wraps to 2 lines max with ellipsis", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const longTask = "a".repeat(100)
    const t = await mountNode(
      <Sidebar agentState="working" info={INFO} pulse={true}
        ocActivity={{ stage: "testing", task: longTask, model: "moonshotai/kimi-k2.6", startedAt: Date.now(), seen: ["starting", "testing"], status: "running" }} />,
      { gw, width: 160, height: 48 },
    )
    await act(async () => {})
    const f = t.frame()
    expect(f).toContain("Objective")
    const lines = f.split("\n")
    const objLines = lines.filter(l => l.includes("a".repeat(10)))
    expect(objLines.length).toBe(2)
    expect(f).toContain("...")
    const ocLine = lines.find(l => l.includes("OpenCode"))!
    expect(ocLine).not.toContain("a".repeat(5))
    expect(ocLine).toMatch(/OpenCode\s+\[running\]\s+\d/)
    t.destroy()
  })
})
