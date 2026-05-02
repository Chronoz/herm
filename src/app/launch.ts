// Launch intent parsed from argv before the renderer starts.
// Bare `herm` → fresh session (splash shows continue-prompt).
// `-c` / `--continue` / `--resume [id]` → resume, no splash.

export type Launch =
  | { mode: "new" }
  | { mode: "resume"; sid?: string }

/** Parse process argv (everything after the script path). No deps. */
export function parseLaunch(argv: readonly string[]): Launch {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-c" || a === "--continue") return { mode: "resume" }
    if (a === "--resume") {
      const next = argv[i + 1]
      // Treat a following non-flag token as the session id.
      return next && !next.startsWith("-")
        ? { mode: "resume", sid: next }
        : { mode: "resume" }
    }
  }
  return { mode: "new" }
}

export const HELP = `\
herm — OpenTUI client for hermes-agent

Usage:
  herm                    start a fresh session
  herm -c, --continue     resume the last real TUI session
  herm --resume [id]      resume last (or the given) session
  herm --help             show this help
`
