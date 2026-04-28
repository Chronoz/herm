import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until, MockGateway } from "./harness"
import { Cron } from "../src/tabs/Cron"

const HH = process.env.HERMES_HOME!
const iso = (dsec: number) => new Date(Date.now() + dsec * 1000).toISOString()
const ago = (s: number) => iso(-s)
const hence = (s: number) => iso(s)

const JOBS = [
  {
    job_id: "a1b2c3", name: "nightly-digest", schedule: "0 9 * * *",
    enabled: true, state: "scheduled", deliver: "discord",
    last_run_at: ago(3600), next_run_at: hence(7200),
    last_status: "ok", model: "claude-opus", workdir: "/tmp/proj",
    prompt: "Summarize yesterday's commits",
  },
  {
    job_id: "d4e5f6", name: "broken-job", schedule: "every 30m",
    enabled: true, state: "scheduled", deliver: "local",
    last_run_at: ago(600), next_run_at: hence(1200),
    last_status: "error", last_delivery_error: "timeout",
    prompt: "Fetch feed",
  },
  {
    job_id: "g7h8i9", name: "disabled-one", schedule: "every 1h",
    enabled: false, state: "scheduled", deliver: "local",
    paused_reason: "manual", prompt: "noop",
  },
]

const mk = () => new MockGateway({
  "cron.manage": (p) => p.action === "list" ? { jobs: JOBS } : { ok: true },
})

describe("Cron tab", () => {
  test("renders jobs with enabled/disabled glyphs and detail pane", async () => {
    const gw = mk()
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (3)"))

    const f = t.frame()
    expect(f).toContain("● nightly-digest")
    expect(f).toContain("● broken-job")
    expect(f).toContain("○ disabled-one")
    // Dead state==="error" ERR tag is gone
    expect(f).not.toMatch(/broken-job.*ERR/)

    // Detail panel for sel=0 shows conditional fields
    expect(f).toContain("Model")
    expect(f).toContain("claude-opus")
    expect(f).toContain("Workdir")
    expect(f).toContain("/tmp/proj")
    // No skills on job 0 → row hidden
    expect(f).not.toContain("Skills")
    // last_status surfaced in Last Run row
    expect(f).toMatch(/Last Run\s+.*·\s+ok/)
    t.destroy()
  })

  test("Enter fires cron.manage/run with selected job_id, then reloads", async () => {
    const gw = mk()
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (3)"))

    act(() => t.keys.pressArrow("down"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Queued broken-job"))

    const runs = gw.calls.filter(c => c.params.action === "run")
    expect(runs).toHaveLength(1)
    expect(runs[0]!.params.name).toBe("d4e5f6")
    // load() fires again after run
    const lists = gw.calls.filter(c => c.params.action === "list")
    expect(lists.length).toBeGreaterThanOrEqual(2)
    t.destroy()
  })

  test("down to disabled job shows paused_reason; next_run reads 'paused'", async () => {
    const gw = mk()
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (3)"))

    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("g7h8i9"))

    const f = t.frame()
    expect(f).toMatch(/Paused\s+manual/)
    expect(f).toMatch(/Next Run\s+paused/)
    // Conditional rows absent for this job
    expect(f).not.toContain("claude-opus")
    t.destroy()
  })

  test("detail pane shows last-output tail; '(none yet)' otherwise", async () => {
    const dir = join(HH, "cron", "output", "a1b2c3")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "20260426_090000.md"), "## Digest\nitem one\nitem two")

    const gw = mk()
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Last Output"))
    await until(t, () => t.frame().includes("item two"))
    expect(t.frame()).toContain("## Digest")

    // d4e5f6 has no output dir → '(none yet)'
    act(() => t.keys.pressArrow("down"))
    await until(t, () => /ID\s+d4e5f6/.test(t.frame()))
    await until(t, () => t.frame().includes("(none yet)"))
    expect(t.frame()).not.toContain("item two")
    t.destroy()
  })

  test("detail pane hidden below 140 cols", async () => {
    const gw = mk()
    const t = await mountNode(<Cron focused />, { gw, width: 120 })
    await until(t, () => t.frame().includes("Cron Jobs (3)"))
    expect(t.frame()).not.toContain("Job Detail")
    t.destroy()
  })

  // ── row-level timing + Space toggle ──────────────────────────────

  const TIMING_JOBS = [
    { job_id: "j1", name: "nightly", schedule: "0 3 * * *", enabled: true,
      last_run_at: iso(-3600), next_run_at: iso(1800) },
    { job_id: "j2", name: "paused-job", schedule: "every 1h", enabled: false,
      last_run_at: iso(-120), next_run_at: iso(60) },
    { job_id: "j3", name: "overdue", schedule: "every 5m", enabled: true,
      next_run_at: iso(-30) },
  ]

  test("renders rows; next uses until() for future, 'due' for past, 'paused' when disabled", async () => {
    const gw = new MockGateway({ "cron.manage": () => ({ jobs: TIMING_JOBS }) })
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
        if (p.action === "list") return { jobs: TIMING_JOBS }
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
