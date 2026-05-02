import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OC_TO_HERM, loadOcKeybinds } from "../src/keys/oc-compat"
import { DEFAULTS } from "../src/keys/catalog"
import { parse } from "../src/keys/chord"

describe("keys/oc-compat", () => {
  test("every mapped target is a real ActionId; no duplicates", () => {
    const targets = OC_TO_HERM.map(([, h]) => h)
    for (const id of targets) expect(id in DEFAULTS).toBe(true)
    expect(new Set(targets).size).toBe(targets.length)
    expect(new Set(OC_TO_HERM.map(([oc]) => oc)).size).toBe(OC_TO_HERM.length)
  })

  test("loadOcKeybinds: project overrides global; unmapped skipped; 'none' passes", () => {
    const cwd = mkdtempSync(join(tmpdir(), "herm-oc-"))
    // project-local wins over global; global is $HOME — can't write there in
    // tests, so layer project + .opencode/ instead (both post-global).
    writeFileSync(join(cwd, "tui.json"), JSON.stringify({
      keybinds: {
        leader: "ctrl+space",
        command_list: "ctrl+p",
        session_compact: "none",
        agent_cycle: "tab",           // no herm equivalent
        input_word_forward: "alt+f",  // no herm equivalent
      },
    }))
    mkdirSync(join(cwd, ".opencode"), { recursive: true })
    writeFileSync(join(cwd, ".opencode", "tui.json"), JSON.stringify({
      keybinds: { command_list: "ctrl+shift+p" },  // higher precedence
    }))

    const r = loadOcKeybinds(cwd)
    expect(r.sources).toHaveLength(2)
    expect(r.overrides.leader).toBe("ctrl+space")
    expect(r.overrides["palette.open"]).toBe("ctrl+shift+p")
    expect(r.overrides["session.compress"]).toBe("none")
    expect(parse(r.overrides["session.compress"]!)).toEqual([])
    expect(r.skipped.sort()).toEqual(["agent_cycle", "input_word_forward"])
    // Chord grammar compatible: everything we imported parses.
    for (const v of Object.values(r.overrides))
      expect(() => parse(v!)).not.toThrow()
  })

  test("no files → empty result", () => {
    const r = loadOcKeybinds(mkdtempSync(join(tmpdir(), "herm-oc-empty-")))
    expect(r.sources).toHaveLength(0)
    expect(Object.keys(r.overrides)).toHaveLength(0)
    expect(r.skipped).toHaveLength(0)
  })
})
