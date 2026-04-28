// Git branch for the sidebar. One-shot resolve + fs.watch on
// `<gitdir>/HEAD` so checkout/switch is picked up without polling.
// Ink's equivalent polls every 15s; the watcher is strictly cheaper
// and fires exactly on the event that matters.

import { useEffect, useState } from "react"
import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"

const TIMEOUT = 500

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" })
  const t = setTimeout(() => p.kill(), TIMEOUT)
  const out = await new Response(p.stdout).text()
  clearTimeout(t)
  return (await p.exited) === 0 ? out.trim() : null
}

/** Branch name for `cwd`, or null when not in a repo / detached HEAD. */
export async function branch(cwd: string): Promise<string | null> {
  const b = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
  return !b || b === "HEAD" ? null : b
}

/** Absolute .git dir for `cwd` (handles worktrees via git's own resolver). */
export async function gitdir(cwd: string): Promise<string | null> {
  return git(cwd, "rev-parse", "--absolute-git-dir")
}

export function useGitBranch(cwd: string | undefined): string | null {
  const [val, set] = useState<string | null>(null)

  useEffect(() => {
    if (!cwd) { set(null); return }
    let dead = false
    let w: FSWatcher | undefined
    const read = () => branch(cwd).then(b => { if (!dead) set(b) })
    void read()
    // HEAD is rewritten (not edited in-place) on checkout — watch the
    // parent dir and filter on basename so rename-into-place fires.
    gitdir(cwd).then(dir => {
      if (dead || !dir) return
      try {
        w = watch(dir, { persistent: false }, (_ev, f) => {
          if (f === "HEAD") void read()
        })
      } catch { /* unwatchable fs */ }
    })
    return () => { dead = true; w?.close() }
  }, [cwd])

  return val
}

/** Right-ellipsise keeping the discriminating tail (feature/foo → …e/foo). */
export const rtrunc = (s: string, max: number) =>
  s.length <= max ? s : "…" + s.slice(-(max - 1))
