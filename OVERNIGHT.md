# Overnight — 2026-04-18 → 04-19

Branch: `overnight/audit-2026-04-18` (off `dev` @ 4a57f73)
If context compacted: read this + `git log --oneline -30` to resume.

## Ground rules
- Commit to this branch. Do NOT push. Do NOT touch `main`/`dev`.
- One commit per coherent unit. Message carries the reasoning.
- Gate every commit: `bunx tsc --noEmit | grep ^src/` clean, `bun test` ×3 green.
- No `clarify()`. Decide, document, move on.
- Keep it pretty, uniform, standard, simple. When in doubt: opencode's grammar.
- Gateway tree (`~/.hermes/hermes-agent/tui_gateway/server.py`) — may add RPCs;
  Kaio commits that tree separately. Do NOT touch anything outside tui_gateway/.
- Use subagents (delegate_task) for recon/research; worktrees for parallel impl.
- Eikon: no video generation. File format + preview TUI + herm integration only.

## Sources mined
- `~/.hermes/hermes-agent/hermes_cli/commands.py` — 48 CommandDefs
- `~/.hermes/hermes-agent/tui_gateway/server.py` — 58 @method RPCs (22 orphaned)
- `~/.hermes/hermes-agent/web/src/pages/` — Status/Sessions/Analytics/Logs/Cron/Skills/Config/Env
- `~/.hermes/hermes-agent/ui-tui/src/` — Ink TUI (v2) — what herm competes with
- GH #12130 — teknium1's v1→v2 parity audit (§1-15, tiered)
- `~/Dev/clones/opencode/packages/opencode/src/cli/cmd/tui/` — solid+opentui, the polish bar
- `~/Dev/herm/docs/plans/2026-04-17-slash-commands-opencode-fusion.md` — existing slash plan
- `~/Dev/eikon/docs/SPEC.md` — .eikon NDJSON format v1

## Worktree layout
```
~/Dev/herm                      overnight/audit-2026-04-18  (orchestrator + P0/P1)
~/Dev/herm-wt/visual-lang       overnight/visual-lang       (P2 track)
~/Dev/herm-wt/chat-polish       overnight/chat-polish       (P3 track)
~/Dev/herm-wt/eikon-slot        overnight/eikon-slot        (P6 track)
```
Create on demand: `git worktree add ~/Dev/herm-wt/<n> -b overnight/<n>`.
Each worktree needs `bun install` once. Merge back via main tree before end.

═══════════════════════════════════════════════════════════════════
## P0 — Agents tab (new)                          [explicitly requested]
═══════════════════════════════════════════════════════════════════
Two concerns under one tab, left/right split:

**Profiles** (left, list+detail) — `hermes_cli/profiles.py` data model.
No gateway RPC exists → add `profile.list / profile.active / profile.use /
profile.create / profile.delete` to tui_gateway/server.py. List reads
`~/.hermes/profiles/*` + default. Detail shows home dir, model, toolsets,
SOUL.md first lines, skill count. Actions: switch (restarts gateway under
new HERMES_HOME — needs confirm dialog), create (name + clone-from picker),
delete (confirm). One profile at a time; herm itself runs under one.

**Live agents** (right) — `agents.list` RPC already returns background
processes. Plus: active delegate_task subagents (need new RPC reading
`_sessions[sid]` children if any; check run_agent.py for child tracking).
Row: pid/sid, command preview, status, uptime, kill button.
Refresh on tab-focus + `r`.

- [ ] A0.1 gateway: `profile.*` RPCs (list/active/use/create/delete)
- [ ] A0.2 gateway: extend `agents.list` with subagent + bg-prompt info
- [ ] A0.3 `src/tabs/Agents.tsx` — split layout, profile list+detail
- [ ] A0.4 Agents.tsx — live processes pane, kill via `process.stop`
- [ ] A0.5 wire into TABS (after Sessions), app.tsx switch case
- [ ] A0.6 tests: mount, profile list renders, switch confirm flow, kill flow

