import { describe, test, expect } from "bun:test"
import { mountNode } from "./harness"
import { KV } from "../src/ui/kv"

describe("ui/kv", () => {
  test("default KV truncates at one line", async () => {
    const t = await mountNode(
      <box width={40}><KV label="Model" value={"x".repeat(100)} /></box>,
      { width: 50, height: 10 },
    )
    await t.settle()
    const lines = t.frame().split("\n").filter(l => l.includes("x"))
    expect(lines.length).toBe(1)
    t.destroy()
  })

  test("wrap KV word-wraps inside the value column, not to x=0", async () => {
    const t = await mountNode(
      <box width={40}><KV label="First msg" value={"alpha beta gamma delta epsilon zeta eta"} wrap /></box>,
      { width: 50, height: 10 },
    )
    await t.settle()
    const lines = t.frame().split("\n")
    const labelY = lines.findIndex(l => l.includes("First msg"))
    const valX = lines[labelY].indexOf("alpha")
    expect(valX).toBe(13) // label width
    // Continuation line starts at same x, not column 0.
    const contY = lines.findIndex((l, i) => i > labelY && /\w/.test(l))
    expect(lines[contY].search(/\w/)).toBe(valX)
    t.destroy()
  })

  test("label column width leaves ≥2 gap for longest label in use", async () => {
    const t = await mountNode(
      <box width={40}><KV label="Last active" value="now" /></box>,
      { width: 50, height: 5 },
    )
    await t.settle()
    const line = t.frame().split("\n").find(l => l.includes("Last active"))!
    expect(line).toMatch(/Last active  now/)
    t.destroy()
  })
})
