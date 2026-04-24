import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Skills } from "../src/tabs/Skills"

describe("Skills tab", () => {
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

  test("i on installed skill opens inspect dialog", async () => {
    const gw = new MockGateway({
      "skills.manage": p => {
        if (p.action === "list") return { skills: { general: ["alpha"] } }
        if (p.action === "inspect") return { info: { name: p.query, version: "1.2.3", path: "/x" } }
        return {}
      },
    })
    const t = await mountNode(<Skills focused />, { gw })
    await until(t, () => t.frame().includes("alpha"))

    await act(async () => { await t.keys.typeText("i") })
    await until(t, () => t.frame().includes("Skill · alpha"))
    expect(t.frame()).toContain("1.2.3")
    expect(t.gw.last("skills.manage")?.params.action).toBe("inspect")
    t.destroy()
  })
})
