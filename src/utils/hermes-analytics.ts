// Per-model / per-day aggregates straight from state.db.
//
// The gateway's insights.get RPC only returns bare counts; for the
// Analytics tab we need token/cost breakdowns, so read the sqlite
// file directly (same pattern as queryRecentSessions). All numbers
// come from the sessions table — it already carries rolled-up
// input/output/cache token counts and estimated/actual cost per
// session, so no join on messages is needed.

import { Database } from "bun:sqlite"
import { hermesPath } from "./hermes-home"

export type Analytics = {
  total: { sessions: number; messages: number; tokens: number; cost: number }
  byModel: Array<{ model: string; sessions: number; tokens: number; cost: number }>
  byDay: Array<{ date: string; tokens: number; cost: number }>
}

const ZERO: Analytics = {
  total: { sessions: 0, messages: 0, tokens: 0, cost: 0 },
  byModel: [],
  byDay: [],
}

type Row = Record<string, number | string | null>

const num = (v: unknown) => Number(v) || 0

export function analytics(days: number): Analytics {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  let db: Database
  try {
    db = new Database(hermesPath("state.db"), { readonly: true })
  } catch {
    return ZERO
  }
  try {
    const tot = db.query(
      `SELECT COUNT(*) n,
              COALESCE(SUM(message_count),0) msgs,
              COALESCE(SUM(input_tokens+output_tokens),0) tok,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)),0) cost
       FROM sessions WHERE started_at > ?`,
    ).get(since) as Row

    const models = db.query(
      `SELECT COALESCE(model,'(unknown)') model,
              COUNT(*) n,
              COALESCE(SUM(input_tokens+output_tokens),0) tok,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)),0) cost
       FROM sessions WHERE started_at > ?
       GROUP BY model ORDER BY tok DESC`,
    ).all(since) as Row[]

    const daily = db.query(
      `SELECT date(started_at,'unixepoch') day,
              COALESCE(SUM(input_tokens+output_tokens),0) tok,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)),0) cost
       FROM sessions WHERE started_at > ?
       GROUP BY day ORDER BY day`,
    ).all(since) as Row[]

    return {
      total: {
        sessions: num(tot.n),
        messages: num(tot.msgs),
        tokens: num(tot.tok),
        cost: num(tot.cost),
      },
      byModel: models.map(r => ({
        model: String(r.model),
        sessions: num(r.n),
        tokens: num(r.tok),
        cost: num(r.cost),
      })),
      byDay: daily.map(r => ({
        date: String(r.day),
        tokens: num(r.tok),
        cost: num(r.cost),
      })),
    }
  } catch {
    return ZERO
  } finally {
    db.close()
  }
}
