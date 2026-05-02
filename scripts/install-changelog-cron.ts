#!/usr/bin/env bun
// Install the hermes-agent changelog digest cron (herm-tji.3).
//
// Creates a daily Hermes cron job that pulls ~/Dev/clones/hermes-agent,
// summarizes commits since the last run into 3–6 user-facing bullets,
// and writes ~/.hermes/herm/changelog.md. Splash.tsx reads that file.
//
// Run once:  bun scripts/install-changelog-cron.ts
// Remove:    hermes cron remove <id-printed-below>
//
// Deliberate: this is a script, not auto-run on herm startup, because
// cron creation is a system side-effect that shouldn't ride along with
// a branch merge.

import { $ } from "bun"

const REPO = `${process.env.HOME}/Dev/clones/hermes-agent`
const MARK = "~/.hermes/herm/.changelog-head"
const OUT = "~/.hermes/herm/changelog.md"

const prompt = `Summarize recent hermes-agent commits for a herm user.

1. Run: git -C ${REPO} fetch origin main --quiet
2. Read marker: cat ${MARK} 2>/dev/null (if missing, use HEAD~40)
3. Run: git -C ${REPO} log --oneline --no-merges <marker>..origin/main
4. If no commits: stop, do nothing.
5. Summarize as 3–6 bullets grouped by theme (features/fixes/internal).
   Audience is a herm TUI user who doesn't follow hermes-agent dev.
   No emoji, no fluff, present tense, one line each.
6. write_file to ${OUT}:
   # hermes-agent — <N> new commits
   _generated <today's date>_

   <bullets>
7. Write new marker: git -C ${REPO} rev-parse origin/main > ${MARK}

Final response: the bullet list only.`

const res = await $`hermes cron create \
  --name "herm changelog digest" \
  --schedule "0 6 * * *" \
  --deliver local \
  --toolsets terminal,file \
  --prompt ${prompt}`.text()

console.log(res)
console.log(`\nConsumer: Splash reads ${OUT} when present.`)
