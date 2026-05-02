import { describe, test, expect, beforeAll } from "bun:test"
import { act } from "react"
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { mountNode, until } from "./harness"
import { hermesPath } from "../src/utils/hermes-home"
import { board, detail, resetKanban } from "../src/utils/hermes-kanban"
import { Kanban } from "../src/tabs/Kanban"

const now = Math.floor(Date.now() / 1000)

beforeAll(() => {
  mkdirSync(hermesPath("."), { recursive: true })
  const db = new Database(hermesPath("kanban.db"), { create: true })
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT,
    status TEXT, priority INTEGER DEFAULT 0, tenant TEXT,
    created_at INTEGER, started_at INTEGER, completed_at INTEGER,
    result TEXT, last_spawn_error TEXT, worker_pid INTEGER
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS task_links (
    parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id))`)
  db.run(`CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
    author TEXT, body TEXT, created_at INTEGER)`)
  const ins = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, title, body, assignee, status,
       priority, created_at, started_at, completed_at, result, worker_pid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  ins.run("t1", "research cost", "Compare infra costs", "researcher",
    "ready", 3, now - 3600, null, null, null, null)
  ins.run("t2", "research perf", null, "researcher",
    "running", 3, now - 1800, now - 60, null, null, 4242)
  ins.run("t3", "synthesize", "merge findings", "analyst",
    "todo", 2, now - 900, null, null, null, null)
  ins.run("t4", "draft memo", null, "writer",
    "done", 1, now - 7200, now - 7100, now - 7000, "memo.md written", null)
  db.run("INSERT INTO task_links (parent_id, child_id) VALUES ('t1','t3'),('t2','t3')")
  db.run("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)",
    ["t1", "kaio", "check AWS reserved pricing too", now - 1000])
  db.close()
  resetKanban()
})

describe("hermes-kanban", () => {
  test("board() groups by status, sorted by priority desc", () => {
    const b = board()
    expect(b.get("ready")?.[0]?.id).toBe("t1")
    expect(b.get("running")?.[0]?.pid).toBe(4242)
    expect(b.get("todo")?.[0]?.id).toBe("t3")
    expect(b.get("done")?.[0]?.result).toContain("memo.md")
    expect(b.get("triage")).toEqual([])
  })

  test("detail() hydrates parents/children/comments", () => {
    const d = detail("t3")!
    expect(d.parents.sort()).toEqual(["t1", "t2"])
    expect(d.children).toEqual([])
    const d1 = detail("t1")!
    expect(d1.children).toEqual(["t3"])
    expect(d1.comments[0].body).toContain("AWS reserved")
  })
})

describe("Kanban tab", () => {
  test("columns + card nav + Enter → detail pane", async () => {
    const t = await mountNode(<Kanban focused />, { width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 4 tasks"))
    const f = t.frame()
    expect(f).toContain("ready")
    expect(f).toContain("running")
    expect(f).toContain("research cost")
    // second-line meta (id · assignee · priority)
    expect(f).toMatch(/t2\s+researcher\s+P3/)

    // Navigate right to 'ready' column (first non-empty at ≥160 is triage→todo→ready).
    // At width 180 all 6 columns render; triage is empty, cursor starts at col 0.
    // → → lands on 'ready'.
    act(() => t.keys.pressArrow("right"))
    await t.settle()
    act(() => t.keys.pressArrow("right"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => /Assignee\s+researcher/.test(t.frame()))
    expect(t.frame()).toMatch(/Children\s+t3/)
    expect(t.frame()).toContain("AWS reserved")

    act(() => t.keys.pressEscape())
    await until(t, () => !/Assignee\s+researcher/.test(t.frame()))
    t.destroy()
  })
})
