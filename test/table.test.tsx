import { describe, test, expect } from "bun:test"
import { mountNode, until, MockGateway } from "./harness"
import { Col, Hdr } from "../src/ui/table"
import { Toolsets } from "../src/tabs/Toolsets"

describe("ui/table", () => {
  test("Col truncates overlong fixed-width content; grow takes remainder", async () => {
    const t = await mountNode(
      <box flexDirection="row" width={40}>
        <Col w={8}>ABCDEFGHIJKLMNOP</Col>
        <Col grow>tail</Col>
      </box>,
      { width: 50, height: 5 },
    )
    await t.settle()
    const line = t.frame().split("\n").find(l => l.includes("ABCDEFGH"))!
    // Clipped at 8 — I/J never paint, next col starts immediately after.
    expect(line).toContain("ABCDEFGHtail")
    expect(line).not.toContain("ABCDEFGHI")
    t.destroy()
  })

  test("Hdr+Col header aligns with body rows across a forced-vbar scrollbox", async () => {
    const sets = Array.from({ length: 30 }, (_, i) => ({
      name: `toolset-${i}`, description: "", tool_count: i, enabled: i % 2 === 0,
    }))
    const gw = new MockGateway({ "toolsets.list": () => ({ toolsets: sets }) })
    const t = await mountNode(<Toolsets focused />, { gw, width: 160, height: 20 })
    await until(t, () => t.frame().includes("Toolsets (30)"))

    const lines = t.frame().split("\n")
    const hdr = lines.find(l => /Name\s+Tools\s+Status/.test(l))!
    const row = lines.find(l => l.includes("● toolset-0"))!
    // Hdr's VBAR_W padding matches the scrollbox gutter → grow col at same x.
    expect(hdr.indexOf("Name")).toBe(row.indexOf("toolset-0"))
    t.destroy()
  })

  test("grow col shrinks under narrow terminal instead of bleeding", async () => {
    const long = "an_extremely_long_toolset_name_that_would_overflow_padEnd_sixteen"
    const gw = new MockGateway({
      "toolsets.list": () => ({ toolsets: [
        { name: long, description: "", tool_count: 3, enabled: true },
      ]}),
    })
    const t = await mountNode(<Toolsets focused />, { gw, width: 200, height: 20 })
    await until(t, () => t.frame().includes("Toolsets (1)"))

    // Detail panel echoes ts.name at the same y — scope to the list row (has ●).
    const row = (f: string) => f.split("\n").find(l => l.includes("● an_extremely"))!
    const wide = t.frame()
    expect(row(wide)).toContain("padEnd_sixteen")
    expect(row(wide)).toContain("3 tools")

    t.resize(90, 20)
    await t.settle(); await t.settle()
    const narrow = t.frame()
    // Name truncated; meta cols still present on the same line; no wrap.
    expect(row(narrow)).not.toContain("padEnd_sixteen")
    expect(row(narrow)).toContain("3 tools")
    expect(row(narrow)).toContain("enabled")
    expect(narrow.split("\n").filter(l => /●.*an_extremely/.test(l)).length).toBe(1)
    t.destroy()
  })
})
