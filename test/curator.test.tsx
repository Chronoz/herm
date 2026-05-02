import { describe, test, expect, beforeEach } from "bun:test"
import { useEffect } from "react"
import { mkdirSync, writeFileSync } from "fs"
import { hermesPath } from "../src/utils/hermes-home"
import { mountNode, until } from "./harness"
import { openCurator } from "../src/dialogs/curator"
import { useDialog } from "../src/ui/dialog"

describe("curator dialog", () => {
  beforeEach(() => {
    mkdirSync(hermesPath("logs/curator/20260501-100000"), { recursive: true })
    writeFileSync(
      hermesPath("logs/curator/20260501-100000/REPORT.md"),
      "# Curator Run\n\n- pruned `dead-skill`\n- **3 stale** flagged\n",
    )
    mkdirSync(hermesPath("skills"), { recursive: true })
    writeFileSync(
      hermesPath("skills/.curator_state"),
      JSON.stringify({
        run_count: 2,
        last_run_at: "2026-05-01T10:00:00Z",
        last_run_summary: "auto: 2 marked stale; llm: tightened `foo-skill`",
        paused: false,
      }),
    )
  })

  const Open = () => {
    const d = useDialog()
    useEffect(() => openCurator(d), [])
    return null
  }

  test("REPORT.md renders via <markdown> (headings styled, not raw #)", async () => {
    const t = await mountNode(<Open />, { width: 130, height: 40 })
    await until(t, () => t.frame().includes("Curator Run"))
    // Heading marker concealed by the markdown renderable; plain <text>
    // would have shown the literal "# ".
    expect(t.frame()).not.toMatch(/#\s+Curator Run/)
    expect(t.frame()).toContain("pruned")
    expect(t.frame()).toContain("2 runs")
    // last_run_summary also goes through <markdown> — backticks concealed.
    expect(t.frame()).toContain("foo-skill")
    expect(t.frame()).not.toContain("`foo-skill`")
    // Bordered scrollbox around the report body.
    expect(t.frame()).toMatch(/│.*pruned/)
    t.destroy()
  })
})
