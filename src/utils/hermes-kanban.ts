// Window onto the kanban board(s) under ~/.hermes/.
//
// Kanban is deliberately profile-agnostic (the board IS the
// coordination primitive between profiles), so this reads the
// HERMES_HOME-relative paths and shows every tenant's tasks.
//
// Upstream 5ec6baa40 introduced multi-project boards. Resolution
// chain for the *default-active* board mirrors
// hermes_cli/kanban_db.py:
//   HERMES_KANBAN_BOARD env → <root>/kanban/current file → "default".
// The 'default' board keeps its legacy DB path <root>/kanban.db and
// legacy logs dir <root>/kanban/logs/; every other board lives at
// <root>/kanban/boards/<slug>/{kanban.db,logs/}.
//
// Herm renders all boards at once; the "current" board only seeds
// which section has focus on mount. Reads are sidecar SQLite per
// board (WAL lets us read alongside the dispatcher's IMMEDIATE write
// txns). Writes route through `shell.exec → hermes kanban --board
// <slug> <verb>` so upstream kanban_db.py owns the state machine:
// recompute_ready, cycle detection, event log, notify subscriptions.

import { Database } from "bun:sqlite"
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from "node:fs"
import { hermesPath } from "./hermes-home"

export const STATUSES = ["triage", "todo", "ready", "running", "blocked", "done"] as const
export type Status = typeof STATUSES[number]

export type Task = {
  id: string; title: string; body: string | null
  assignee: string | null; status: Status; priority: number
  created_at: number; updated_at: number; completed_at: number | null
  result: string | null; error: string | null
  tenant: string | null; pid: number | null
}

export type Detail = Task & {
  parents: string[]; children: string[]
  comments: Array<{ author: string; body: string; at: number }>
}

export type Board = { slug: string; name: string }

const DEFAULT = "default"
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Active board slug per the CLI's resolution chain. Herm shows every
 *  board; this only picks which section is focused on mount. */
const resolve = (): string => {
  const env = (process.env.HERMES_KANBAN_BOARD ?? "").trim().toLowerCase()
  if (SLUG.test(env)) return env
  try {
    const txt = readFileSync(hermesPath("kanban/current"), "utf-8").trim().toLowerCase()
    if (SLUG.test(txt)) return txt
  } catch {}
  return DEFAULT
}

let slug = resolve()
/** One RO handle per board slug. `null` = open attempted and failed
 *  (no DB yet); `undefined` = not yet attempted. */
const handles = new Map<string, Database | null>()

export const currentBoard = () => slug

/** default keeps legacy <root>/kanban.db; others live under boards/<slug>/. */
const dbPath = (s: string) =>
  hermesPath(s === DEFAULT ? "kanban.db" : `kanban/boards/${s}/kanban.db`)

const logsDir = (s: string) =>
  hermesPath(s === DEFAULT ? "kanban/logs" : `kanban/boards/${s}/logs`)

const dbOf = (s: string): Database | null => {
  if (handles.has(s)) return handles.get(s) ?? null
  let h: Database | null = null
  try { h = new Database(dbPath(s), { readonly: true }) } catch {}
  handles.set(s, h)
  return h
}

/** Close every cached RO handle and re-resolve the active board.
 *  Call after a profile rehome, board create, or test seeding. */
export const resetKanban = () => {
  for (const h of handles.values()) h?.close()
  handles.clear()
  slug = resolve()
}

/** Enumerate boards on disk. 'default' always first; others sorted. */
export function listBoards(): Board[] {
  const out = new Map<string, string>([[DEFAULT, "Default"]])
  const dir = hermesPath("kanban/boards")
  if (existsSync(dir))
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !SLUG.test(e.name)) continue
      let name = e.name
      try {
        const meta = JSON.parse(readFileSync(`${dir}/${e.name}/board.json`, "utf-8"))
        if (typeof meta?.display_name === "string") name = meta.display_name
      } catch {}
      out.set(e.name, name)
    }
  return [...out].map(([s, name]) => ({ slug: s, name }))
    .sort((a, b) => a.slug === DEFAULT ? -1 : b.slug === DEFAULT ? 1 : a.slug.localeCompare(b.slug))
}

// completed_at / started_at / created_at → updated_at proxy. The
// tasks table has no updated_at; newest-of-the-three is close enough
// for sort-by-recency without joining task_events on every list.
const AT = "COALESCE(completed_at, started_at, created_at)"

