import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Sessions } from "../src/tabs/Sessions"

const ROWS = [
  { id: "sid-a", title: "First session", preview: "hey", message_count: 4, started_at: 1700000000, source: "tui" },
  { id: "sid-b", title: "Second session", preview: "", message_count: 12, started_at: 1699999000, source: "cli" },
]

describe("Sessions tab", () => {
  test("lists from session.list RPC and switches on Enter", async () => {
    const gw = new MockGateway({ "session.list": () => ({ sessions: ROWS }) })
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

  test("/ opens search, queries session.search RPC, Enter switches to hit", async () => {
    const gw = new MockGateway({
      "session.list": () => ({ sessions: ROWS }),
      "session.search": p => ({
        results: [{
          session_id: "sid-hit", title: `Match for ${p.query}`,
          snippet: "…found >>>needle<<< here…", role: "user",
          source: "tui", model: "test-model", started_at: 1700000000,
        }],
      }),
    })
    let switched = ""
    const t = await mountNode(
      <Sessions focused onSwitch={sid => { switched = sid }} />,
      { gw },
    )
    await until(t, () => t.frame().includes("Sessions (2)"))

    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    expect(t.frame()).toContain("Search Results")

    await act(async () => { await t.keys.typeText("needle") })
    await until(t, () => t.frame().includes("Match for needle"))

    expect(t.gw.last("session.search")?.params.query).toBe("needle")
    // snippet highlight markers stripped from display
    expect(t.frame()).not.toContain(">>>")

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(switched).toBe("sid-hit")

    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Sessions (2)"))
    t.destroy()
  })

  test("search drops stale responses (out-of-order resolution)", async () => {
    let resolveA!: (v: unknown) => void
    const gw = new MockGateway({
      "session.list": () => ({ sessions: ROWS }),
      "session.search": p => p.query === "a"
        ? new Promise(r => { resolveA = r })
        : { results: [{ session_id: "sid-ab", title: "AB result", snippet: "", role: "user", source: "tui", model: null, started_at: 1 }] },
    })
    const t = await mountNode(<Sessions focused />, { gw })
    await until(t, () => t.frame().includes("Sessions (2)"))

    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    await act(async () => { await t.keys.typeText("a") })
    await t.settle()
    await act(async () => { await t.keys.typeText("b") })
    await until(t, () => t.frame().includes("AB result"))

    // Now resolve the stale "a" request — must NOT clobber "ab" results.
    await act(async () => {
      resolveA({ results: [{ session_id: "sid-stale", title: "STALE", snippet: "", role: "user", source: "tui", model: null, started_at: 1 }] })
    })
    await t.settle()
    expect(t.frame()).toContain("AB result")
    expect(t.frame()).not.toContain("STALE")
    t.destroy()
  })

  test("d confirms then calls session.delete RPC and reloads", async () => {
    const deleted: string[] = []
    let listed = ROWS
    const gw = new MockGateway({
      "session.list": () => ({ sessions: listed }),
      "session.delete": p => {
        deleted.push(p.session_id as string)
        listed = listed.filter(r => r.id !== p.session_id)
        return { deleted: true }
      },
    })
    const t = await mountNode(<Sessions focused />, { gw })
    await until(t, () => t.frame().includes("Sessions (2)"))

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Session?"))
    expect(t.frame()).toContain("First session")

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => t.frame().includes("Sessions (1)"))

    expect(deleted).toEqual(["sid-a"])
    expect(t.frame()).not.toContain("First session")
    expect(t.frame()).toContain("Second session")
    t.destroy()
  })

  test("delete error surfaces toast, list unchanged", async () => {
    const gw = new MockGateway({
      "session.list": () => ({ sessions: ROWS }),
      "session.delete": () => { throw new Error("session is active") },
    })
    const t = await mountNode(<Sessions focused />, { gw })
    await until(t, () => t.frame().includes("Sessions (2)"))

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Session?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => t.frame().includes("session is active"))

    expect(t.frame()).toContain("Sessions (2)")
    t.destroy()
  })
})
