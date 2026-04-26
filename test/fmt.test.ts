import { describe, expect, it } from "bun:test"
import { trunc, fmt, cost, span, dur, until } from "../src/ui/fmt"

describe("fmt", () => {
  it("trunc", () => {
    expect(trunc("hello", 5)).toBe("hello")
    expect(trunc("hello world", 5)).toBe("hell…")
  })
  it("fmt abbreviates", () => {
    expect(fmt(42)).toBe("42")
    expect(fmt(1234)).toBe("1.2k")
    expect(fmt(1_234_567)).toBe("1.23M")
  })
  it("cost", () => {
    expect(cost(null)).toBe("—")
    expect(cost(1.234)).toBe("$1.23")
  })
  it("span", () => {
    expect(span(0, 30)).toBe("30s")
    expect(span(0, 90)).toBe("1m")
    expect(span(0, 3700)).toBe("1h 1m")
    expect(span(10, 5)).toBe("—")
  })
  it("dur", () => {
    expect(dur(5)).toBe("5s")
    expect(dur(65)).toBe("1m5s")
    expect(dur(3661)).toBe("1h1m")
  })
  it("until", () => {
    const now = Date.now() / 1000
    expect(until(now - 5)).toBe("due")
    expect(until(now + 30)).toMatch(/^in \d+s$/)
    expect(until(now + 120)).toBe("in 2m")
    expect(until(now + 7200)).toBe("in 2h")
    expect(until(now + 172800)).toBe("in 2d")
  })
})
