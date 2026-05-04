// Bundled .eikon avatars shipped with herm (assets/eikons/). One file
// per Hermes built-in skin; the active gateway skin picks its match
// when the user hasn't set an explicit avatar. User-dropped files in
// $HERMES_HOME/eikons are listed alongside these in the picker.

import { existsSync } from "fs"
import { join } from "path"

/** <repo>/assets/eikons — resolved from this file, survives cwd. */
export const BUNDLED_EIKON_DIR = join(import.meta.dir, "../../../assets/eikons")

/** Path to the bundled eikon for a skin name, if one ships with herm. */
export function bundledEikonPath(name: string | undefined): string | undefined {
  if (!name) return undefined
  const p = join(BUNDLED_EIKON_DIR, `${name}.eikon`)
  return existsSync(p) ? p : undefined
}
