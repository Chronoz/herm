/**
 * context-segments.ts — Parse the Hermes system prompt into sections,
 * group them into a two-level hierarchy, and generate grids.
 *
 * Level 0 (top):  System & Prompt | Tools | Conversation | Free
 * Level 1 (drill): Children of a group, e.g. SOUL | Memory | Skills | ...
 *
 * The grid always fills 256 cells. At top level, percentages are relative
 * to the full context length. At drill level, relative to the parent group.
 */

import type { Source, ToolInfo } from "./hermes-home"
import { makeSource } from "./hermes-home"
import { count as tok } from "./tokens"

// ─── Types ───────────────────────────────────────────────────────────

/** A parsed section of the system prompt */
export type Section = {
  readonly id: string
  readonly label: string
  readonly chars: number
  readonly tokens: number
  readonly text: string
  readonly source?: Source
}

/** A segment in the grid — leaf or group */
export type Segment = {
  readonly id: string
  readonly label: string
  readonly tokens: number
  readonly percent: number
  readonly children?: ReadonlyArray<Segment>
  readonly section?: Section
}

/** Grid cell */
export type Cell = { readonly id: string }

// ─── Constants ───────────────────────────────────────────────────────

const GRID = 256
// Chars-per-token fallback for cases where only a char count is known
// (e.g. ToolInfo exposes description/param lengths, not the text itself).
const CPT = 4

/** Which parsed section IDs belong to the "system" group */
const SYSTEM_IDS = new Set([
  "soul", "memory", "user", "mem0", "skills", "project", "meta", "other",
])

// ─── System Prompt Parser ────────────────────────────────────────────

/** Parse raw system prompt text into sections by structural delimiters */
export function parse(text: string): Section[] {
  if (!text) return []

  const sections: Section[] = []
  const used = new Array(text.length).fill(false)

  const mark = (start: number, end: number, id: string, label: string, source?: Source) => {
    const slice = text.slice(start, end)
    if (slice.trim().length === 0) return
    for (let i = start; i < end; i++) used[i] = true
    sections.push({ id, label, chars: slice.length, tokens: tok(slice), text: slice, source })
  }

  // SOUL.md — start to first ══════
  const bar1 = text.indexOf("══════")
  if (bar1 > 0) mark(0, bar1, "soul", "SOUL.md", makeSource("SOUL.md"))

  // MEMORY block
  const memH = text.indexOf("MEMORY (your personal notes)")
  if (memH >= 0) {
    const s = text.lastIndexOf("══════", memH)
    const after = text.indexOf("\n", text.indexOf("══════", memH + 1))
    const next = text.indexOf("══════", after > 0 ? after : memH + 40)
    const e = next > 0 ? text.lastIndexOf("\n", next) + 1 : text.length
    if (s >= 0) mark(s, e, "memory", "Memory Notes", makeSource("memories/MEMORY.md", "MEMORY.md"))
  }

  // USER PROFILE block
  const userH = text.indexOf("USER PROFILE (who the user is)")
  if (userH >= 0) {
    const s = text.lastIndexOf("══════", userH)
    const after = text.indexOf("\n", text.indexOf("══════", userH + 1))
    const rest = text.slice(after > 0 ? after : userH + 40)
    const next = rest.search(/\n#\s/)
    const e = next >= 0 ? (after > 0 ? after : userH + 40) + next + 1 : text.length
    if (s >= 0) mark(s, e, "user", "User Profile", makeSource("memories/USER.md", "USER.md"))
  }

  // Mem0 Memory
  const m0 = text.indexOf("# Mem0 Memory")
  if (m0 >= 0) {
    const rest = text.slice(m0 + 1)
    const next = rest.search(/\n##?\s/)
    mark(m0, next >= 0 ? m0 + 1 + next + 1 : text.length, "mem0", "Mem0 Memory")
  }

  // Skills catalog
  const skH = text.indexOf("## Skills (mandatory)")
  const skE = text.indexOf("</available_skills>")
  if (skH >= 0 && skE >= 0) {
    let end = text.indexOf("\n", skE)
    while (end < text.length && end >= 0) {
      const nl = text.indexOf("\n", end + 1)
      if (nl < 0) { end = text.length; break }
      const line = text.slice(end + 1, nl).trim()
      if (line.startsWith("#")) break
      if (line === "") {
        const peek = text.slice(nl + 1, text.indexOf("\n", nl + 1)).trim()
        if (peek.startsWith("#")) { end = nl; break }
      }
      end = nl
    }
    mark(skH, end + 1, "skills", "Skills Catalog", makeSource("skills", "skills/"))
  }

  // Project Context
  const proj = text.indexOf("# Project Context")
  if (proj >= 0) {
    const conv = text.indexOf("Conversation started:")
    mark(proj, conv > proj ? conv : text.length, "project", "Project Context", makeSource("AGENTS.md"))
  }

  // Session metadata
  const conv = text.indexOf("Conversation started:")
  if (conv >= 0) mark(conv, text.length, "meta", "Session Metadata")

  // Unmarked regions → "other"
  let start = -1
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && !used[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      const slice = text.slice(start, i)
      if (slice.trim().length > 0) {
        sections.push({ id: "other", label: "Other", chars: slice.length, tokens: tok(slice), text: slice })
      }
      start = -1
    }
  }

  return sections.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text))
}