═══════════════════════════════════════════════════════════════════
## P1 — #12130 Tier-1 brownie points         [ship before official TUI]
═══════════════════════════════════════════════════════════════════
These are the items teknium1 flagged as "daily friction" that the Ink TUI
lacks. Herm already has native Skills/Toolsets/Cron tabs — half done.
Remaining:

- [ ] B1.1 **@ context refs** — `@file:path[:a-b]` `@folder:` `@diff` `@staged`
      `@git:N` `@url:` expanded client-side in `send()` before prompt.submit.
      Autocomplete in Composer after `@` (reuse `complete.path` RPC for files,
      add `complete.atref` for the fixed keywords). opencode's `attach.ts` is
      the reference. See existing plan doc §"@ context refs".
- [ ] B1.2 **quick_commands** — read `config.quick_commands` via config.get,
      register as local slash entries with target=shell, run via `shell.exec`
      RPC (already exists), render output as system message.
- [ ] B1.3 **MCP boot status** — gateway emits nothing. Add `mcp.status` RPC
      (reads tools/mcp_tool.py connection state). Surface in sidebar Identity
      section as a collapsible `▸ MCP  N servers` row; expand shows per-server
      transport + tool count + error. Also a system line on ready if any failed.
- [ ] B1.4 **Persistent attachment badges** — composer shows `📎 image.png`
      chips above input until sent; Ctrl+C idle clears. State already flows
      through `image.attach` → track locally in Composer, clear on send.
- [ ] B1.5 **/title** native — session.title RPC exists. Local slash: bare
      → prompt dialog; with arg → set. Reflect in Sessions tab + status bar.
- [ ] B1.6 **Paste-to-file** — `paste.collapse` RPC exists but herm never
      calls it. On bracketed paste ≥5 lines, POST to gateway, insert
      `[Pasted #N: L lines → path]` placeholder. Matches v1 CLI convention.

═══════════════════════════════════════════════════════════════════
## P2 — Visual language consolidation              [worktree: visual-lang]
═══════════════════════════════════════════════════════════════════
Audit result: tabs diverge on card/no-card, header in/out, border style.
Define ONE grammar, extract primitives, migrate every tab.

- [ ] C2.1 `src/ui/shell.tsx` — `<TabShell title hint actions?>` wrapper:
      border + backgroundPanel + padding=1, header row (title bold primary,
      hint textMuted, flexGrow truncate), body = children in flexGrow column.
      `<SplitShell left right ratio?>` for list+detail tabs.
- [ ] C2.2 `src/ui/list.tsx` — `<DataList rows cols onActivate onDelete>`:
      the Sessions table pattern (Col, HeaderRow, VBAR_W gutter, memo-safe
      callbacks, scrollChildIntoView nav) extracted. Every list tab uses it.
- [ ] C2.3 `src/ui/kv.tsx` — `<KV label value fg?>` (= DLine), `<KVBlock rows>`.
- [ ] C2.4 Migrate: Sessions, Skills, Cron, Toolsets, Config, Env, Memory,
      Analytics, Context, Agents → TabShell/SplitShell/DataList/KV.
      One commit per tab. Diff should be mostly deletions.
- [ ] C2.5 Chat stays special (no card) — but MessageList gets the same
      scrollbox inner-column discipline.
- [ ] C2.6 Delete now-dead per-tab formatters (trunc/badge/etc → src/ui/fmt.ts).

═══════════════════════════════════════════════════════════════════
## P3 — Chat UX → opencode polish                [worktree: chat-polish]
═══════════════════════════════════════════════════════════════════
Reference: `~/Dev/clones/opencode/.../tui/routes/session/` +
`component/message.tsx` + `component/editor.tsx`.

- [ ] D3.1 **Message chrome** — assistant msgs get a left gutter glyph
      (themed `│` or `⚕`) + header line `Hermes · model · 3→5 tok`; user
      msgs right-aligned or prefix `▸ You`. No full border box (too heavy
      in a TUI), just the gutter line like opencode.
