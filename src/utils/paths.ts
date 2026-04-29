// Filesystem locations herm writes to. Central so the default stays
// consistent across callers and the legacy-path migration only lives
// in one spot.
//
// Defaults
//   HERM_CONFIG_DIR → $HERMES_HOME/herm (typically ~/.hermes/herm)
//   HERMES_HOME     → ~/.hermes
//
// Legacy layout (pre-0.1): ~/.config/herm — we auto-migrate any files
// sitting there into the new location on first access, once.

import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readdirSync, renameSync } from "fs"

const HOME = () => process.env.HOME || homedir()
const HERMES_HOME = () => process.env.HERMES_HOME || join(HOME(), ".hermes")

let migrated = false

/** Where herm-specific prefs, history, and caches live. */
export function configDir(): string {
  const dir = process.env.HERM_CONFIG_DIR || join(HERMES_HOME(), "herm")
  if (!migrated) {
    migrated = true
    maybeMigrateLegacy(dir)
  }
  return dir
}

/** One-time migration: ~/.config/herm/* → new configDir if empty. */
function maybeMigrateLegacy(target: string): void {
  // Respect explicit override: if the user set HERM_CONFIG_DIR we
  // never touch the legacy path.
  if (process.env.HERM_CONFIG_DIR) return
  const legacy = join(HOME(), ".config", "herm")
  if (!existsSync(legacy) || legacy === target) return
  // Only migrate when the target doesn't already hold data — never
  // clobber a fresh install.
  try {
    if (existsSync(target) && readdirSync(target).length > 0) return
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(legacy)) {
      const src = join(legacy, name)
      const dst = join(target, name)
      if (existsSync(dst)) continue
      try { renameSync(src, dst) } catch { /* cross-device or locked — skip */ }
    }
  } catch {
    // Best-effort; a failed migration should never block startup.
  }
}