const toTask = (r: Record<string, unknown>): Task => ({
  id: String(r.id), title: String(r.title ?? ""),
  body: (r.body as string) ?? null,
  assignee: (r.assignee as string) ?? null,
  status: (r.status as Status) ?? "todo",
  priority: Number(r.priority) || 0,
  created_at: Number(r.created_at) || 0,
  updated_at: Number(r.updated_at) || 0,
  completed_at: (r.completed_at as number) ?? null,
  result: (r.result as string) ?? null,
  error: (r.last_spawn_error as string) ?? null,
  tenant: (r.tenant as string) ?? null,
  pid: (r.worker_pid as number) ?? null,
})

/** All non-archived tasks on `s`, grouped by status column. Each
 *  column sorted by (priority desc, updated_at desc) so the
 *  dispatcher's pick-next ordering roughly matches the top of
 *  `ready`. */
export function boardOf(s: string): Map<Status, Task[]> {
  const out = new Map<Status, Task[]>(STATUSES.map(k => [k, []]))
  const conn = dbOf(s)
  if (!conn) return out
  try {
    const rows = conn.query(
      `SELECT id, title, body, assignee, status, priority, tenant,
              created_at, completed_at, result, last_spawn_error, worker_pid,
              ${AT} AS updated_at
       FROM tasks WHERE status != 'archived'
       ORDER BY priority DESC, updated_at DESC`,
    ).all() as Array<Record<string, unknown>>
    for (const r of rows) {
      const t = toTask(r)
      out.get(t.status)?.push(t)
    }
  } catch {}
  return out
}

export function detailOf(s: string, id: string): Detail | null {
  const conn = dbOf(s)
  if (!conn) return null
  try {
    const row = conn.query(
      `SELECT *, ${AT} AS updated_at FROM tasks WHERE id = ?`,
    ).get(id) as Record<string, unknown> | null
    if (!row) return null
    const parents = (conn.query(
      "SELECT parent_id FROM task_links WHERE child_id = ?",
    ).all(id) as Array<{ parent_id: string }>).map(r => r.parent_id)
    const children = (conn.query(
      "SELECT child_id FROM task_links WHERE parent_id = ?",
    ).all(id) as Array<{ child_id: string }>).map(r => r.child_id)
    const comments = (conn.query(
      "SELECT author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at",
    ).all(id) as Array<{ author: string; body: string; created_at: number }>)
      .map(c => ({ author: c.author, body: c.body, at: c.created_at }))
    return { ...toTask(row), parents, children, comments }
  } catch { return null }
}

/** Tail of the worker log. Mirrors kanban_db.read_worker_log's
 *  seek-from-end + skip-partial-line. */
export function tailLogOf(s: string, id: string, bytes = 16_384): string | null {
  const path = `${logsDir(s)}/${id}.log`
  if (!existsSync(path)) return null
  try {
    const size = statSync(path).size
    const want = Math.min(size, bytes)
    const fd = openSync(path, "r")
    const buf = Buffer.alloc(want)
    readSync(fd, buf, 0, want, size - want)
    closeSync(fd)
    let out = buf.toString("utf-8")
    if (size > bytes) {
      const nl = out.indexOf("\n")
      if (nl >= 0 && nl < out.length - 1) out = out.slice(nl + 1)
    }
    return out
  } catch { return null }
}

/** Candidate assignee names — profiles-on-disk ∪ any assignee
 *  referenced on board `s` (a task can be assigned to a profile that
 *  no longer exists; show it so the operator can reassign *away*). */
export function assignees(s: string = slug): string[] {
  const seen = new Set<string>()
  const dir = hermesPath("profiles")
  if (existsSync(dir))
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) seen.add(e.name)
  const conn = dbOf(s)
  if (conn) try {
    for (const r of conn.query(
      "SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL AND status != 'archived'",
    ).all() as Array<{ assignee: string }>) seen.add(r.assignee)
  } catch {}
  return [...seen].sort()
}

// ── Current-board shims ────────────────────────────────────────────
// Kept for callers that don't care about multi-board (rehome, tests).

export const board = () => boardOf(slug)
export const detail = (id: string) => detailOf(slug, id)
export const tailLog = (id: string, bytes?: number) => tailLogOf(slug, id, bytes)

/** POSIX single-quote for shell.exec argv building. Wraps only when
 *  the string contains shell metacharacters (keeps test assertions
 *  and toast messages readable for plain ids). */
export const q = (s: string): string =>
  /^[A-Za-z0-9._\/:+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
