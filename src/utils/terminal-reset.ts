// Reset sticky terminal modes. Ported from hermes-agent
// ui-tui/src/lib/terminalModes.ts (v0.12.0, commits d05497f81 +
// cad7944b9).
//
// Why this exists: @opentui/core only resets ?1049 (alt-screen) on
// shutdown. If a prior TUI crashed with any of the modes below still
// enabled — mouse reporting, focus events, bracketed paste, kitty
// keyboard protocol — the terminal tab poisons the next process.
// Symptoms: raw `[<35;12;8M` cursor-motion escapes dumped into the
// composer, phantom focus events, paste wrapped in [200~...[201~,
// kitty CSI-u sequences interpreted as literal input.
//
// We emit this on startup (self-heal a poisoned tab from a prior
// crashed process) and on every exit path (so our own crash doesn't
// poison the next shell prompt).

import { writeSync } from "node:fs"

export const TERMINAL_MODE_RESET =
  "\x1b[0'z" +     // DEC locator reporting
  "\x1b[0'{" +     // selectable locator events
  "\x1b[?2029l" +  // passive mouse
  "\x1b[?1016l" +  // SGR-pixels mouse
  "\x1b[?1015l" +  // urxvt decimal mouse
  "\x1b[?1006l" +  // SGR mouse
  "\x1b[?1005l" +  // UTF-8 extended mouse
  "\x1b[?1003l" +  // any-motion mouse
  "\x1b[?1002l" +  // button-motion mouse
  "\x1b[?1001l" +  // highlight mouse
  "\x1b[?1000l" +  // click mouse
  "\x1b[?9l" +     // X10 mouse
  "\x1b[?1004l" +  // focus events
  "\x1b[?2004l" +  // bracketed paste
  "\x1b[?1049l" +  // alternate screen
  "\x1b[<u" +      // kitty keyboard (pop stack)
  "\x1b[>4;0m" +   // modifyOtherKeys → level 0
  "\x1b[0m" +      // SGR attributes
  "\x1b[?25h"      // cursor visible

type ResettableStream = Pick<NodeJS.WriteStream, "isTTY" | "write"> & {
  fd?: number
}

/**
 * Synchronously emit the reset blob to `stream`.
 *
 * Returns true if the write succeeded. Skips non-TTY streams (piped
 * stdout, test mocks) — ANSI reset on a plain pipe would corrupt
 * downstream consumers.
 *
 * Prefers `fs.writeSync(fd, …)` over `stream.write(…)` because async
 * writes don't flush when `process.exit()` terminates the loop.
 * `stream.write` is the fallback for mocked streams where `fd` isn't
 * a real kernel descriptor.
 */
export function resetTerminalModes(stream: ResettableStream = process.stdout): boolean {
  if (!stream.isTTY) return false

  const fd = typeof stream.fd === "number"
    ? stream.fd
    : stream === process.stdout ? 1 : undefined

  if (fd !== undefined) {
    try {
      writeSync(fd, TERMINAL_MODE_RESET)
      return true
    } catch {
      // Fall through to stream.write for mocked or unusual TTY streams.
    }
  }

  try {
    stream.write(TERMINAL_MODE_RESET)
    return true
  } catch {
    return false
  }
}

/**
 * Wire exit-path hooks so the reset blob fires on every shutdown
 * route: clean exit, signals (SIGINT/SIGTERM/SIGHUP), and uncaught
 * throws. Idempotent — calling more than once is a no-op.
 *
 * On signals we let the process continue to exit naturally after the
 * reset; we don't `process.exit(code)` ourselves because that would
 * race with OpenTUI's own signal handler (which has its own
 * alt-screen cleanup). The reset is synchronous stdout writeSync, so
 * it always lands before the process reaps.
 */
let wired = false
export function installExitResetHooks(): void {
  if (wired) return
  wired = true

  // Normal exit — fires on process.exit() and on main() falling off.
  // `exit` handler must be synchronous (node discards async work).
  process.on("exit", () => { resetTerminalModes() })

  // Signals. OpenTUI's own handler also runs; order doesn't matter
  // because both cleanups are independent (alt-screen vs our modes).
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      resetTerminalModes()
      // Do NOT call process.exit — let the OpenTUI handler finish
      // first, then node exits on unhandled signal with the right
      // code (130 / 143 / 129). Calling exit() here races their
      // shutdown and can skip their alt-screen leave.
    })
  }

  // Uncaught throws. Emit reset before node prints the stack, so the
  // traceback renders on a clean primary screen.
  process.on("uncaughtException", err => {
    resetTerminalModes()
    // Re-throw via default behavior by writing + exiting after a tick.
    // We print here instead of letting it reach the default handler
    // because OpenTUI may have the alt-screen active and the default
    // traceback would land there and disappear on exit.
    console.error(err)
    process.exit(1)
  })
  process.on("unhandledRejection", reason => {
    resetTerminalModes()
    console.error(reason)
    process.exit(1)
  })
}
