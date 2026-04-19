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
import type { AgentProcess } from "../src/utils/gateway-types"

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

const PROCS: AgentProcess[] = [
  { session_id: "bg_abc123", command: "npm test", status: "running", uptime: 95 },
]

describe("Agents tab", () => {
  test("loads profiles (fs) + running (RPC)", async () => {
    const gw = new MockGateway({ "agents.list": () => ({ processes: PROCS }) })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Profiles (2)"))

    const f = t.frame()
    expect(f).toContain("default")
    expect(f).toContain("coder")
    expect(f).toContain(" you")
    expect(f).toContain("Running (1)")
    expect(f).toContain("npm test")
    expect(f).toContain("1m35s")
    expect(f).toContain("I am default.")
    expect(t.gw.last("agents.list")).toBeDefined()
    t.destroy()
  })

  test("↓ selects, detail follows; d on active/default is no-op; d on other confirms → shell.exec", async () => {
    const gw = new MockGateway({
      "shell.exec": () => ({ stdout: "deleted", stderr: "", code: 0 }),
    })
    const t = await mountNode(<Agents focused />, { gw })
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
    const t = await mountNode(<Agents focused />, { gw: new MockGateway() })
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

  test("Tab switches pane; k kills via process.stop", async () => {
    let stopped = ""
    const gw = new MockGateway({
      "agents.list": () => ({ processes: PROCS }),
      "process.stop": p => { stopped = p.session_id as string; return {} },
    })
    const t = await mountNode(<Agents focused />, { gw })
    await until(t, () => t.frame().includes("Running (1)"))

    act(() => t.keys.pressTab())
    await t.settle()
    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    await act(async () => { await t.keys.typeText("k") })
    await t.settle()
    expect(stopped).toBe("bg_abc123")
    t.destroy()
  })

  test("narrow width: single pane, Tab swaps between them", async () => {
    const gw = new MockGateway({ "agents.list": () => ({ processes: PROCS }) })
    const t = await mountNode(<Agents focused />, { gw, width: 100 })
    await until(t, () => t.frame().includes("Profiles (2)"))
    expect(t.frame()).not.toContain("Running (")
    expect(t.frame()).toContain("Tab ↔ running")

    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("Running (1)"))
    expect(t.frame()).not.toContain("Profiles (")

    act(() => t.resize(160, 48))
    await t.settle()
    await until(t, () => t.frame().includes("Profiles (2)") && t.frame().includes("Running (1)"))
    t.destroy()
  })
})
