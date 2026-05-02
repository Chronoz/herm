// Read-only window onto the shared ~/.hermes/kanban.db.
//
// Kanban is deliberately profile-agnostic (the board IS the
// coordination primitive between profiles), so this reads the
// HERMES_HOME-relative path and shows every tenant's tasks. herm
// takes the sidecar-read approach — no RPC, no mutation; writes go
// through `hermes kanban …` / the kanban_* tools / the dashboard.

import { Database } from "bun:sqlite"
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
