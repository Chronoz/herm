// bun test preload — isolate filesystem side effects.
// Runs before any src/ module import, so module-level const paths
// (preferences.ts, hermes-home.ts) resolve to the sandbox.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterEach } from "bun:test"

const root = mkdtempSync(join(tmpdir(), "herm-test-"))
const cfg = join(root, "config")

process.env.HERM_CONFIG_DIR = cfg
process.env.HERMES_HOME = join(root, "hermes")
process.env.HERMES_AGENT_ROOT = join(root, "agent")
process.env.CONTROL = ""
process.env.PERF = ""

// tips.ts scrapes <agent>/hermes_cli/tips.py at first call and caches
// module-level. Provide a fixture so loadTips() exercises the scraper
// (not FALLBACK) on machines without a real hermes-agent checkout.
mkdirSync(join(root, "agent", "hermes_cli"), { recursive: true })
writeFileSync(join(root, "agent", "hermes_cli", "tips.py"), `\
TIPS = [
    "/model <name> switches the active model.",
    "/title \\"my project\\" names the session.",
    "@file:path injects file contents.",
    "Ctrl+G opens $EDITOR.",
    "Click a user message to rewind.",
    "\`/new\` starts a fresh session.",
    "Ctrl+Z suspends to the shell; \`fg\` resumes.",
    "Pasting 5+ lines collapses to a placeholder.",
    "/keys opens the keybinding editor.",
    "/compress shrinks the context window.",
    "/help lists all slash commands.",
    "/fast toggles the speed model.",
]
`)

// The home store is a module-level singleton. Any mount() that renders a
// useHome() consumer caches slices against whatever the sandbox held at
// that moment, and later files that write fixtures see stale values.
// Reset it between tests. Dynamic import because a static one would be
// hoisted above the env assignments and resolve hermesPath to ~/.hermes.
afterEach(async () => {
  const { home } = await import("../src/home/store")
  home.close()
  // preferences.ts is likewise a module singleton backed by a file in
  // the sandbox; tests that set() a key (e.g. keys.test, app rebind test)
  // would otherwise leak overrides into later tests via disk.
  const prefs = await import("../src/utils/preferences")
  prefs.reset()
  rmSync(join(cfg, "tui.json"), { force: true })
})

// AnimatedAvatar ticks via setTimeout outside act() — harmless, but noisy.
const err = console.error
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return
  err(...args)
}
