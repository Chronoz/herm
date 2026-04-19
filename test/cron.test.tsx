import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Cron } from "../src/tabs/Cron"

const JOBS = [
  { job_id: "cj_001", name: "digest", schedule: "every 30m", enabled: true, prompt: "summarize" },
  { job_id: "cj_002", name: "backup", schedule: "0 2 * * *", enabled: false, prompt: "snapshot" },
]

describe("Cron tab", () => {
  test("renders jobs with ●/○ state glyphs", async () => {
    const gw = new MockGateway({ "cron.manage": () => ({ jobs: JOBS }) })
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (2)"))
    const f = t.frame()
    expect(f).toContain("● digest")
    expect(f).toContain("○ backup")
    t.destroy()
  })

  test("Space on enabled job → cron.manage pause; on paused → resume", async () => {
    const calls: Array<Record<string, unknown>> = []
    const gw = new MockGateway({
      "cron.manage": p => {
        if (p.action !== "list") calls.push(p)
        return { jobs: JOBS }
      },
    })
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (2)"))

    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(calls[0]).toMatchObject({ action: "pause", name: "cj_001" })

    act(() => t.keys.pressArrow("down"))
    await t.settle()
    await act(async () => { await t.keys.typeText(" ") })
    await t.settle()
    expect(calls[1]).toMatchObject({ action: "resume", name: "cj_002" })
    t.destroy()
  })

  test("d opens confirm; y → cron.manage remove", async () => {
    const calls: Array<Record<string, unknown>> = []
    const gw = new MockGateway({
      "cron.manage": p => {
        if (p.action !== "list") calls.push(p)
        return { jobs: JOBS }
      },
    })
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (2)"))

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Job?"))
    expect(t.frame()).toContain("digest")

    await act(async () => { await t.keys.typeText("y") })
    await t.settle()
    expect(calls[0]).toMatchObject({ action: "remove", name: "cj_001" })
    t.destroy()
  })

  test("n prompts schedule then prompt → cron.manage add", async () => {
    const calls: Array<Record<string, unknown>> = []
    const gw = new MockGateway({
      "cron.manage": p => {
        if (p.action !== "list") calls.push(p)
        return { jobs: [] }
      },
    })
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (0)"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("Schedule"))
    for (const c of "every 5m") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Prompt"))
    for (const c of "ping") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await t.settle()

    expect(calls[0]).toMatchObject({ action: "add", name: "", schedule: "every 5m", prompt: "ping" })
    t.destroy()
  })
})