- [ ] D3.2 **Tool call rendering** — collapsible tree row per tool:
      `▸ read_file  path/to/x.ts  12ms` → expand shows args + result
      preview (first 3 lines). opencode's subagent accordion is the model.
      Shift+click = expand all. Already have turnReducer parts; need the
      render component.
- [ ] D3.3 **Code blocks** — per-language syntax via tree-sitter (opentui
      `<code>` renderable supports `filetype` + `treeSitterClient`). Wire
      the client once at app level, pass through MarkdownRenderer.
- [ ] D3.4 **Inline diffs** — already flows through tool.complete; render
      with opentui `<diff>` renderable instead of plain text. Cap 80 lines.
- [ ] D3.5 **Sticky prompt tracker** — when scrolled up, show a 1-line
      `↳ <last user msg>` chip at top of viewport (opencode has this).
- [ ] D3.6 **Queue UI** — `/queue` already RPC'd. Show queued prompts as
      dim chips below composer; ↑↓ edit, Ctrl+K dequeue, Enter submits head.
- [ ] D3.7 **Ctrl+G editor handoff** — suspend renderer, spawn $EDITOR on
      a tmpfile seeded with composer value, on exit read back + resume.
      Pattern is in opentui-component-patterns skill.
- [ ] D3.8 **Tips on empty transcript** — import `hermes_cli/tips.py` list
      via a one-time gateway RPC `tips.list`, rotate one on empty chat.
- [ ] (ad hoc added by kaio) click on your message and revert to that state

═══════════════════════════════════════════════════════════════════
## P4 — #12130 Tier-2 overlays herm already has as tabs — finish them
═══════════════════════════════════════════════════════════════════
Herm's tab model means it doesn't need modal overlays for these, but the
tabs themselves are thin. Bring each to web-ui parity using its RPC.

- [ ] E4.1 **Rollback** — new tab or Sessions-tab action? → Sessions detail
      panel gets a `▸ Checkpoints (N)` section: `rollback.list` →
      per-checkpoint row → `rollback.diff` in a dialog → `rollback.restore`
      with confirm. No new tab.
- [ ] E4.2 **Skills tab** — currently lists installed. Add: search hub
      (`skills.manage action=search`), install/uninstall, view SKILL.md in
      a scroll dialog, category tree on left. web-ui SkillsPage is the ref.
- [ ] E4.3 **Cron tab** — currently lists. Add: create (schedule+prompt
      form dialog), pause/resume toggle, run-now, delete confirm. RPC
      `cron.manage` covers all actions.
- [ ] E4.4 **Toolsets tab** — currently lists. Add: per-tool enable/disable
      checkboxes via `tools.configure`, per-toolset expand showing tools.
- [ ] E4.5 **Analytics tab** — replace with `insights.get` RPC (days param).
      Cost/tokens over time, per-model breakdown, top tools. Text bars only
      (▰▱), no charts. web-ui AnalyticsPage shape.
- [ ] E4.6 **Config tab** — already an editor? Verify it writes via
      `config.set` not direct file. Add: validation errors inline, diff
      preview before save, "reset section to default" per key.
- [ ] E4.7 **Env tab** — mask values by default, eye toggle per row,
      add/edit/delete via dialog, category grouping (provider/tool/
      messaging per OPTIONAL_ENV_VARS metadata).

═══════════════════════════════════════════════════════════════════
## P5 — #12130 Tier-3 + misc parity
═══════════════════════════════════════════════════════════════════
- [ ] F5.1 `/status` `/profile` `/usage` `/platforms` as local slashes →
      each opens a small info dialog (reuse KV primitive). RPCs exist.
- [ ] F5.2 `/save` `/history` native — session.save / session.history RPCs.
- [ ] F5.3 `/rollback` `/snapshot` `/browser` `/plugins` `/insights` `/debug`
      slashes → jump to the relevant tab (setTab), or dialog if no tab.
- [ ] F5.4 Ctrl+Z suspend (process.kill SIGTSTP self), Ctrl+V paste fallback.
- [ ] F5.5 Rate-limit line in status bar when session.usage returns limits.
- [ ] F5.6 Profile name in sidebar Identity when non-default.

