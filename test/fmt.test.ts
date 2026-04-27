import { describe, expect, it, setSystemTime, afterEach } from "bun:test"
import { trunc, fmt, cost, span, dur, until, ago } from "../src/ui/fmt"

describe("fmt", () => {
  afterEach(() => setSystemTime())

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
    setSystemTime(new Date("2026-04-27T00:00:00Z"))
    const now = Date.now() / 1000
    expect(until(now - 5)).toBe("due")
    expect(until(now)).toBe("due")
    expect(until(now + 30)).toBe("in 30s")
    expect(until(now + 120)).toBe("in 2m")
    expect(until(now + 7200)).toBe("in 2h")
    expect(until(now + 172800)).toBe("in 2d")
  })
  it("ago", () => {
    setSystemTime(new Date("2026-04-27T00:00:00Z"))
    const now = Date.now() / 1000
    expect(ago(now)).toBe("just now")
    expect(ago(now - 59)).toBe("just now")
    expect(ago(now - 120)).toBe("2m ago")
    expect(ago(now - 7200)).toBe("2h ago")
    expect(ago(now - 172800)).toBe("2d ago")
  })
})
