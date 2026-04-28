import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "node:fs"
import { mountNode, until, MockGateway } from "./harness"
import { hermesPath } from "../src/utils/hermes-home"
import { Skills } from "../src/tabs/Skills"

describe("Skills tab", () => {
  test("enriches description/tags from SKILL.md frontmatter on disk", async () => {
    const dir = hermesPath("skills/general/local-skill")
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/SKILL.md`,
      "---\nname: local-skill\ndescription: A test skill description\ntags: [alpha, beta]\n---\n\nbody")
    const gw = new MockGateway({
      "skills.manage": p => p.action === "list"
        ? { skills: { general: ["local-skill"] } } : {},
    })
    const t = await mountNode(<Skills focused />, { gw, width: 160 })
    await until(t, () => t.frame().includes("Skills (1)"))
    const row = t.frame().split("\n").find(l => l.includes("▸ local-skill"))!
    expect(row).toContain("A test skill description")
    // Detail pane shows tags.
    expect(t.frame()).toMatch(/Tags\s+alpha, beta/)
    t.destroy()
  })

  test("/ searches hub, Enter→confirm→install reloads", async () => {
    const installed: string[] = []
    const gw = new MockGateway({
      "skills.manage": p => {
        if (p.action === "list") return { skills: { general: ["local-skill"] } }
        if (p.action === "search") return {
          results: [
            { name: `hub-${p.query}`, description: "remote pkg" },
            { name: "other-pkg", description: "second" },
          ],
        }
        if (p.action === "install") { installed.push(p.query as string); return { ok: true } }
        return {}
      },
    })
    const t = await mountNode(<Skills focused />, { gw, width: 160, height: 40 })
    await until(t, () => t.frame().includes("Skills (1)"))
    expect(t.frame()).toContain("local-skill")

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("Hub Search"))

    await act(async () => { await t.keys.typeText("net") })
    await until(t, () => t.frame().includes("hub-net"))
    expect(t.frame()).toContain("remote pkg")

    const last = t.gw.last("skills.manage")
    expect(last?.params.action).toBe("search")
    expect(last?.params.query).toBe("net")

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Install skill?"))
    expect(t.frame()).toContain("hub-net")

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => installed.length > 0)
    expect(installed).toEqual(["hub-net"])
    await until(t, () => t.frame().includes("Installed hub-net"))
    // search exited, list reloaded
    await until(t, () => t.frame().includes("Skills (1)"))
    t.destroy()
  })

  test("hub search drops stale responses", async () => {
    let hold!: (v: unknown) => void
    const gw = new MockGateway({
      "skills.manage": p => {
        if (p.action === "list") return { skills: {} }
        if (p.action === "search") return p.query === "a"
          ? new Promise(r => { hold = r })
          : { results: [{ name: "fresh-ab", description: "" }] }
        return {}
      },
    })
    const t = await mountNode(<Skills focused />, { gw })
    await until(t, () => t.frame().includes("Skills (0)"))

    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    await act(async () => { await t.keys.typeText("a") })
    await until(t, () => !!hold)
    await act(async () => { await t.keys.typeText("b") })
    await until(t, () => t.frame().includes("fresh-ab"))

    await act(async () => { hold({ results: [{ name: "STALE", description: "" }] }) })
    await t.settle()
    expect(t.frame()).toContain("fresh-ab")
    expect(t.frame()).not.toContain("STALE")
    t.destroy()
  })
})
