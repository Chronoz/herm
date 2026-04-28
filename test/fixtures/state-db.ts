// Shared fixture for the sandbox HERMES_HOME/state.db.
//
// Multiple test files read this db (analytics, memory-activity,
// recentSessions); the preload sandbox is process-wide, so whichever
// file's beforeAll fires first owns the CREATE TABLE. Centralise the
// superset schema here and have every writer use named-column inserts
// so file order never matters.

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"

const HH = process.env.HERMES_HOME!

export const openStateDb = (): Database => {
  mkdirSync(HH, { recursive: true })
  const db = new Database(`${HH}/state.db`, { create: true })
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT, source TEXT, model TEXT,
    started_at REAL, ended_at REAL, end_reason TEXT,
    message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL, actual_cost_usd REAL,
    parent_session_id TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT, role TEXT, content TEXT,
    tool_calls TEXT, tool_name TEXT, timestamp REAL
  )`)
  return db
}