═══════════════════════════════════════════════════════════════════
## P6 — Eikon integration                          [worktree: eikon-slot]
═══════════════════════════════════════════════════════════════════
Goal: browse/pick/load `.eikon` avatars into the sidebar slot. NO video gen.

- [ ] G6.1 `src/components/avatar/eikon.ts` — `.eikon` NDJSON parser
      (header + state decls + frames) per `~/Dev/eikon/docs/SPEC.md`.
      Pure, no deps. Returns `{meta, states: Map<name, {fps, frames[]}>}`.
- [ ] G6.2 `AnimatedAvatar` → accept `eikon?: ParsedEikon` prop; if present,
      play `eikon.states[agentState]` frames at its fps instead of the
      baked STATE_FRAMES. Fallback to baked if state missing.
- [ ] G6.3 `src/dialogs/eikon-picker.tsx` — lists `~/Dev/eikon/avatars/*.eikon`
      + `~/.hermes/eikons/*.eikon`, shows name/author/states/size, live
      preview pane cycling idle state. Enter → load into sidebar.
- [ ] G6.4 `/eikon` local slash + command-palette entry → opens picker.
      Persist choice to preferences (`eikonPath`), load on boot.
- [ ] G6.5 Eikon preview app (`~/Dev/eikon/preview/`) — if time: align its
      player with G6.1 parser so there's one impl. Low priority.
- [ ] G6.6 tests: parser (valid/malformed/unknown-version), picker mount,
      avatar plays eikon frames when loaded.

═══════════════════════════════════════════════════════════════════
## Execution order
═══════════════════════════════════════════════════════════════════
Serial in main tree: P0 → P1. Then fan out:
  - subagent A in visual-lang worktree: C2.1-3 primitives, then C2.4 migrations
  - subagent B in chat-polish worktree: D3.1-4
  - main tree continues P4 (E4.*)
  - subagent C in eikon-slot worktree: G6.1-4
Rejoin: merge worktree branches into overnight/audit-2026-04-18, run full
suite, resolve conflicts (expect src/app.tsx, src/tabs/*). Then P5 + D3.5-8
serially. Update this file's checkboxes as commits land.

## Exit
If budget hits or stuck >3 attempts on one task: mark `[~]` with a note,
commit this file, write a clean summary, stop. Never leave tree dirty.

## Late additions
- opencode-style diffing in chat → already D3.4 (opentui `<diff>` renderable).
  Bumping D3.4 priority to run alongside D3.1-2 in first chat-polish batch.
- **CONSTRAINT (kaio, overnight):** do NOT edit hermes-agent. Herm must
  work against upstream tui_gateway as-is. Where a feature needs a new
  RPC, route through an existing one (`shell.exec`, `config.get`) or
  read the filesystem directly. Any gateway gaps → note in
  `UPSTREAM.md` for later PR, don't patch locally.

## Status
- [x] P0 Agents tab — 82ac163 + 2e795f0 (fs-based, no gateway edits)
- [x] B1.1 @-refs popover — existing complete.path; expansion server-side
- [x] B1.2 quick_commands — config.get(full).quick_commands → target:shell → shell.exec
- [x] B1.3 MCP status — session.info.mcp_servers → sidebar section + fail line
- [x] B1.5 /title — session.title RPC, TextPrompt dialog, status bar
- [~] B1.4/B1.6 skipped: no paste plumbing in app yet (D3.7 prereq);
      attachments (B1.4) deferred — image.attach event isn't wired
- [x] P2 visual-lang merged — src/ui/{fmt,kv,shell}, 5 tabs migrated
- [x] P3 D3.1-4 chat-polish merged — gutter/ToolPart/DiffBlock/code fg
- [x] P6 eikon-slot merged — parser/avatar/picker/slash
- [x] b4a26a9 fix: opencode.json gitignore trap (broke fresh worktrees)
- [ ] P4, P5, P3 D3.5-8 — next session
Tests: 61→91 passing, 5× stable.
