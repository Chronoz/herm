import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { act } from "react"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mountNode, until, MockGateway } from "./harness"
import { Agents } from "../src/tabs/Agents"
import {
  listProfiles, createProfile, validateName, activeProfileName,
} from "../src/utils/hermes-profiles"
import type { DelegationRecord, DelegationStatus } from "../src/utils/gateway-types"

// ─── fixture ─────────────────────────────────────────────────────────

let ROOT: string
let PREV: string | undefined

const mkProfile = (name: string, cfg: Record<string, unknown>) => {
  const d = name === "default" ? ROOT : join(ROOT, "profiles", name)
  mkdirSync(join(d, "skills"), { recursive: true })
  const body = "model:\n" + Object.entries(cfg).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n"
  writeFileSync(join(d, "config.yaml"), body)
  return d
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "herm-agents-"))
  PREV = process.env.HERMES_HOME
  process.env.HERMES_HOME = ROOT
  mkProfile("default", { default: "test-model", provider: "anthropic" })
  writeFileSync(join(ROOT, "SOUL.md"), "I am default.")
  writeFileSync(join(ROOT, ".env"), "FOO=bar")
  mkdirSync(join(ROOT, "skills", "a"), { recursive: true })
  writeFileSync(join(ROOT, "skills", "a", "SKILL.md"), "---\nname: a\n---")
  mkProfile("coder", { default: "claude-4", provider: "anthropic" })
})

