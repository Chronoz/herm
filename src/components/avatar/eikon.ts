/**
 * .eikon file parser — NDJSON stateful ASCII animation format.
 *
 * Line 1 is a header object. Subsequent lines are either state
 * declarations (`{state, fps, frame_count, ...}`) or frame objects
 * (`{f, data, ...}`) belonging to the most recent state. Unknown
 * fields are ignored; unknown format versions are tolerated.
 *
 * See ~/Dev/eikon/docs/SPEC.md.
 */

import { readdirSync, openSync, readSync, closeSync } from "fs"
import { join } from "path"

export type EikonMeta = {
  version: number
  name: string
  author?: string
  width: number
  height: number
  states: string[]
  [k: string]: unknown
}

export type EikonState = {
  fps: number
  /** Each frame as an array of lines (row-per-string). */
  frames: string[][]
}

export type ParsedEikon = {
  meta: EikonMeta
  states: Map<string, EikonState>
}

type Row = Record<string, unknown>

const num = (v: unknown, d: number) => typeof v === "number" && isFinite(v) ? v : d
const str = (v: unknown, d = "") => typeof v === "string" ? v : d

function parse(line: string, n: number): Row {
  try { return JSON.parse(line) as Row }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`eikon: malformed JSON on line ${n}: ${msg}`)
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Parse a full .eikon NDJSON document. Throws with line number on bad JSON. */
export function parseEikon(text: string): ParsedEikon {
  const lines = text.split("\n")
  if (!lines[0]?.trim()) throw new Error("eikon: empty file (no header on line 1)")

  const head = parse(lines[0], 1)
  const meta: EikonMeta = {
    ...head,
    version: num(head.eikon ?? head.version, 1),
    name: str(head.name, "unnamed"),
    author: typeof head.author === "string" ? head.author : undefined,
    width: num(head.width, 0),
    height: num(head.height, 0),
    states: Array.isArray(head.states) ? (head.states as string[]) : [],
  }

  const states = new Map<string, EikonState>()
  let cur: { name: string; fps?: number; frames: string[][]; durs: number[] } | null = null

  const seal = () => {
    if (!cur) return
    const fps = cur.fps ?? (cur.durs.length ? Math.round(1000 / median(cur.durs)) || 12 : 12)
    states.set(cur.name, { fps, frames: cur.frames })
    cur = null
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw || !raw.trim()) continue
    const obj = parse(raw, i + 1)

    if (typeof obj.state === "string") {
      seal()
      cur = {
        name: obj.state,
        fps: typeof obj.fps === "number" ? obj.fps : undefined,
        frames: [],
        durs: [],
      }
      continue
    }

    // Frame line — attach to current state.
    if (!cur) continue
    const data = typeof obj.data === "string"
      ? obj.data.split("\n")
      : Array.isArray(obj.lines) ? (obj.lines as string[]) : []
    cur.frames.push(data)
    const ms = num(obj.duration_ms, 0) || num(obj.pause, 0) * 1000
    if (ms > 0) cur.durs.push(ms)
  }
  seal()

  if (meta.states.length === 0) meta.states = Array.from(states.keys())
  return { meta, states }
}

/** Read just the header (line 1) of a .eikon file without loading the rest. */
function peek(path: string): EikonMeta | null {
  const fd = openSync(path, "r")
  try {
    const buf = Buffer.alloc(8192)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const first = buf.toString("utf8", 0, n).split("\n", 1)[0]
    if (!first) return null
    return parseEikon(first).meta
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/**
 * Scan directories (non-recursive per dir, but walks one level deep) for
 * `*.eikon` files and return their header metadata. Missing dirs are
 * silently skipped.
 */
export function listEikons(dirs: string[]): { path: string; meta: EikonMeta }[] {
  return dirs.flatMap(dir => {
    let entries: string[]
    try { entries = readdirSync(dir, { recursive: true }) as string[] }
    catch { return [] }
    return entries
      .filter(e => e.endsWith(".eikon"))
      .map(e => join(dir, e))
      .map(path => ({ path, meta: peek(path) }))
      .filter((x): x is { path: string; meta: EikonMeta } => x.meta !== null)
  })
}
