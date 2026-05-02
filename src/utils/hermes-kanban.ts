// Window onto the shared ~/.hermes/kanban.db.
//
// Kanban is deliberately profile-agnostic (the board IS the
// coordination primitive between profiles), so this reads the
// HERMES_HOME-relative path and shows every tenant's tasks.
//
// Reads are sidecar SQLite (WAL lets us read alongside the
// dispatcher's IMMEDIATE write txns). Writes route through
// `shell.exec → hermes kanban <verb>` so upstream kanban_db.py owns
// the state machine: recompute_ready, cycle detection, event log,
// notify subscriptions. herm is the operator surface for that CLI —
// create/assign/comment/unblock/archive/dispatch — not a competing
// implementation.

import { Database } from "bun:sqlite"
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs"
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

let ro: Database | null | undefined
const db = (): Database | null => {
  if (ro !== undefined) return ro
  try { ro = new Database(hermesPath("kanban.db"), { readonly: true }) }
  catch { ro = null }
  return ro
}
export const resetKanban = () => { ro?.close(); ro = undefined }

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

/** All non-archived tasks, grouped by status column. Each column
 *  sorted by (priority desc, updated_at desc) so the dispatcher's
 *  pick-next ordering roughly matches the top of `ready`. */
export function board(): Map<Status, Task[]> {
  const out = new Map<Status, Task[]>(STATUSES.map(s => [s, []]))
  const conn = db()
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

export function detail(id: string): Detail | null {
  const conn = db()
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

/** Candidate assignee names for the picker — union of profiles-on-disk
 *  and any assignee already referenced on the board (a task can be
 *  assigned to a profile that no longer exists; still show it so the
 *  operator can reassign *away* from it). `(unassigned)` is prepended
 *  at the call site. */
export function assignees(): string[] {
  const seen = new Set<string>()
  const dir = hermesPath("profiles")
  if (existsSync(dir))
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) seen.add(e.name)
  const conn = db()
  if (conn) try {
    for (const r of conn.query(
      "SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL AND status != 'archived'",
    ).all() as Array<{ assignee: string }>) seen.add(r.assignee)
  } catch {}
  return [...seen].sort()
}

/** Tail of the worker log at ~/.hermes/kanban/logs/<id>.log. Mirrors
 *  kanban_db.read_worker_log's seek-from-end + skip-partial-line. */
export function tailLog(id: string, bytes = 16_384): string | null {
  const path = hermesPath(`kanban/logs/${id}.log`)
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

/** POSIX single-quote for shell.exec argv building. Wraps only when
 *  the string contains shell metacharacters (keeps test assertions
 *  and toast messages readable for plain ids). */
export const q = (s: string): string =>
  /^[A-Za-z0-9._\/:+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
