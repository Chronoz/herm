import { describe, test, expect, beforeAll } from "bun:test"
import { act } from "react"
import { Database } from "bun:sqlite"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { mountNode, MockGateway, until } from "./harness"
import { hermesPath } from "../src/utils/hermes-home"
import {
  board, detail, assignees, tailLog, q, resetKanban,
  currentBoard, listBoards,
} from "../src/utils/hermes-kanban"
import { Kanban } from "../src/tabs/Kanban"

const now = Math.floor(Date.now() / 1000)

const schema = (db: Database) => {
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
}

beforeAll(() => {
  delete process.env.HERMES_KANBAN_BOARD
  mkdirSync(hermesPath("."), { recursive: true })
  mkdirSync(hermesPath("profiles/researcher"), { recursive: true })
  mkdirSync(hermesPath("profiles/writer"), { recursive: true })
  mkdirSync(hermesPath("kanban/logs"), { recursive: true })
  rmSync(hermesPath("kanban/current"), { force: true })
  writeFileSync(hermesPath("kanban/logs/t2.log"), "boot\nstep 1\nstep 2\n")
  const db = new Database(hermesPath("kanban.db"), { create: true })
  schema(db)
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

  // Second board with its own DB + log dir, and board.json metadata.
  mkdirSync(hermesPath("kanban/boards/atm10/logs"), { recursive: true })
  writeFileSync(hermesPath("kanban/boards/atm10/board.json"),
    JSON.stringify({ display_name: "ATM10 Server" }))
  writeFileSync(hermesPath("kanban/boards/atm10/logs/m1.log"), "mod boot\n")
  const db2 = new Database(hermesPath("kanban/boards/atm10/kanban.db"), { create: true })
  schema(db2)
  db2.run(
    `INSERT INTO tasks (id, title, status, priority, created_at)
     VALUES ('m1', 'upgrade forge', 'ready', 1, ?)`, [now - 100],
  )
  db2.close()
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

  test("listBoards() always leads with default; reads board.json display_name", () => {
    const bs = listBoards()
    expect(bs[0].slug).toBe("default")
    const atm = bs.find(b => b.slug === "atm10")
    expect(atm?.name).toBe("ATM10 Server")
  })

  test("board resolution: env → current file → default; paths follow slug", () => {
    expect(currentBoard()).toBe("default")
    // env wins
    process.env.HERMES_KANBAN_BOARD = "atm10"
    resetKanban()
    expect(currentBoard()).toBe("atm10")
    expect(board().get("ready")?.[0]?.id).toBe("m1")
    expect(tailLog("m1")).toContain("mod boot")
    expect(tailLog("t2")).toBeNull() // default's log invisible on atm10
    delete process.env.HERMES_KANBAN_BOARD
    // current file next
    writeFileSync(hermesPath("kanban/current"), "atm10\n")
    resetKanban()
    expect(currentBoard()).toBe("atm10")
    // cleanup → default
    rmSync(hermesPath("kanban/current"), { force: true })
    resetKanban()
    expect(currentBoard()).toBe("default")
    expect(board().get("ready")?.[0]?.id).toBe("t1")
  })
})

describe("Kanban tab", () => {
  test("columns + card nav + Enter → detail pane", async () => {
    const t = await mountNode(<Kanban focused />, { width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
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
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
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
    expect(cmds[0]).toBe("hermes kanban --board default assign t1 writer")
    t.destroy()
  })

  test("u on blocked → comment then unblock", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    // →×4 to 'blocked' col.
    for (let i = 0; i < 4; i++) { act(() => t.keys.pressArrow("right")); await t.settle() }
    await act(async () => { await t.keys.typeText("u") })
    await until(t, () => t.frame().includes("Unblock t5"))
    await act(async () => { await t.keys.typeText("use user_id") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length === 2)
    expect(cmds[0]).toBe("hermes kanban --board default comment t5 'use user_id' --author user")
    expect(cmds[1]).toBe("hermes kanban --board default unblock t5")
    t.destroy()
  })

  test("d → confirm → archive", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    for (let i = 0; i < 5; i++) { act(() => t.keys.pressArrow("right")); await t.settle() }
    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Archive task?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban --board default archive t4")
    t.destroy()
  })

  test("n → create dialog → shell.exec hermes kanban create", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "t6", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Task"))
    await act(async () => { await t.keys.typeText("ship rate limiter") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban --board default create 'ship rate limiter'")
    t.destroy()
  })

  test("D → confirm → dispatch", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => { cmds.push(p.command as string); return { stdout: "[]", stderr: "", code: 0 } },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    await act(async () => { await t.keys.typeText("D") })
    await until(t, () => t.frame().includes("Dispatch ready tasks?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => cmds.length === 1)
    expect(cmds[0]).toBe("hermes kanban --board default dispatch --json")
    t.destroy()
  })

  test("l opens log pane; Esc closes", async () => {
    const t = await mountNode(<Kanban focused />, { width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
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
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    act(() => t.keys.pressArrow("right")); await t.settle()
    act(() => t.keys.pressArrow("right")); await t.settle()
    await act(async () => { await t.keys.typeText("a") })
    await until(t, () => t.frame().includes("Assign t1"))
    act(() => t.keys.pressEnter()) // picks (unassigned)
    await until(t, () => t.frame().includes("cycle detected"))
    t.destroy()
  })

  test("b → board picker lists boards; Enter → boards switch + rebind", async () => {
    const cmds: string[] = []
    const gw = new MockGateway({
      "shell.exec": p => {
        const c = p.command as string
        cmds.push(c)
        if (c.startsWith("hermes kanban boards switch "))
          writeFileSync(hermesPath("kanban/current"), c.split(" ").pop()! + "\n")
        return { stdout: "", stderr: "", code: 0 }
      },
    })
    const t = await mountNode(<Kanban focused />, { gw, width: 180, height: 40 })
    await until(t, () => t.frame().includes("Kanban · default · 5 tasks"))
    expect(t.frame()).toContain("b boards")
    await act(async () => { await t.keys.typeText("b") })
    await until(t, () => t.frame().includes("Switch board"))
    expect(t.frame()).toContain("ATM10 Server")
    // filter to atm10 and select
    await act(async () => { await t.keys.typeText("atm") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Kanban · atm10 · 1 task"))
    expect(cmds[0]).toBe("hermes kanban boards switch atm10")
    expect(t.frame()).toContain("upgrade forge")
    // verbs on the switched board pin --board atm10
    act(() => t.keys.pressArrow("right")); await t.settle()
    act(() => t.keys.pressArrow("right")); await t.settle()
    await act(async () => { await t.keys.typeText("d") })
    await until(t, () => t.frame().includes("Archive task?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => cmds.length === 2)
    expect(cmds[1]).toBe("hermes kanban --board atm10 archive m1")
    // cleanup — restore default for any subsequent test files.
    rmSync(hermesPath("kanban/current"), { force: true })
    resetKanban()
    t.destroy()
  })
})
