// Launch intent parsed from argv before the renderer starts.
// Bare `herm` → fresh session (splash shows continue-prompt).
// `-c` / `--continue` / `--resume [id]` → resume, no splash.

import pkg from "../../package.json" with { type: "json" }

export const VERSION = pkg.version

export type Launch =
  | { mode: "new"; splash?: boolean }
  | { mode: "resume"; sid?: string }

/** Parse process argv (everything after the script path). No deps. */
export function parseLaunch(argv: readonly string[]): Launch {
  let splash = true
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--no-splash") { splash = false; continue }
    if (a === "-c" || a === "--continue") return { mode: "resume" }
    if (a === "--resume") {
      const next = argv[i + 1]
      // Treat a following non-flag token as the session id.
      return next && !next.startsWith("-")
        ? { mode: "resume", sid: next }
        : { mode: "resume" }
    }
  }
  return { mode: "new", splash }
}

export const HELP = `\
herm — OpenTUI client for hermes-agent

Usage:
  herm                    start a fresh session
  herm -c, --continue     resume the last real TUI session
  herm --resume [id]      resume last (or the given) session
  herm --no-splash        skip the launch splash
  herm -v, --version      print version
  herm -h, --help         show this help
`
