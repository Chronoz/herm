import { describe, expect, test } from "bun:test"
import { KEYWORDS, match } from "../src/app/useAtRefPopover"

describe("atref keywords", () => {
  test("bare @ shows all fixed keywords", () => {
    const texts = match("@").map(k => k.text)
    expect(texts).toEqual([
      "@diff", "@staged", "@git:1", "@git:3", "@git:5", "@url:", "@folder:",
    ])
    // presets for @git:<n>
    expect(KEYWORDS.filter(k => k.text.startsWith("@git:"))).toHaveLength(3)
  })

  test("typed prefix narrows case-insensitively", () => {
    expect(match("@di").map(k => k.text)).toEqual(["@diff"])
    expect(match("@DI").map(k => k.text)).toEqual(["@diff"])
    expect(match("@g").map(k => k.text)).toEqual(["@git:1", "@git:3", "@git:5"])
    expect(match("@s").map(k => k.text)).toEqual(["@staged"])
    expect(match("@x")).toEqual([])
  })

  test("@folder: / @url: drop out once the prefix is complete → path/URL takes over", () => {
    // exact match is excluded so accepting `@folder:` hands off to
    // gateway path completion instead of re-offering itself
    expect(match("@folder:")).toEqual([])
    expect(match("@folder:src/")).toEqual([])
    expect(match("@url:")).toEqual([])
    // but partial prefix still offers the keyword
    expect(match("@fold").map(k => k.text)).toEqual(["@folder:"])
  })
})
