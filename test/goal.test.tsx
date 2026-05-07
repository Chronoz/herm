import { describe, test, expect, beforeAll } from "bun:test"
import { act } from "react"
import { useEffect } from "react"
import { Database } from "bun:sqlite"
import { join } from "path"
import { mkdirSync } from "fs"
import { mountNode, until } from "./harness"
import { openCountdown } from "../src/dialogs/countdown"
import { useDialog } from "../src/ui/dialog"
import { goalState, resetDb } from "../src/utils/sessions-db"

// ─── goalState reader ────────────────────────────────────────────────

describe("sessions-db.goalState", () => {
  const HH = process.env.HERMES_HOME!

  beforeAll(() => {
    mkdirSync(HH, { recursive: true })
    const db = new Database(join(HH, "state.db"))
    db.run("CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT)")
    db.run("INSERT OR REPLACE INTO state_meta VALUES (?, ?)", [
      "goal:sid-done",
      JSON.stringify({ goal: "ship it", status: "done", turn_count: 3, max_turns: null }),
    ])
    db.run("INSERT OR REPLACE INTO state_meta VALUES (?, ?)", [
      "goal:sid-active", JSON.stringify({ goal: "wip", status: "active" }),
    ])
    db.close()
    resetDb() // drop any cached handle so q() reopens against the now-seeded file
  })

  test("parses done + active; null on missing", () => {
    const d = goalState("sid-done")
    expect(d?.status).toBe("done")
    expect(d?.goal).toBe("ship it")
    expect(d?.turn_count).toBe(3)
    expect(goalState("sid-active")?.status).toBe("active")
    expect(goalState("nope")).toBeNull()
  })
})

// ─── countdown dialog ────────────────────────────────────────────────

const Host = (p: { seconds: number; out: { v?: boolean } }) => {
  const dialog = useDialog()
  useEffect(() => {
    void openCountdown(dialog, {
      title: "Goal complete — suspending",
      body: "ship it",
      action: "→ systemctl suspend",
      seconds: p.seconds,
    }).then(ok => { p.out.v = ok })
  }, [])
  return null
}

describe("countdown dialog", () => {
  test("seconds=0 fires immediately", async () => {
    const out: { v?: boolean } = {}
    const t = await mountNode(<Host seconds={0} out={out} />)
    await until(t, () => out.v !== undefined)
    expect(out.v).toBe(true)
    t.destroy()
  })

  test("any key cancels before fire", async () => {
    const out: { v?: boolean } = {}
    const t = await mountNode(<Host seconds={10} out={out} />)
    await until(t, () => t.frame().includes("systemctl suspend"))
    expect(t.frame()).toContain("10s")
    expect(t.frame()).toContain("press any key to cancel")
    await act(async () => { await t.keys.typeText("x") })
    await until(t, () => out.v !== undefined)
    expect(out.v).toBe(false)
    t.destroy()
  })
})


