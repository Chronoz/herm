import { describe, expect, test } from "bun:test"
import { resetTerminalModes, TERMINAL_MODE_RESET } from "../src/utils/terminal-reset"

// Ported from hermes-agent ui-tui/src/__tests__/terminalModes.test.ts.
// Validates the reset blob contains every mode we care about, and the
// stream-write fallback works for mocked TTYs without a real fd.

describe("terminal mode reset", () => {
  test("includes common sticky input modes", () => {
    // Locator reporting (DEC VT330+).
    expect(TERMINAL_MODE_RESET).toContain("\x1b[0'z")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[0'{")
    // Passive mouse (contour).
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?2029l")
    // Full mouse-mode ladder.
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1016l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1015l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1006l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1005l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1003l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1002l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1001l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1000l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?9l")
    // Focus events, bracketed paste, alt-screen.
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1004l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?2004l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1049l")
    // Kitty keyboard + modifyOtherKeys.
    expect(TERMINAL_MODE_RESET).toContain("\x1b[<u")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[>4;0m")
    // Attributes + cursor show.
    expect(TERMINAL_MODE_RESET).toContain("\x1b[0m")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?25h")
  })

  test("writes reset sequence to TTY streams without fds (stream.write fallback)", () => {
    const calls: string[] = []
    const write = (s: string) => { calls.push(s); return true }
    const mock = { isTTY: true, write } as unknown as NodeJS.WriteStream
    expect(resetTerminalModes(mock)).toBe(true)
    expect(calls).toEqual([TERMINAL_MODE_RESET])
  })

  test("skips non-TTY streams (no corrupting pipes)", () => {
    const calls: string[] = []
    const write = (s: string) => { calls.push(s); return true }
    const mock = { isTTY: false, write } as unknown as NodeJS.WriteStream
    expect(resetTerminalModes(mock)).toBe(false)
    expect(calls.length).toBe(0)
  })

  test("stream.write that throws returns false without crashing", () => {
    const mock = {
      isTTY: true,
      write: () => { throw new Error("pipe closed") },
    } as unknown as NodeJS.WriteStream
    expect(resetTerminalModes(mock)).toBe(false)
  })
})
