// bun test preload — isolate filesystem side effects.
// Runs before any src/ module import, so module-level const paths
// (preferences.ts, hermes-home.ts) resolve to the sandbox.

import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const root = mkdtempSync(join(tmpdir(), "herm-test-"))

process.env.HERM_CONFIG_DIR = join(root, "config")
process.env.HERMES_HOME = join(root, "hermes")
process.env.CONTROL = ""
process.env.PERF = ""

// AnimatedAvatar ticks via setTimeout outside act() — harmless, but noisy.
const err = console.error
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return
  err(...args)
}
