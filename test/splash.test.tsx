import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"
import { openStateDb } from "./fixtures/state-db"
import { resetDb } from "../src/utils/sessions-db"

const seed = (last?: { id: string; title: string }) => {
  const db = openStateDb()
  db.run("DELETE FROM messages"); db.run("DELETE FROM sessions")
  if (last) db.prepare(
    "INSERT INTO sessions (id, title, source, started_at, message_count) VALUES (?,?,?,?,?)",
  ).run(last.id, last.title, "tui", 1000, 3)
  db.close()
  resetDb()
}

describe("splash (herm-tji.2)", () => {
  afterAll(() => seed())

  test("mode:new → splash renders frame + wordmark; composer is live", async () => {
    seed()
    const t = await mount({ launch: { mode: "new", splash: true } })
    await until(t, () => t.frame().includes("HERM") || /[⠁-⣿]/.test(t.frame()))
    expect(/[⠁-⣿]/.test(t.frame())).toBe(true)       // braille frame
    expect(t.frame()).toMatch(/v0\.\d+\.\d+/)         // sub-line
    expect(t.frame()).toContain("Ready")              // composer still live
    expect(t.frame()).not.toContain("continue \"")     // no lastReal
    t.destroy()
  })

  test("first send dismisses; prompt.submit fires", async () => {
    seed()
    const t = await mount({ launch: { mode: "new", splash: true } })
    await until(t, () => /[⠁-⣿]/.test(t.frame()))
    await act(async () => { await t.keys.typeText("hello") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => !/[⠁-⣿]/.test(t.frame()))
    expect(t.gw.last("prompt.submit")?.params.text).toBe("hello")
    t.destroy()
  })

  test("lastReal present → continue-prompt; empty-Enter resumes", async () => {
    seed({ id: "prev-sid", title: "fix the latex bug" })
    const t = await mount({ launch: { mode: "new", splash: true } })
    await until(t, () => t.frame().includes("fix the latex bug"))
    expect(t.frame()).toContain("[enter]")
    act(() => t.keys.pressEnter())
    await until(t, () => !/[⠁-⣿]/.test(t.frame()))
    expect(t.gw.last("session.resume")?.params.session_id).toBe("prev-sid")
    expect(t.gw.calls.some(c => c.method === "prompt.submit")).toBe(false)
    t.destroy()
  })

  test("typing hides continue-prompt (doesn't dismiss splash)", async () => {
    seed({ id: "prev-sid", title: "fix the latex bug" })
    const t = await mount({ launch: { mode: "new", splash: true } })
    await until(t, () => t.frame().includes("fix the latex bug"))
    await act(async () => { await t.keys.typeText("h") })
    await t.settle()
    expect(t.frame()).not.toContain("fix the latex bug")
    expect(/[⠁-⣿]/.test(t.frame())).toBe(true)        // splash still up
    t.destroy()
  })

  test("mode:resume → no splash at all", async () => {
    seed({ id: "prev-sid", title: "x" })
    const t = await mount({ launch: { mode: "resume" } })
    await until(t, () => t.frame().includes("Ready"))
    expect(/[⠁-⣿]/.test(t.frame())).toBe(false)
    t.destroy()
  })
})
