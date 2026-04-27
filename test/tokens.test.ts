import { describe, test, expect, beforeEach } from "bun:test"
import { count, clearCache } from "../src/utils/tokens"

describe("tokens.count", () => {
  beforeEach(clearCache)

  test("empty string → 0", () => {
    expect(count("")).toBe(0)
  })

  test("prose — short English text", () => {
    const n = count("The quick brown fox jumps over the lazy dog")
    // o200k_base ~9-10 tokens for this sentence.
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThan(15)
  })

  test("returns a number for JSON / schema-like content", () => {
    // Real tool schemas trend LOWER than chars/4 because JSON keys and
    // structural tokens (\"type\", \"properties\", etc.) are single-token
    // even at 8-12 chars. The point is accuracy, not a fixed direction.
    const json = JSON.stringify({
      name: "file_write",
      description: "Write content to a file.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    })
    const n = count(json)
    const rough = Math.ceil(json.length / 4)
    // Must be different from the rough heuristic (that\'s the whole point)
    expect(n).not.toBe(rough)
    expect(n).toBeGreaterThan(0)
  })

  test("CJK — tokenizer counts more accurately than chars/4", () => {
    // CJK chars are 1-3 tokens each; chars/4 massively undercounts.
    const text = "你好世界你好世界你好世界你好世界你好世界"
    const tokens = count(text)
    const roughFour = Math.ceil(text.length / 4)
    expect(tokens).toBeGreaterThan(roughFour)
  })

  test("cached — identical strings return same count", () => {
    const s = "some repeated text " + Math.random()
    expect(count(s)).toBe(count(s))
  })

  test("cache eviction — many unique strings without crash", () => {
    for (let i = 0; i < 1100; i++) count(`unique-string-${i}`)
    expect(count("final")).toBeGreaterThan(0)
  })
})
