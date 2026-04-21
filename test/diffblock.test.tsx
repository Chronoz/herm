import { describe, expect, test } from "bun:test"
import { mountNode, until } from "./harness"
import { DiffBlock, intraline, wordDiff } from "../src/components/chat/DiffBlock"

describe("wordDiff", () => {
  test("highlights the differing word, keeps common prefix/suffix", () => {
    const [rm, ad] = wordDiff("const foo = 1", "const bar = 1")
    expect(rm).toEqual([
      { text: "const ", hi: false },
      { text: "foo", hi: true },
      { text: " = 1", hi: false },
    ])
    expect(ad).toEqual([
      { text: "const ", hi: false },
      { text: "bar", hi: true },
      { text: " = 1", hi: false },
    ])
  })

  test("identical lines yield no highlighted segments", () => {
    const [rm, ad] = wordDiff("same line", "same line")
    expect(rm.every(s => !s.hi)).toBe(true)
    expect(ad.every(s => !s.hi)).toBe(true)
  })
})

describe("intraline", () => {
  const head = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,3 +1,3 @@"]

  test("pairs a `-` immediately followed by `+` and marks the changed word", () => {
    const rows = [...head, " keep", "-const foo = 1", "+const bar = 1", " keep"]
    const marks = intraline(rows)
    // headers / context untouched
    expect(marks.slice(0, 4)).toEqual([null, null, null, null])
    expect(marks[6]).toBeNull()
    // paired change lines carry segments with exactly the differing word highlighted
    expect(marks[4]!.find(s => s.hi)!.text).toBe("foo")
    expect(marks[5]!.find(s => s.hi)!.text).toBe("bar")
    // unhighlighted parts reconstruct the remainder
    expect(marks[4]!.map(s => s.text).join("")).toBe("const foo = 1")
  })

  test("N removes then N adds pair index-wise; surplus stays line-level", () => {
    const rows = [...head, "-a one", "-b two", "-c three", "+a ONE", "+b TWO"]
    const marks = intraline(rows)
    expect(marks[3]!.find(s => s.hi)!.text).toBe("one")
    expect(marks[4]!.find(s => s.hi)!.text).toBe("two")
    // third remove has no partner → unpaired, whole-line
    expect(marks[5]).toBeNull()
    expect(marks[6]!.find(s => s.hi)!.text).toBe("ONE")
    expect(marks[7]!.find(s => s.hi)!.text).toBe("TWO")
  })

  test("unpaired lines (remove without following add) stay line-level", () => {
    const rows = [...head, "-gone", " ctx", "+new"]
    const marks = intraline(rows)
    expect(marks[3]).toBeNull()
    expect(marks[5]).toBeNull()
  })

  test("file headers (---/+++) are never treated as change lines", () => {
    const marks = intraline(head)
    expect(marks).toEqual([null, null, null])
  })

  test(">40 lines skips word diff entirely", () => {
    const rows = Array.from({ length: 41 }, (_, i) => i % 2 ? "+x y" : "-x z")
    const marks = intraline(rows)
    expect(marks.every(m => m === null)).toBe(true)
    // at the cap it still computes
    expect(intraline(rows.slice(0, 40)).some(m => m !== null)).toBe(true)
  })
})

describe("DiffBlock render", () => {
  test("renders paired change lines with full text intact", async () => {
    const diff = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1 @@",
      "-const foo = 1",
      "+const bar = 1",
    ].join("\n")
    const t = await mountNode(<DiffBlock text={diff} />, { width: 80, height: 20 })
    await until(t, () => t.frame().includes("@@ -1 +1 @@"))
    const f = t.frame()
    expect(f).toContain("-const foo = 1")
    expect(f).toContain("+const bar = 1")
    t.destroy()
  })
})