afterEach(() => {
  process.env.HERMES_HOME = PREV
  try { rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ─── hermes-profiles.ts ──────────────────────────────────────────────

describe("hermes-profiles", () => {
  test("listProfiles reads root + profiles/, detects active", () => {
    const ps = listProfiles()
    expect(ps.map(p => p.name)).toEqual(["default", "coder"])
    const def = ps[0]
    expect(def.is_default).toBe(true)
    expect(def.is_active).toBe(true)
    expect(def.model).toBe("test-model")
    expect(def.provider).toBe("anthropic")
    expect(def.has_env).toBe(true)
    expect(def.skill_count).toBe(1)
    expect(def.soul_preview).toContain("I am default")
    expect(ps[1].is_active).toBe(false)
    expect(ps[1].model).toBe("claude-4")
    expect(activeProfileName()).toBe("default")
  })

  test("activeProfileName when running under a named profile", () => {
    process.env.HERMES_HOME = join(ROOT, "profiles", "coder")
    expect(activeProfileName()).toBe("coder")
    const ps = listProfiles()
    expect(ps.find(p => p.name === "coder")?.is_active).toBe(true)
    expect(ps.find(p => p.name === "default")?.is_active).toBe(false)
  })

  test("validateName", () => {
    expect(validateName("ok-name_1", ["x"])).toBeNull()
    expect(validateName("Bad", [])).toMatch(/must match/)
    expect(validateName("coder", ["coder"])).toBe("already exists")
    expect(validateName("default", [])).toBe("reserved name")
  })

  test("createProfile scaffolds dirs and clones config files", () => {
    const path = createProfile("fresh", null)
    expect(existsSync(join(path, "memories"))).toBe(true)
    expect(existsSync(join(path, "config.yaml"))).toBe(false) // no clone
    expect(listProfiles().map(p => p.name)).toContain("fresh")

    createProfile("cloned", "default")
    expect(existsSync(join(ROOT, "profiles", "cloned", "config.yaml"))).toBe(true)
    expect(existsSync(join(ROOT, "profiles", "cloned", "SOUL.md"))).toBe(true)
    expect(existsSync(join(ROOT, "profiles", "cloned", ".env"))).toBe(true)

    expect(() => createProfile("fresh", null)).toThrow(/already exists/)
  })
})

// ─── Agents tab ──────────────────────────────────────────────────────

const T0 = () => Date.now() / 1000 - 95
// Intentionally out of tree order to exercise preorder().
const RECS = (): DelegationRecord[] => [
  { subagent_id: "s2", parent_id: "s1", depth: 1, goal: "sub: scan repo",
    model: "haiku", started_at: T0(), tool_count: 2 },
  { subagent_id: "s1", parent_id: null, depth: 0, goal: "root: refactor",
    model: "sonnet", started_at: T0(), tool_count: 7 },
  { subagent_id: "s3", parent_id: null, depth: 0, goal: "root: docs",
    model: "sonnet", started_at: T0(), tool_count: 1 },
]
const STATUS = (over: Partial<DelegationStatus> = {}): DelegationStatus => ({
  active: RECS(), paused: false, max_spawn_depth: 2, max_concurrent_children: 3, ...over,
})

describe("Agents tab", () => {
  test("loads profiles (fs) + delegation (RPC), preorder sort", async () => {
    const gw = new MockGateway({ "delegation.status": () => STATUS() })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    const f = t.frame()
    expect(f).toContain("default")
    expect(f).toContain("coder")
    expect(f).toContain(" you")
    expect(f).toContain("I am default.")
    expect(f).toContain("Delegation (3)")
    expect(f).toContain("root: refactor")
    expect(f).toContain("· sub: scan repo")
    expect(f).toContain("1m35s")
    // Tree order: root s1, its child s2, then root s3.
    expect(f.indexOf("root: refactor")).toBeLessThan(f.indexOf("sub: scan repo"))
    expect(f.indexOf("sub: scan repo")).toBeLessThan(f.indexOf("root: docs"))
    expect(t.gw.last("delegation.status")).toBeDefined()
    t.destroy()
  })

  test("↓ selects, detail follows; d on active/default is no-op; d on other confirms → shell.exec", async () => {
    const gw = new MockGateway({
      "shell.exec": () => ({ stdout: "deleted", stderr: "", code: 0 }),
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("claude-4"))

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Profile?"))
    expect(t.frame()).toContain("'coder'")

    await act(async () => { await t.keys.typeText("y") })
    await t.settle()
    expect(t.gw.last("shell.exec")?.params.command).toBe("hermes profile delete coder -y")
    t.destroy()
  })

  test("n opens create dialog; validates; Enter scaffolds profile on disk", async () => {
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw: new MockGateway() })
    await until(t, () => t.frame().includes("Profiles (2)"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Profile"))
    expect(t.frame()).toContain("(fresh)")
    expect(t.frame()).toContain("type a name")

    for (const c of "coder") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => t.frame().includes("already exists"))
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(existsSync(join(ROOT, "profiles", "coder-v2"))).toBe(false) // nothing yet

    for (const c of "-v2") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => t.frame().includes("Enter create"))
    act(() => t.keys.pressArrow("down")) // clone: (fresh) → default
    await t.settle()

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Profiles (3)"))
    expect(existsSync(join(ROOT, "profiles", "coder-v2", "config.yaml"))).toBe(true)
    t.destroy()
  })

  test("Tab switches pane; k confirms → subagent.interrupt; p → delegation.pause", async () => {
    let paused = false
    let killed = ""
    const gw = new MockGateway({
      "delegation.status": () => STATUS({ paused }),
      "delegation.pause": p => { paused = p.paused as boolean; return { paused } },
      "subagent.interrupt": p => { killed = p.subagent_id as string; return { found: true } },
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 200 })
    await until(t, () => t.frame().includes("Delegation (3)"))

    act(() => t.keys.pressTab())
    await t.settle()
    // Profiles-pane keys are now inert.
    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    // First row after preorder is s1; k → confirm → interrupt.
    await act(async () => { await t.keys.typeText("k") })
    await until(t, () => t.frame().includes("Interrupt subagent?"))
    await act(async () => { await t.keys.typeText("y") })
    await t.settle()
    expect(killed).toBe("s1")

    // p toggles spawn-pause and the refreshed status paints PAUSED.
    await act(async () => { await t.keys.typeText("p") })
    await t.settle()
    expect(t.gw.last("delegation.pause")?.params.paused).toBe(true)
    await until(t, () => t.frame().includes("PAUSED"))
    t.destroy()
  })

  test("narrow width: single pane, Tab swaps between them", async () => {
    const gw = new MockGateway({ "delegation.status": () => STATUS() })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 100 })
    await until(t, () => t.frame().includes("Profiles (2)"))
    expect(t.frame()).not.toContain("Delegation (")
    expect(t.frame()).toContain("Tab ↔ delegation")

    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("Delegation (3)"))
    expect(t.frame()).not.toContain("Profiles (")
    expect(t.frame()).toContain("depth≤2 · conc≤3")

    act(() => t.resize(160, 48))
    await t.settle()
    await until(t, () => t.frame().includes("Profiles (2)") && t.frame().includes("Delegation (3)"))
    t.destroy()
  })

  test("empty delegation shows placeholder; paused variant", async () => {
    let paused = false
    const gw = new MockGateway({
      "delegation.status": () => STATUS({ active: [], paused }),
      "delegation.pause": p => { paused = p.paused as boolean; return { paused } },
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw })
    await until(t, () => t.frame().includes("Delegation (0)"))
    expect(t.frame()).toContain("No subagents running")

    act(() => t.keys.pressTab())
    await act(async () => { await t.keys.typeText("p") })
    await until(t, () => t.frame().includes("PAUSED"))
    expect(t.frame()).toContain("new subagents will queue")
    t.destroy()
  })
})
