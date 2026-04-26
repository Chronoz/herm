import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Cron } from "../src/tabs/Cron"

const iso = (dsec: number) => new Date(Date.now() + dsec * 1000).toISOString()

const JOBS = [
  { job_id: "j1", name: "nightly", schedule: "0 3 * * *", enabled: true,
    last_run_at: iso(-3600), next_run_at: iso(1800) },
  { job_id: "j2", name: "paused-job", schedule: "every 1h", enabled: false,
    last_run_at: iso(-120), next_run_at: iso(60) },
  { job_id: "j3", name: "overdue", schedule: "every 5m", enabled: true,
    next_run_at: iso(-30) },
]

describe("Cron tab", () => {
  test("renders rows; next uses until() for future, 'due' for past, 'paused' when disabled", async () => {
    const gw = new MockGateway({ "cron.manage": () => ({ jobs: JOBS }) })
    const t = await mountNode(<Cron focused />, { gw, width: 180 })
    await until(t, () => t.frame().includes("Cron Jobs (3)"))

    const f = t.frame()
    const row = (name: string) => f.split("\n").find(l => l.includes(name))!

    expect(row("nightly")).toContain("last: 1h ago")
    expect(row("nightly")).toMatch(/next: in (29|30)m/)
    expect(row("paused-job")).toContain("next: paused")
    expect(row("overdue")).toContain("next: due")
    // Bug the fix addresses: future ts must NOT render as "just now".
    expect(row("nightly")).not.toContain("next: just now")
    t.destroy()
  })

  test("Space toggles enabled via cron.manage pause/resume", async () => {
    let paused = ""
    const gw = new MockGateway({
      "cron.manage": p => {
        if (p.action === "list") return { jobs: JOBS }
        if (p.action === "pause" || p.action === "resume") { paused = `${p.action}:${p.name}`; return {} }
        return {}
      },
    })
    const t = await mountNode(<Cron focused />, { gw, width: 180 })
    await until(t, () => t.frame().includes("nightly"))

    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(paused).toBe("pause:j1")
    t.destroy()
  })
})
