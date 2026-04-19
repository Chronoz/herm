import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Agents } from "../src/tabs/Agents"
import type { ProfileInfo, AgentProcess } from "../src/utils/gateway-types"

const PROFILES: ProfileInfo[] = [
  { name: "default", path: "/home/t/.hermes", is_default: true, is_active: true,
    gateway_running: true, model: "test-model", provider: "anthropic",
    has_env: true, skill_count: 42, has_alias: false, soul_preview: "I am default." },
  { name: "coder", path: "/home/t/.hermes/profiles/coder", is_default: false, is_active: false,
    gateway_running: false, model: "claude-4", provider: "anthropic",
    has_env: true, skill_count: 7, has_alias: true, soul_preview: "" },
]

const PROCS: AgentProcess[] = [
  { session_id: "bg_abc123", command: "npm test", status: "running", uptime: 95 },
]

describe("Agents tab", () => {
  test("loads profiles + running panes from RPC", async () => {
    const gw = new MockGateway({
      "profile.list": () => ({ profiles: PROFILES, active: "default" }),
      "agents.list": () => ({ processes: PROCS }),
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    const f = t.frame()
    expect(f).toContain("default")
    expect(f).toContain("coder")
    expect(f).toContain(" you") // active marker
    expect(f).toContain("Running (1)")
    expect(f).toContain("npm test")
    expect(f).toContain("1m35s")
    expect(f).toContain("I am default.") // SOUL preview for selected row
    expect(t.gw.last("profile.list")).toBeDefined()
    expect(t.gw.last("agents.list")).toBeDefined()
    t.destroy()
  })

  test("↓ selects, detail follows, d opens confirm → y deletes via RPC", async () => {
    let profiles = [...PROFILES]
    const gw = new MockGateway({
      "profile.list": () => ({ profiles, active: "default" }),
      "profile.delete": p => {
        profiles = profiles.filter(x => x.name !== p.name)
        return { deleted: true, name: p.name }
      },
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    // row 0 (default, active) → d is a no-op
    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("claude-4")) // detail followed selection

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Profile?"))
    expect(t.frame()).toContain("'coder'")

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => t.frame().includes("Profiles (1)"))
    expect(t.gw.last("profile.delete")?.params.name).toBe("coder")
    t.destroy()
  })

  test("n opens create dialog; validates name; Enter creates via RPC", async () => {
    const created: string[] = []
    const gw = new MockGateway({
      "profile.list": () => ({ profiles: PROFILES, active: "default" }),
      "profile.create": p => { created.push(p.name as string); return { created: true, name: p.name, path: "/p" } },
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Profile"))
    expect(t.frame()).toContain("(fresh)")
    expect(t.frame()).toContain("type a name")

    // collision with existing → invalid
    for (const c of "coder") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => t.frame().includes("invalid name"))
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(created).toHaveLength(0) // blocked

    // append → valid; select clone source = default
    for (const c of "-v2") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => !t.frame().includes("invalid name"))
    act(() => t.keys.pressArrow("down")) // (fresh) → default
    await t.settle()

    act(() => t.keys.pressEnter())
    await until(t, () => !t.frame().includes("New Profile"))
    expect(created).toEqual(["coder-v2"])
    const call = t.gw.last("profile.create")
    expect(call?.params.clone_from).toBe("default")
    expect(call?.params.clone_config).toBe(true)
    t.destroy()
  })

  test("Tab switches pane; k kills via process.stop", async () => {
    let stopped = ""
    const gw = new MockGateway({
      "profile.list": () => ({ profiles: PROFILES, active: "default" }),
      "agents.list": () => ({ processes: PROCS }),
      "process.stop": p => { stopped = p.session_id as string; return {} },
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Running (1)"))

    act(() => t.keys.pressTab())
    await t.settle()
    // 'd' should now be inert (running pane has no 'd' binding)
    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    await act(async () => { await t.keys.typeText("k") })
    await t.settle()
    expect(stopped).toBe("bg_abc123")
    t.destroy()
  })

  test("profile.list error surfaces inline warning", async () => {
    const gw = new MockGateway({
      "profile.list": () => { throw new Error("module missing") },
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("⚠ profile.list: module missing"))
    expect(t.frame()).toContain("Profiles (0)")
    t.destroy()
  })

  test("narrow width: single pane, Tab swaps between them", async () => {
    const gw = new MockGateway({
      "profile.list": () => ({ profiles: PROFILES, active: "default" }),
      "agents.list": () => ({ processes: PROCS }),
    })
    const t = await mountNode(<Agents focused />, { gw, width: 100 })
    await until(t, () => t.frame().includes("Profiles (2)"))
    expect(t.frame()).not.toContain("Running (")
    expect(t.frame()).toContain("Tab ↔ running")

    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("Running (1)"))
    expect(t.frame()).not.toContain("Profiles (")
    expect(t.frame()).toContain("Tab ↔ profiles")

    // widen → both visible
    act(() => t.resize(160, 48))
    await t.settle()
    await until(t, () => t.frame().includes("Profiles (2)") && t.frame().includes("Running (1)"))
    t.destroy()
  })
})
