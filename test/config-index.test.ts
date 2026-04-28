import { describe, expect, test } from "bun:test"
import { buildFields, groupOf, GROUPS } from "../src/config"
import { SCHEMA, SCHEMA_KEYS } from "../src/config/schema"

describe("config/index", () => {
  test("buildFields with empty user config yields every schema key with set=false", () => {
    const fs = buildFields({})
    expect(fs.length).toBe(SCHEMA_KEYS.length)
    for (const f of fs) {
      expect(f.set, f.key).toBe(false)
      expect(f.value).toEqual(SCHEMA[f.key].default)
    }
  })

  test("user-set leaf flips set=true and overrides value", () => {
    const fs = buildFields({ compression: { threshold: 0.8 } })
    const f = fs.find(x => x.key === "compression.threshold")!
    expect(f.set).toBe(true)
    expect(f.value).toBe(0.8)
    const other = fs.find(x => x.key === "compression.enabled")!
    expect(other.set).toBe(false)
  })

  test("list/dict schema keys classify as readonly", () => {
    const fs = buildFields({})
    expect(fs.find(x => x.key === "terminal.docker_volumes")!.type).toBe("readonly")
    expect(fs.find(x => x.key === "providers")!.type).toBe("readonly")
    expect(fs.find(x => x.key === "agent.max_turns")!.type).toBe("number")
  })

  test("unknown user key surfaces as an extra field", () => {
    const fs = buildFields({ mystery: { flag: true } })
    const f = fs.find(x => x.key === "mystery.flag")
    expect(f).toBeDefined()
    expect(f!.set).toBe(true)
    expect(f!.type).toBe("boolean")
  })

  test("user dict under a known dict-typed leaf doesn't recurse into children", () => {
    const fs = buildFields({ providers: { openai: { api_key: "x" } } })
    expect(fs.find(x => x.key === "providers.openai.api_key")).toBeUndefined()
    const p = fs.find(x => x.key === "providers")!
    expect(p.type).toBe("readonly")
    expect(p.set).toBe(true)
    expect(p.value).toEqual({ openai: { api_key: "x" } })
  })

  test("GROUPS is stable, starts with general, ≤20 entries after merges", () => {
    expect(GROUPS[0]).toBe("general")
    expect(GROUPS.length).toBeLessThanOrEqual(20)
    expect(new Set(GROUPS).size).toBe(GROUPS.length)
  })

  test("every schema key maps to a group in GROUPS", () => {
    for (const k of SCHEMA_KEYS)
      expect(GROUPS.includes(groupOf(k)), `${k} → ${groupOf(k)}`).toBe(true)
  })
})
