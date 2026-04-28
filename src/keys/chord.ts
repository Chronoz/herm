// Chord primitives — parse/match/print for keybinding strings.
//
// A chord string is comma-separated alternates, each alternate is
// `+`-separated modifiers followed by a key name:
//   "ctrl+shift+k"  "shift+return,ctrl+j"  "<leader>e"  "none"
//
// `<leader>` is a synthetic modifier; whether the leader is currently armed
// is provided by the caller at match time (the provider owns that state).

import type { ParsedKey } from "@opentui/core"

export type Chord = {
  readonly name: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly super: boolean
  readonly leader: boolean
}

const ALIAS: Record<string, string> = {
  esc: "escape",
  enter: "return",
  del: "delete",
  ins: "insert",
  space: "space",
  " ": "space",
}

/** Parse a chord string into its alternate Chord list. "none" / "" → []. */
export function parse(spec: string): Chord[] {
  if (!spec || spec === "none") return []
  return spec.split(",").map(one)
}

function one(combo: string): Chord {
  const c = { name: "", ctrl: false, meta: false, shift: false, super: false, leader: false }
  for (const raw of combo.replace(/<leader>/g, "leader+").toLowerCase().split("+")) {
    const p = raw.trim()
    if (!p) continue
    if (p === "ctrl") c.ctrl = true
    else if (p === "alt" || p === "meta" || p === "option") c.meta = true
    else if (p === "shift") c.shift = true
    else if (p === "super" || p === "cmd") c.super = true
    else if (p === "leader") c.leader = true
    else c.name = ALIAS[p] ?? p
  }
  return c
}

/** Normalize an OpenTUI ParsedKey to a Chord. */
export function from(key: ParsedKey, leader = false): Chord {
  // kitty protocol emits name=" " for space; legacy emits "space".
  const name = key.name === " " ? "space" : key.name
  return {
    name,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
    super: key.super ?? false,
    leader,
  }
}

function eq(a: Chord, b: Chord): boolean {
  return a.name === b.name
    && a.ctrl === b.ctrl && a.meta === b.meta
    && a.shift === b.shift && a.super === b.super
    && a.leader === b.leader
}

/** True if the event matches any alternate in the chord list. */
export function match(list: ReadonlyArray<Chord>, key: ParsedKey, leader = false): boolean {
  if (list.length === 0) return false
  const k = from(key, leader)
  return list.some(c => eq(c, k))
}

/** Render the first alternate for display. `lead` substitutes `<leader>`. */
export function print(list: ReadonlyArray<Chord>, lead?: string): string {
  const c = list[0]
  if (!c) return ""
  const mods: string[] = []
  if (c.ctrl) mods.push("Ctrl")
  if (c.meta) mods.push("Alt")
  if (c.super) mods.push("Super")
  if (c.shift) mods.push("Shift")
  const name = LABEL[c.name] ?? cap(c.name)
  const body = [...mods, name].join("+")
  if (!c.leader) return body
  return lead ? `${lead} ${body}` : `<leader> ${body}`
}

const LABEL: Record<string, string> = {
  return: "Enter",
  escape: "Esc",
  space: "Space",
  delete: "Del",
  backspace: "⌫",
  up: "↑", down: "↓", left: "←", right: "→",
  pageup: "PgUp", pagedown: "PgDn",
  home: "Home", end: "End",
  tab: "Tab",
}

function cap(s: string): string {
  return s.length === 1 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1)
}

/** Chord[] → KeyBinding[] for the textarea renderable's keyBindings prop. */
export function toBindings<A extends string>(list: ReadonlyArray<Chord>, action: A) {
  return list.map(c => ({
    name: c.name,
    ctrl: c.ctrl || undefined,
    meta: c.meta || undefined,
    shift: c.shift || undefined,
    super: c.super || undefined,
    action,
  }))
}

/** Canonical string key for a Chord — for Map-bucketing by chord equality. */
export function key(c: Chord): string {
  return `${c.leader ? "L" : ""}${c.ctrl ? "C" : ""}${c.meta ? "M" : ""}${c.shift ? "S" : ""}${c.super ? "W" : ""}-${c.name}`
}
