import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { Sidebar } from "../src/components/sidebar/Sidebar"

const INFO = {
  model: "test-model-v9",
  cwd: "/home/t",
  tools: { file: ["read", "write"], web: ["search"] },
  skills: { dev: ["a"] },
}

describe("Sidebar", () => {
  test("Identity open by default; other sections collapsed", async () => {
    const t = await mountNode(<Sidebar agentState="idle" info={INFO} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Identity"))

    const f = t.frame()
    // Identity body rows visible
    expect(f).toContain("▾ Identity")
    expect(f).toContain("test-model-v9")
    expect(f).toContain("Tools")
    expect(f).toMatch(/Tools\s+3/)      // 2 + 1
    // Other headers present but collapsed
    expect(f).toContain("▸ Stats")
    expect(f).toContain("▸ Memory")
    expect(f).toContain("▸ Recent")
    // Collapsed section's body rows NOT visible
    expect(f).not.toContain("Est. cost")
    // State label at bottom, no debug list
    expect(f).toContain("idle")
    expect(f).not.toContain("listening")
    t.destroy()
  })

  test("clicking a header toggles its section", async () => {
    const t = await mountNode(<Sidebar agentState="idle" info={INFO} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("▸ Stats"))

    const find = (needle: string) => {
      const lines = t.frame().split("\n")
      const y = lines.findIndex(l => l.includes(needle))
      return { x: lines[y].indexOf(needle), y }
    }

    // Open Stats
    let p = find("▸ Stats")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▾ Stats"))

    let f = t.frame()
    expect(f).toContain("Est. cost")
    expect(f).toContain("Messages")
    // Identity still open (independent toggles)
    expect(f).toContain("▾ Identity")

    // Close Stats
    p = find("▾ Stats")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▸ Stats"))
    expect(t.frame()).not.toContain("Est. cost")
    t.destroy()
  })
})