// ─── Segment Builder ─────────────────────────────────────────────────

type Opts = {
  contextLength: number
  inputTokens: number
  sections: ReadonlyArray<Section>
  conversationTokens: number
  tools: ReadonlyArray<ToolInfo>
}

/**
 * Build the two-level segment hierarchy.
 * Returns top-level groups. The "system" group contains children
 * that can be drilled into.
 */
export function build(opts: Opts): Segment[] {
  const pct = (t: number) => (t / opts.contextLength) * 100
  const result: Segment[] = []

  // System prompt children
  const children = opts.sections
    .filter(sec => SYSTEM_IDS.has(sec.id) && sec.tokens > 0)
    .map(sec => ({
      id: sec.id,
      label: sec.label,
      tokens: sec.tokens,
      percent: pct(sec.tokens),
      section: sec,
    }))

  // System group
  const sysTok = children.reduce((s, c) => s + c.tokens, 0)
  if (sysTok > 0) {
    result.push({
      id: "system",
      label: "System & Prompt",
      tokens: sysTok,
      percent: pct(sysTok),
      children,
    })
  }

  // Tools
  const toolTok = opts.tools.reduce(
    (s, t) => s + Math.ceil((t.descriptionLength + t.paramsLength) / CPT), 0,
  )
  if (toolTok > 0) {
    result.push({ id: "tools", label: "Tool Schemas", tokens: toolTok, percent: pct(toolTok) })
  }

  // Conversation
  if (opts.conversationTokens > 0) {
    const ct = Math.min(opts.conversationTokens, opts.inputTokens)
    result.push({ id: "conversation", label: "Conversation", tokens: ct, percent: pct(ct) })
  }

  // Free
  const taken = result.reduce((s, g) => s + g.tokens, 0)
  const free = Math.max(0, opts.contextLength - taken)
  result.push({ id: "free", label: "Free", tokens: free, percent: pct(free) })

  return result
}

/**
 * Get drilled-in segments for a group, with percentages rescaled
 * to fill the grid relative to the group's total.
 */
export function drill(group: Segment): Segment[] {
  if (!group.children || group.children.length === 0) return []
  const total = group.tokens
  return group.children.map(c => ({
    ...c,
    percent: total > 0 ? (c.tokens / total) * 100 : 0,
  }))
}

// ─── Grid Generator ──────────────────────────────────────────────────

/** Generate 256 cells from segments, proportional to percent */
export function cells(segments: ReadonlyArray<Segment>, fallback = "free"): Cell[] {
  const filled = segments.flatMap(seg =>
    Array.from({ length: Math.round((seg.percent / 100) * GRID) }, () => ({ id: seg.id }))
  )
  const pad = Array.from({ length: Math.max(0, GRID - filled.length) }, () => ({ id: fallback }))
  return [...filled, ...pad].slice(0, GRID)
}
