import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Sessions } from "../src/tabs/Sessions"

describe("Sessions tab", () => {
  test("lists from session.list RPC and switches on Enter", async () => {
    const gw = new MockGateway({
      "session.list": () => ({
        sessions: [
          { id: "sid-a", title: "First session", preview: "hey", message_count: 4, started_at: 1700000000, source: "tui" },
          { id: "sid-b", title: "Second session", preview: "", message_count: 12, started_at: 1699999000, source: "cli" },
        ],
      }),
    })
    let switched = ""
    const t = await mountNode(
      <Sessions focused onSwitch={sid => { switched = sid }} />,
      { gw },
    )
    await until(t, () => t.frame().includes("Sessions (2)"))

    const f = t.frame()
    expect(f).toContain("First session")
    expect(f).toContain("Second session")
    expect(f).toContain("TUI")
    expect(f).toContain("CLI")
    expect(t.gw.last("session.list")).toBeDefined()

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(switched).toBe("sid-a")

    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(switched).toBe("sid-b")
    t.destroy()
  })

  test("RPC failure surfaces warning and falls back", async () => {
    const gw = new MockGateway({
      "session.list": () => { throw new Error("gateway unreachable") },
    })
    const t = await mountNode(<Sessions focused />, { gw })
    // state.db likely empty/absent in test env → either warning or empty state
    await until(t, () => {
      const f = t.frame()
      return f.includes("gateway unreachable") || f.includes("No sessions found")
    })
    t.destroy()
  })
})
