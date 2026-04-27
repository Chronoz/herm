import { describe, expect, test } from "bun:test"
import { DEFAULTS, inScope, type ActionId, type Scope } from "../src/keys/catalog"
import { parse, type Chord } from "../src/keys/chord"

const ids = Object.keys(DEFAULTS) as ActionId[]

describe("catalog", () => {
  test("every chord string parses to ≥1 alternate", () => {
    for (const id of ids) {
      const list = parse(DEFAULTS[id].chord)
      expect(list.length, `${id}: "${DEFAULTS[id].chord}"`).toBeGreaterThan(0)
      for (const c of list) expect(c.name, `${id}: empty key name`).not.toBe("")
    }
  })

  test("no duplicate chord within a scope", () => {
    const key = (c: Chord) =>
      `${c.name}:${+c.ctrl}${+c.meta}${+c.shift}${+c.super}${+c.leader}`
    const scopes = new Set(ids.map(id => DEFAULTS[id].scope))
    for (const s of scopes) {
      const seen = new Map<string, ActionId>()
      for (const id of inScope(s as Scope)) {
        for (const c of parse(DEFAULTS[id].chord)) {
          const k = key(c)
          const prev = seen.get(k)
          expect(prev, `[${s}] ${id} collides with ${prev} on ${DEFAULTS[id].chord}`).toBeUndefined()
          seen.set(k, id)
        }
      }
    }
  })

  test("leader entry exists and is a plain modifier chord", () => {
    const l = parse(DEFAULTS.leader.chord)[0]
    expect(l.leader).toBe(false)
    expect(l.name).not.toBe("")
  })

  test("inScope partitions the full set", () => {
    const scopes = [...new Set(ids.map(id => DEFAULTS[id].scope))]
    const total = scopes.reduce((n, s) => n + inScope(s).length, 0)
    expect(total).toBe(ids.length)
  })
})
