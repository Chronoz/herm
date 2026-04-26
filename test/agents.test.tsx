import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { act } from "react"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mountNode, until, MockGateway } from "./harness"
import { Agents } from "../src/tabs/Agents"
import {
  listProfiles, validateName, activeProfileName, profileNameFrom, stickyDefault,
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
  writeFileSync(join(ROOT, "SOUL.md"), "# Default Soul\n\nI am default.\nSecond line.")
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
  test("listProfiles reads root + profiles/, strips H1 from soul preview", async () => {
    const ps = await listProfiles()
    expect(ps.map(p => p.name)).toEqual(["default", "coder"])
    const def = ps[0]
    expect(def.is_default).toBe(true)
    expect(def.is_active).toBe(true)
    expect(def.is_sticky).toBe(false)
    expect(def.model).toBe("test-model")
    expect(def.provider).toBe("anthropic")
    expect(def.has_env).toBe(true)
    expect(def.skill_count).toBe(1)
    // H1 heading stripped.
    expect(def.soul_preview).not.toContain("# Default Soul")
    expect(def.soul_preview.startsWith("I am default.")).toBe(true)
    // Source provenance.
    expect(def.sources.config.file).toBe(join(ROOT, "config.yaml"))
    expect(def.sources.soul.label).toBe("SOUL.md")
    expect(ps[1].is_active).toBe(false)
    expect(ps[1].model).toBe("claude-4")
    expect(activeProfileName()).toBe("default")
  })

  test("activeProfileName when running under a named profile", async () => {
    process.env.HERMES_HOME = join(ROOT, "profiles", "coder")
    expect(activeProfileName()).toBe("coder")
    const ps = await listProfiles()
    expect(ps.find(p => p.name === "coder")?.is_active).toBe(true)
    expect(ps.find(p => p.name === "default")?.is_active).toBe(false)
  })

  test("is_active honors gateway-reported home over process env", async () => {
    // Herm's process runs under default, but the gateway says 'coder'.
    expect(profileNameFrom(join(ROOT, "profiles", "coder"))).toBe("coder")
    const ps = await listProfiles(join(ROOT, "profiles", "coder"))
    expect(ps.find(p => p.name === "coder")?.is_active).toBe(true)
    expect(ps.find(p => p.name === "default")?.is_active).toBe(false)
  })

  test("sticky default read from <root>/active_profile", async () => {
    expect(stickyDefault()).toBeNull()
    writeFileSync(join(ROOT, "active_profile"), "coder\n")
    expect(stickyDefault()).toBe("coder")
    const ps = await listProfiles()
    expect(ps.find(p => p.name === "coder")?.is_sticky).toBe(true)
    expect(ps.find(p => p.name === "default")?.is_sticky).toBe(false)
  })

  test("validateName", () => {
    expect(validateName("ok-name_1", ["x"])).toBeNull()
    expect(validateName("Bad", [])).toMatch(/must match/)
    expect(validateName("coder", ["coder"])).toBe("already exists")
    expect(validateName("default", [])).toBe("reserved name")
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
  test("loads profiles (fs) + delegation (RPC), preorder sort; is_active from gateway", async () => {
    const gw = new MockGateway({
      "delegation.status": () => STATUS(),
      // Gateway claims 'coder' is the active home, regardless of herm's env.
      "config.get": p => p.key === "profile"
        ? { home: join(ROOT, "profiles", "coder"), display: "coder" }
        : p.key === "full" ? { config: {} } : {},
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 200 })
    await until(t, () => t.frame().includes("Profiles (2)"))

    const f = t.frame()
    expect(f).toContain("default")
    expect(f).toContain("coder")
    expect(f).toContain(" you")
    // Active row == coder (gateway's home), not default (process env).
    const rowCoder = f.split("\n").find(l => /▸?\s+coder/.test(l))!
    expect(rowCoder).toContain("you")
    expect(f).toContain("I am default.")
    expect(f).not.toContain("# Default Soul")
    // FileLinks render labels.
    expect(f).toContain("config.yaml")
    expect(f).toContain("SOUL.md")
    expect(f).toContain("Delegation (3)")
    expect(f).toContain("root: refactor")
    expect(f).toContain("· sub: scan repo")
    expect(f).toContain("1m35s")
    expect(f.indexOf("root: refactor")).toBeLessThan(f.indexOf("sub: scan repo"))
    expect(f.indexOf("sub: scan repo")).toBeLessThan(f.indexOf("root: docs"))
    expect(t.gw.last("delegation.status")).toBeDefined()
    expect(t.gw.last("config.get")?.params.key).toBe("profile")
    t.destroy()
  })

  test("sticky default badged in row + title", async () => {
    writeFileSync(join(ROOT, "active_profile"), "coder\n")
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw: new MockGateway(), width: 200 })
    await until(t, () => t.frame().includes("★"))
    const f = t.frame()
    expect(f).toContain("★ coder")
    const row = f.split("\n").find(l => l.includes("coder") && l.includes("★"))
    expect(row).toBeDefined()
    t.destroy()
  })

  test("↓ selects, detail follows; d on active/default is no-op; d on other confirms → shell.exec; running-gateway warn", async () => {
    writeFileSync(join(ROOT, "profiles", "coder", "gateway.pid"), String(process.pid))
    const gw = new MockGateway({
      "shell.exec": () => ({ stdout: "deleted", stderr: "", code: 0 }),
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 200 })
    await until(t, () => t.frame().includes("Profiles (2)"))

    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Profile?")

    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("claude-4"))

    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Delete Profile?"))
    expect(t.frame()).toContain("'coder'")
    expect(t.frame()).toContain("gateway is running")

    await act(async () => { await t.keys.typeText("y") })
    await t.settle()
    expect(t.gw.last("shell.exec")?.params.command).toBe("hermes profile delete coder -y")
    t.destroy()
  })

  test("n opens create dialog; validates; Enter → hermes profile create via shell.exec", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => {
        const c = p.command as string
        cmds.push(c)
        // Simulate the CLI actually scaffolding so the reload sees 3.
        const m = c.match(/^hermes profile create (\S+)/)
        if (m) mkProfile(m[1], { default: "x" })
        return { stdout: "", stderr: "", code: 0 }
      },
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 200 })
    await until(t, () => t.frame().includes("Profiles (2)"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Profile"))
    expect(t.frame()).toContain("(fresh)")
    expect(t.frame()).toContain("type a name")
    expect(t.frame()).toContain("shell alias: yes")

    for (const c of "coder") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => t.frame().includes("already exists"))
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(cmds.length).toBe(0)

    for (const c of "-v2") await act(async () => { await t.keys.typeText(c) })
    await until(t, () => t.frame().includes("Enter create"))
    act(() => t.keys.pressArrow("down")) // clone: (fresh) → default
    act(() => t.keys.pressTab())         // alias: yes → no
    await until(t, () => t.frame().includes("shell alias: no"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Profiles (3)"))
    expect(cmds[0]).toBe("hermes profile create coder-v2 --clone --clone-from default --no-alias")
    expect(existsSync(join(ROOT, "profiles", "coder-v2"))).toBe(true)
    t.destroy()
  })

  test("Enter opens profile action menu; set sticky → shell.exec", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 200 })
    await until(t, () => t.frame().includes("Profiles (2)"))

    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("claude-4"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Profile · coder"))
    expect(t.frame()).toContain("SOUL.md")
    expect(t.frame()).toContain("Set as sticky default")
    expect(t.frame()).toContain("Export")
    // 'coder' has no .env → option list is: SOUL.md, config.yaml,
    // Directory, Set sticky, Export, Delete. Delete may sit below the
    // scrollbox fold; presence of the Manage group is enough here.

    // Cursor to "Set as sticky default" and select it.
    for (let k = 0; k < 3; k++) act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length > 0)
    expect(cmds[0]).toBe("hermes profile use coder")
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

  test("narrow width: single pane, Tab swaps; Enter swaps list↔detail inside Profiles", async () => {
    const gw = new MockGateway({ "delegation.status": () => STATUS() })
    const t = await mountNode(<Agents focused sessionId="test-sid" />, { gw, width: 80 })
    await until(t, () => t.frame().includes("Profiles (2)"))
    expect(t.frame()).not.toContain("Delegation (")
    expect(t.frame()).toContain("Tab ↔ delegation")
    expect(t.frame()).toContain("Enter detail")
    // Detail column (path/model) hidden at 80 cols.
    expect(t.frame()).not.toContain("test-model")

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("test-model"))
    expect(t.frame()).toContain("Enter actions")
    expect(t.frame()).toContain("Esc back")
    // Second Enter from detail opens the action menu.
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Profile · default"))
    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("Profile · default"))
    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Enter detail"))

    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("Delegation (3)"))
    expect(t.frame()).not.toContain("Profiles (")
    // Hint truncates at 80 cols — check the visible prefix only.
    expect(t.frame()).toContain("depth")

    act(() => t.resize(200, 48))
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
