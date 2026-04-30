import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { openStateDb } from "./fixtures/state-db"
import { searchSessions, queryRecentSessions } from "../src/utils/hermes-home"

// Seeds a clean state.db and exercises the real SQL paths in
// hermes-home.ts — queryRecentSessions and searchSessions.
//
// The sandbox state.db is process-wide (see test/preload.ts), so we
// wipe tables before each seed AND at the end, leaving the DB empty
// for unrelated tests that expect "No sessions" rendering.

const wipe = () => {
  const db = openStateDb()
  db.run("DELETE FROM messages")
  db.run("DELETE FROM sessions")
  db.close()
}

const seed = () => {
  const db = openStateDb()
  db.run("DELETE FROM messages")
  db.run("DELETE FROM sessions")
  return db
}

const sess = (
  db: ReturnType<typeof openStateDb>,
  id: string,
  source: string,
  ts: number,
  extra: Record<string, string | number | null> = {},
) => {
  const cols = ["id", "source", "started_at", "message_count", ...Object.keys(extra)]
  const vals = [id, source, ts, 1, ...Object.values(extra)]
  const q = `INSERT INTO sessions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  db.prepare(q).run(...vals)
}

const msg = (
  db: ReturnType<typeof openStateDb>,
  sid: string,
  role: string,
  content: string,
  ts = 1000,
) => {
  db.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)")
    .run(sid, role, content, ts)
}

describe("searchSessions (gsk.12: all sources, not just tui/cli)", () => {
  beforeEach(() => {
    const db = seed()
    // One session per surface, all containing the same FTS keyword.
    for (const [id, source] of [
      ["t1", "tui"], ["c1", "cli"], ["d1", "discord"],
      ["g1", "telegram"], ["a1", "api_server"], ["s1", "slack"],
    ] as const) {
      sess(db, id, source, 1700000000)
      msg(db, id, "user", `please find the unicornkeyword here (${source})`, 1700000001)
    }
    db.close()
  })
  afterAll(wipe)

  test("returns hits from every source, not just tui and cli", () => {
    const hits = searchSessions("unicornkeyword", 20)
    const sources = hits.map(h => h.source).sort()
    expect(sources).toEqual(
      ["api_server", "cli", "discord", "slack", "telegram", "tui"].sort(),
    )
  })

  test("discord-only session content is searchable", () => {
    const hits = searchSessions("unicornkeyword", 20).filter(h => h.source === "discord")
    expect(hits).toHaveLength(1)
    expect(hits[0].session_id).toBe("d1")
    expect(hits[0].snippet).toContain("unicornkeyword")
  })
})

describe("queryRecentSessions (baseline — all sources surface)", () => {
  beforeEach(() => {
    const db = seed()
    sess(db, "t1", "tui", 1700000100)
    sess(db, "d1", "discord", 1700000200)
    sess(db, "g1", "telegram", 1700000300)
    msg(db, "t1", "user", "tui content")
    msg(db, "d1", "user", "discord content")
    msg(db, "g1", "user", "telegram content")
    db.close()
  })
  afterAll(wipe)

  test("lists every source with no filter", () => {
    const rows = queryRecentSessions(10)
    const sources = rows.map(r => r.sessionSource).sort()
    expect(sources).toEqual(["discord", "telegram", "tui"])
  })
})
