// Profile discovery — direct filesystem reads, no gateway RPC needed.
//
// Profiles are inherently local: each is an isolated HERMES_HOME
// directory under `<root>/profiles/<name>/`, where <root> is the
// *default* hermes home (`~/.hermes` in the common case, even when
// herm itself is running under a named profile).
//
// Write ops (create/delete) live in src/tabs/Agents.tsx and go
// through `shell.exec` → `hermes profile …` so the authoritative
// CLI handles alias/gateway cleanup.

import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, basename, dirname } from "node:path"

export type ProfileInfo = {
  name: string
  path: string
  is_default: boolean
  is_active: boolean
  gateway_running: boolean
  model: string | null
  provider: string | null
  has_env: boolean
  skill_count: number
  has_alias: boolean
  soul_preview: string
}

const home = () => process.env.HOME || homedir()
const hermesHome = () => process.env.HERMES_HOME || join(home(), ".hermes")

// If HERMES_HOME is itself a named profile (…/profiles/<name>),
// the root is two levels up; otherwise HERMES_HOME is the root.
function root(): string {
  const hh = hermesHome()
  const parent = dirname(hh)
  return basename(parent) === "profiles" ? dirname(parent) : hh
}

export function activeProfileName(): string {
  return hermesHome() === root() ? "default" : basename(hermesHome())
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function readModel(dir: string): [string | null, string | null] {
  try {
    const raw = readFileSync(join(dir, "config.yaml"), "utf-8")
    // Poor-man's YAML for two nested keys — avoids pulling the yaml lib
    // here (hermes-home.ts already owns that dependency for full parsing).
    const block = raw.split(/^model:\s*$/m)[1]?.split(/^\S/m)[0] ?? ""
    const m = block.match(/^\s+(?:default|model):\s*(.+)$/m)?.[1]?.trim()
          ?? raw.match(/^model:\s*(\S.+)$/m)?.[1]?.trim()
    const p = block.match(/^\s+provider:\s*(.+)$/m)?.[1]?.trim()
    const clean = (s?: string) => s?.replace(/^["']|["']$/g, "") ?? null
    return [clean(m), clean(p)]
  } catch { return [null, null] }
}

function countSkills(dir: string): number {
  const sk = join(dir, "skills")
  if (!existsSync(sk)) return 0
  let n = 0
  const walk = (d: string, depth: number) => {
    if (depth > 4) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".hub" || e.name === ".git") continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.name === "SKILL.md") n++
    }
  }
  try { walk(sk, 0) } catch { /* ignore */ }
  return n
}

function gatewayRunning(dir: string): boolean {
  try {
    const pid = Number(readFileSync(join(dir, "gateway.pid"), "utf-8").trim())
    if (!Number.isFinite(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch { return false }
}

function soul(dir: string): string {
  try { return readFileSync(join(dir, "SOUL.md"), "utf-8").slice(0, 400) }
  catch { return "" }
}

function info(name: string, dir: string, active: string): ProfileInfo {
  const [model, provider] = readModel(dir)
  const alias = join(home(), ".local", "bin", name)
  return {
    name,
    path: dir,
    is_default: name === "default",
    is_active: name === active,
    gateway_running: gatewayRunning(dir),
    model, provider,
    has_env: existsSync(join(dir, ".env")),
    skill_count: countSkills(dir),
    has_alias: name !== "default" && existsSync(alias),
    soul_preview: soul(dir),
  }
}

export function listProfiles(): ProfileInfo[] {
  const r = root()
  const active = activeProfileName()
  const out: ProfileInfo[] = []
  if (existsSync(r)) out.push(info("default", r, active))
  const pr = join(r, "profiles")
  if (existsSync(pr)) {
    for (const e of readdirSync(pr, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue
      out.push(info(e.name, join(pr, e.name), active))
    }
  }
  return out
}

export function validateName(name: string, existing: string[]): string | null {
  if (!ID_RE.test(name)) return "must match [a-z0-9][a-z0-9_-]{0,63}"
  if (existing.includes(name)) return "already exists"
  if (["hermes", "default", "test", "tmp", "root", "sudo"].includes(name)) return "reserved name"
  return null
}

const PROFILE_DIRS = ["memories", "sessions", "skills", "skins", "logs", "plans", "workspace", "cron", "home"]
const CLONE_FILES = ["config.yaml", ".env", "SOUL.md", "memories/MEMORY.md", "memories/USER.md"]

// Additive-only: mirrors hermes_cli/profiles.py create_profile() minus
// skill seeding (may exceed shell.exec 30s timeout) and wrapper-script
// creation (shell-specific). User can run `hermes profile` for those.
export function createProfile(name: string, cloneFrom: string | null): string {
  const dest = join(root(), "profiles", name)
  if (existsSync(dest)) throw new Error(`profile '${name}' already exists`)
  mkdirSync(dest, { recursive: true })
  for (const d of PROFILE_DIRS) mkdirSync(join(dest, d), { recursive: true })
  if (cloneFrom) {
    const src = cloneFrom === "default" ? root() : join(root(), "profiles", cloneFrom)
    for (const f of CLONE_FILES) {
      const s = join(src, f)
      if (existsSync(s)) try { copyFileSync(s, join(dest, f)) } catch { /* ignore */ }
    }
  }
  return dest
}
