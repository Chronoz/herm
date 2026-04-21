import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { mountNode } from "./harness"
import { useInputHistory } from "../src/app/useInputHistory"

const dir = process.env.HERM_CONFIG_DIR!
const file = join(dir, "history")

type Hook = ReturnType<typeof useInputHistory>

async function setup() {
  let hook!: Hook
  let val = ""
  const Probe = () => {
    const h = useInputHistory(val, v => (val = v))
    hook = h
    return null
  }
  const t = await mountNode(<Probe />)
  return { t, hook: () => hook, val: () => val }
}

describe("useInputHistory", () => {
  beforeEach(() => {
    rmSync(file, { force: true })
  })

  test("loads from disk — ↑ recalls newest-last entry", async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, "old\nmid\nnew\n")
    const s = await setup()
    act(() => s.hook().up())
    expect(s.val()).toBe("new")
    act(() => s.hook().up())
    expect(s.val()).toBe("mid")
    act(() => s.hook().up())
    expect(s.val()).toBe("old")
    s.t.destroy()
  })

  test("push appends to disk and dedupes adjacent", async () => {
    const s = await setup()
    act(() => s.hook().push("a"))
    act(() => s.hook().push("a"))
    act(() => s.hook().push("b"))
    act(() => s.hook().push("a"))
    await s.t.settle()
    expect(readFileSync(file, "utf-8")).toBe("a\nb\na\n")
    act(() => s.hook().up())
    expect(s.val()).toBe("a")
    act(() => s.hook().up())
    expect(s.val()).toBe("b")
    s.t.destroy()
  })

  test("missing file → empty history, ↑ is a no-op", async () => {
    expect(existsSync(file)).toBe(false)
    const s = await setup()
    act(() => s.hook().up())
    expect(s.val()).toBe("")
    s.t.destroy()
  })

  test("cap at 500 — rewrites file when exceeded", async () => {
    mkdirSync(dir, { recursive: true })
    const lines = Array.from({ length: 500 }, (_, i) => `m${i}`)
    writeFileSync(file, lines.join("\n") + "\n")
    const s = await setup()
    act(() => s.hook().push("over"))
    await s.t.settle()
    const out = readFileSync(file, "utf-8").split("\n").filter(Boolean)
    expect(out.length).toBe(500)
    expect(out[0]).toBe("m1")
    expect(out[499]).toBe("over")
    s.t.destroy()
  })
})
