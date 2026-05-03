import { describe, expect, test } from "bun:test"
import { isDangerous } from "../src/utils/control"
import { TABS } from "../src/app/tabs"

const idx = (name: string) => TABS.findIndex(t => t.name === name)

describe("control.isDangerous — guards the intended tabs by name, not hardcoded index", () => {
  test("Chat: Enter guarded (regression — was drifted to Context's index)", () => {
    expect(isDangerous(idx("Chat"), "return", false)).toBe(true)
  })

  test("Sessions: d/delete/Enter guarded (regression — was drifted to Agents' index)", () => {
    expect(isDangerous(idx("Sessions"), "d", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "delete", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "return", false)).toBe(true)
  })

  test("Config: toggles, edits, Ctrl+S guarded", () => {
    const c = idx("Config")
    expect(isDangerous(c, "space", false)).toBe(true)
    expect(isDangerous(c, "return", false)).toBe(true)
    expect(isDangerous(c, "h", false)).toBe(true)
    expect(isDangerous(c, "s", true)).toBe(true)
    expect(isDangerous(c, "s", false)).toBe(false)  // bare 's' fine
  })

  test("Env: return/space/d/delete guarded", () => {
    const e = idx("Env")
    expect(isDangerous(e, "return", false)).toBe(true)
    expect(isDangerous(e, "space", false)).toBe(true)
    expect(isDangerous(e, "d", false)).toBe(true)
  })

  test("Non-guarded tabs accept any key", () => {
    for (const name of ["Context", "Agents", "Analytics", "Skills", "Cron", "Toolsets", "Memory", "Kanban"]) {
      expect(isDangerous(idx(name), "return", false)).toBe(false)
      expect(isDangerous(idx(name), "d", false)).toBe(false)
    }
  })

  test("Unknown tab index returns false (no crash)", () => {
    expect(isDangerous(99, "return", false)).toBe(false)
    expect(isDangerous(-1, "return", false)).toBe(false)
  })
})
