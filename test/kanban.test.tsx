import { describe, test, expect, beforeAll } from "bun:test"
import { act } from "react"
import { Database } from "bun:sqlite"
import { mkdirSync, writeFileSync } from "node:fs"
import { mountNode, MockGateway, until } from "./harness"
import { hermesPath } from "../src/utils/hermes-home"
import { board, detail, assignees, tailLog, q, resetKanban } from "../src/utils/hermes-kanban"
import { Kanban } from "../src/tabs/Kanban"

const now = Math.floor(Date.now() / 1000)

beforeAll(() => {
  mkdirSync(hermesPath("."), { recursive: true })
  mkdirSync(hermesPath("profiles/researcher"), { recursive: true })
  mkdirSync(hermesPath("profiles/writer"), { recursive: true })
  mkdirSync(hermesPath("kanban/logs"), { recursive: true })
  writeFileSync(hermesPath("kanban/logs/t2.log"), "boot\nstep 1\nstep 2\n")
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
  ins.run("t5", "need decision", "rate limit keying", "researcher",
    "blocked", 2, now - 600, now - 500, null, null, null)
  db.run("INSERT INTO task_links (parent_id, child_id) VALUES ('t1','t3'),('t2','t3')")
  db.run("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)",
    ["t1", "kaio", "check AWS reserved pricing too", now - 1000])
  db.close()
  resetKanban()
})

describe("hermes-kanban readers", () => {
  test("board() groups by status, sorted by priority desc", () => {
    const b = board()
    expect(b.get("ready")?.[0]?.id).toBe("t1")
    expect(b.get("running")?.[0]?.pid).toBe(4242)
    expect(b.get("todo")?.[0]?.id).toBe("t3")
    expect(b.get("blocked")?.[0]?.id).toBe("t5")
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

  test("assignees() = profiles-on-disk ∪ board assignees", () => {
    const a = assignees()
    expect(a).toContain("researcher")
    expect(a).toContain("writer")
    expect(a).toContain("analyst") // not on disk, only on board
  })

  test("tailLog() seeks from end and skips partial line", () => {
    expect(tailLog("t2")).toContain("step 2")
    expect(tailLog("t2", 10)).not.toContain("boot")
    expect(tailLog("t1")).toBeNull()
  })

  test("q() leaves plain ids, quotes metacharacters", () => {
    expect(q("t1")).toBe("t1")
    expect(q("hello world")).toBe("'hello world'")
    expect(q("it's")).toBe(`'it'\\''s'`)
  })
})

describe("Kanban tab", () => {
  test("columns + card nav + Enter → detail pane", async () => {
    const t = await mountNode(<Kanban focused />, { width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    const f = t.frame()
    expect(f).toContain("ready")
    expect(f).toContain("running")
    expect(f).toContain("1 running")
    expect(f).toContain("research cost")
    // second-line meta (id · assignee · priority)
    expect(f).toMatch(/t2\s+researcher\s+P3/)

    // → → lands on 'ready' (col idx 2 at full width).
    act(() => t.keys.pressArrow("right"))
    await t.settle()
    act(() => t.keys.pressArrow("right"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => /Assignee\s+researcher/.test(t.frame()))
    expect(t.frame()).toMatch(/Children\s+t3/)
    expect(t.frame()).toContain("AWS reserved")
    // detail footer advertises verbs
    expect(t.frame()).toMatch(/a assign\s+c comment\s+u unblock/)

    act(() => t.keys.pressEscape())
    await until(t, () => !/Assignee\s+researcher/.test(t.frame()))
    t.destroy()
  })

  test("a → DialogSelect → shell.exec hermes kanban assign", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    // → → to 'ready' col, cursor on t1.
    act(() => t.keys.pressArrow("right")); await t.settle()
    act(() => t.keys.pressArrow("right")); await t.settle()
    await act(async () => { await t.keys.typeText("a") })
    await until(t, () => t.frame().includes("Assign t1"))
    // type to filter to 'writer'
    await act(async () => { await t.keys.typeText("writer") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length > 0)
    expect(cmds[0]).toBe("hermes kanban assign t1 writer")
    t.destroy()
  })

  test("u on blocked → comment then unblock", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    // →×4 to 'blocked' col.
    for (let i = 0; i < 4; i++) { act(() => t.keys.pressArrow("right")); await t.settle() }
    await act(async () => { await t.keys.typeText("u") })
    await until(t, () => t.frame().includes("Unblock t5"))
    await act(async () => { await t.keys.typeText("use user_id") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length === 2)
    expect(cmds[0]).toBe("hermes kanban comment t5 'use user_id' --author user")
    expect(cmds[1]).toBe("hermes kanban unblock t5")
    t.destroy()
  })

  test("d → confirm → archive", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    for (let i = 0; i < 5; i++) { act(() => t.keys.pressArrow("right")); await t.settle() }
    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Archive task?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban archive t4")
    t.destroy()
  })

  test("n → create dialog → shell.exec hermes kanban create", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "t6", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Task"))
    await act(async () => { await t.keys.typeText("ship rate limiter") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban create 'ship rate limiter'")
    t.destroy()
  })

  test("D → confirm → dispatch", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "[]", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    await act(async () => { await t.keys.typeText("D") })
    await until(t, () => t.frame().includes("Dispatch ready tasks?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban dispatch --json")
    t.destroy()
  })

  test("l opens log pane; Esc closes", async () => {
    const t = await mountNode(<Kanban focused />, { width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    // →×3 to 'running' col, cursor on t2.
    for (let i = 0; i < 3; i++) { act(() => t.keys.pressArrow("right")); await t.settle() }
    await act(async () => { await t.keys.typeText("l") })
    await until(t, () => t.frame().includes("worker log (tail)"))
    expect(t.frame()).toContain("step 2")
    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("worker log (tail)"))
    t.destroy()
  })

  test("non-zero exit surfaces as error toast, no crash", async () => {
    const gw = new MockGateway({
      "shell.exec": () => ({ stdout: "", stderr: "cycle detected: t1 → t3 → t1", code: 2 }),
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · 5 tasks"))
    act(() => t.keys.pressArrow("right")); await t.settle()
    act(() => t.keys.pressArrow("right")); await t.settle()
    await act(async () => { await t.keys.typeText("a") })
    await until(t, () => t.frame().includes("Assign t1"))
    act(() => t.keys.pressEnter()) // picks (unassigned)
    await until(t, () => t.frame().includes("cycle detected"))
    t.destroy()
  })
})
