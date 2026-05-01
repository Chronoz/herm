import { describe, test, expect } from "bun:test"
import { inline } from "../src/ui/ticker"

describe("inline() — one-line markdown → styled segments", () => {
  test("plain text is a single segment", () => {
    expect(inline("hello world")).toEqual([{ t: "hello world" }])
  })
  test("**bold**, `code`, _italic_", () => {
    expect(inline("a **b** `c` _d_")).toEqual([
      { t: "a " }, { t: "b", b: true }, { t: " " },
      { t: "c", c: true }, { t: " " }, { t: "d", i: true },
    ])
  })
  test("code wins over emphasis inside it", () => {
    expect(inline("see `**not bold**`")).toEqual([
      { t: "see " }, { t: "**not bold**", c: true },
    ])
  })
  test("snake_case and a*b are not emphasis", () => {
    expect(inline("snake_case a*b")).toEqual([{ t: "snake_case a*b" }])
  })
  test("glob **/*.ts is not bold", () => {
    expect(inline("rg **/*.ts")).toEqual([{ t: "rg **/*.ts" }])
  })
  test("leading ## stripped from non-code segment", () => {
    expect(inline("## Heading `keep ##`")).toEqual([
      { t: "Heading " }, { t: "keep ##", c: true },
    ])
  })
})
