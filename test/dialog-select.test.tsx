import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { DialogSelect } from "../src/ui/dialog-select"

const opts = Array.from({ length: 30 }, (_, i) => ({
  title: `Item ${String(i).padStart(2, "0")}`,
  value: `v${i}`,
}))

describe("DialogSelect", () => {
  test("arrow-down past viewport scrolls selection into view", async () => {
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={() => {}} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    // 16-row viewport → item 20 starts off-screen.
    expect(t.frame()).not.toContain("Item 20")
    act(() => { for (let i = 0; i < 20; i++) t.keys.pressArrow("down") })
    await t.settle()
    expect(t.frame()).toContain("Item 20")
    // Top of list scrolled off.
    expect(t.frame()).not.toContain("Item 00")
    t.destroy()
  })

  test("scrollbar sits beside content (root is row, not column)", async () => {
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={() => {}} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    // Scrollbar track glyph is on the SAME line as a visible row.
    const row = t.frame().split("\n").find(l => l.includes("Item 00"))!
    expect(/[▲▼║│┃█▐]/.test(row)).toBe(true)
    t.destroy()
  })
})
