// bun test preload — isolate filesystem side effects.
// Runs before any src/ module import, so module-level const paths
// (preferences.ts, hermes-home.ts) resolve to the sandbox.

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterEach } from "bun:test"

const root = mkdtempSync(join(tmpdir(), "herm-test-"))
const cfg = join(root, "config")

process.env.HERM_CONFIG_DIR = cfg
process.env.HERMES_HOME = join(root, "hermes")
process.env.HERMES_AGENT_ROOT = join(root, "agent")
process.env.HERM_IO_INLINE = "1"
process.env.CONTROL = ""
process.env.PERF = ""

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
