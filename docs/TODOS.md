# TODOS

Review pass of 2026-04-18 is landed (a879b25 → e890cf3 + Composer
extraction). tsc clean, zero `any`, tab keyboards focus-gated, prompts
round-trip, contexts memoized, parts render in order, composer owns
input/popover/history locally. What's left is data-path unification and
net-new RPC surface.

---

## Sessions tab reads a different source than it resumes

`Sessions.tsx` still queries `state.db` via `hermes-home.ts` while
`useSession.resume()` goes through RPC. If the gateway runs under a
different `HERMES_HOME`/profile, the list shows rows you can't open.
Migrate the list to `session.list` (already exposed by `tui_gateway`);
keep `searchSessions`/`deleteSession` filesystem-backed until the gateway
grows equivalents.

The remaining filesystem readers (`Overview`, `Context`, `Analytics`,
`Memory`, `Env`) are acceptable as a read-only data layer — they don't
share identity with RPC state the way sessions do.

## Config schema is hardcoded

`Config.tsx` `SELECTS` / `CATEGORIES` / `MERGES` are client-side guesses at
the hermes config shape. `tui_gateway` should expose `config.schema`
(field → type/options/description, same data the web UI's
`/api/config/schema` returns) and `Config.tsx` should render from that.
Until then the tab drifts every time hermes adds a setting.

## Remaining RPC surface

- `rollback.list` / `rollback.restore` / `rollback.diff` — checkpoint UI
- `voice.toggle` / `voice.record` / `voice.tts`
- `session.usage` → Analytics tab live-session row (status bar already
  uses it; Analytics still reads historical totals from `state.db`)

## Rich slash completion

`complete.slash` returns prompt_toolkit `Completion` objects:
`{text, display, meta}` where `text` is an *insertion fragment* and
`replace_from` is a splice offset into the raw input — not the
whole-token replacement `useSlashPopover` assumes. Merging those
results into the local popover needs a second accept mode (splice at
`replace_from` + `item.text`, vs. replace-token). Deferred until the
arg-completion case actually bites — the static catalog + `matchSub`
already cover name+subcommand; the only loss today is skill-arg
enumeration (`/use <skill>`), which `commands.catalog` mostly covers.

───────────────────────────────────────────────────────────────────────
## Agents tab
───────────────────────────────────────────────────────────────────────

Herm-original surface (`†` — no Ink/oc analogue). WHAT reference is
`hermes_cli/profiles.py` (1085L). Two panes: Profiles (fs scan) and
Delegation (`delegation.status` → `delegate_tool` registry).

Correctness — these bite:

[x] G1  resolved by G9 — pane no longer touches `process.stop`.
[x] G2  `gateway_running` misses JSON pidfiles. `hermes-profiles.ts:80`
        does `Number(read().trim())`; upstream writes `{"pid":N}` in
        some paths. Parse both → `●` stops lying.
[x] G3  `is_active` derives from herm's process env, not the gateway's.
        Same failure mode as the Sessions-tab item above. Fetch
        `config.get key=profile` once on mount; compare names against
        that, not `activeProfileName()`.

Create path — unify on the CLI:

[x] G4  Drop fs `createProfile()`; call `shell.exec → hermes profile
        create <name> [--clone --clone-from <src>]`. Gains skill seed,
        default SOUL.md, wrapper alias, and subcommand/PATH-collision
        validation for free. Add `--no-alias` toggle to the dialog.
        Deletes ~20L from `hermes-profiles.ts`.
[x] G5  `validateName()` — keep as pre-flight UX only (live error text
        in the dialog); authoritative check is G4's CLI exit.

Actions — the tab is read-mostly today:

[x] G6  Enter → `dialogs/profile.tsx` action menu. Open SOUL.md /
        config.yaml / .env / dir via `openFile`; set/clear sticky,
        export, delete via `shell.exec → hermes profile <verb>`.
        Rename + start/stop-gateway intentionally omitted —
        rename is a rare+risky path-mutating op better done from
        the CLI where the output is readable; gateway start/stop
        for the *active* profile would sever this session, and for
        other profiles `gateway_running` already tells you enough.
        Revisit if either proves needed.
[x] G7  Surface sticky default. Read `<root>/active_profile`; badge
        the row (`★`); expose "set sticky" / "clear" in G6.
[x] G8  `<FileLink>` for Path / SOUL.md / config.yaml / .env in the
        detail panel. Plain strings now.

Right pane:

[x] G9  Replaced `agents.list` (this session's bg terminal procs)
        with `delegation.status` — live subagent tree, `k` interrupt
        via `subagent.interrupt`, `p` toggle spawn-pause via
        `delegation.pause`. Bg procs belong under Status if we want
        them back (re-open as a Status item, not here).
[x] G9a Selected-row detail: goal/model/depth/parent/uptime/tools from
        the status record, plus live token/cost rollups and last-N tool
        trail from the accumulator.
[x] G9b Push, not poll: `subagent.*` events fold into a per-id enrichment
        map; start/complete trigger an immediate `delegation.status`
        refresh. Poll kept as a focus-gated floor (1.5s live / 5s idle).

Polish:

[x] G10 SOUL preview: strip first `#` heading + leading blank lines
        instead of raw `slice(0, 400)`.
[ ] G11 Detail panel: add session count, cron job count. Skip the
        systemctl probe — pidfile check (G2) is the better signal
        and doesn't spawn a process per row. Counts need opening
        each profile's state.db / cron dir; do lazily on selection,
        not in listProfiles().
[x] G12 Narrow layout: Enter on a row swaps list→detail (Sessions
        tab already does this). Today detail is invisible <130 cols.
[x] G13 `listProfiles()` does sync `readdirSync` skill-walk per
        profile per refresh. Cache until `r`, or make async.
[x] G14 Delete path can exceed `shell.exec` 30s (systemctl stop +
        10s SIGTERM wait). Pre-check `gateway_running` and warn, or
        fire-and-refresh instead of awaiting.

Order: G2-G3 (correctness) → G4 (unify create) → G6/G7/G8 (actions)
→ G9a/G9b (deleg depth) → G10-G14 (polish).

───────────────────────────────────────────────────────────────────────
## Upstream sync — 2026-04-24 (534 commits)
───────────────────────────────────────────────────────────────────────

Landed in this pass:

[x] Retired `patches/tui_gateway-runtime-provider.patch` — upstream
    `_make_agent()` now has `resolve_runtime_provider()` +
    `max_iterations` + `fallback_model`/`fallback_providers`, and
    `_background_agent_kwargs()` reads `cfg["agent"]["max_turns"]`.
    Both UPSTREAM.md "Wanted fixes" entries closed.
[x] `SubagentPayload` — new fields: `subagent_id`, `parent_id`,
    `depth`, `model`, token counts, cost, `files_read`/`files_written`,
    `output_tail`. `turnReducer.renderSubagent` keys on `subagent_id`
    (was `task_index`, which collided across batches) and carries
    `depth`; chat `Subagent.tsx` indents by it.
[x] Agents tab Running pane → Delegation pane (see G9).
[x] `/steer` → `session.steer` RPC, queued note injected on next
    tool result without interrupting the turn.

Net-new upstream surface not yet wired:

[x] S3  `plugins.list` (was misrecorded as `session.info.plugins`) →
        Sidebar "Plugins" section. Collapsed by default; `N/M on` hint.
[x] S5  `reload.mcp` → `/reload-mcp` local slash. Server re-emits
        `session.info` so the MCP sidebar section refreshes for free.
[x] S6  `spawn_tree.{save,list,load}` — accumulator in
        `app/spawnHistory.ts` records `subagent.*` across a turn,
        `flush()` on `onTurnComplete` persists via `spawn_tree.save`.
        `h` in the Delegation pane → `dialogs/spawn-history.tsx`
        (list + snapshot viewer).

Moved to UPSTREAM.md (don't exist server-side — were misrecorded
during the 04-24 recon):

- S1  `delegation.steer {subagent_id, text}` — per-child steer.
- S2  `config.schema` — would unblock the hardcoded Config tab.
- S4  `spawn_tree.snapshot` push event — instant paint on tab-switch.

───────────────────────────────────────────────────────────────────────
## Feature vision — vault import 2026-04-26
───────────────────────────────────────────────────────────────────────

Raw product notes from `~/Documents/self/Herm/*.md`. Not yet reconciled
against sections above; dedupe as they're picked up.

### Cron tab

[ ] C1  Create-new-cron flow (dialog → `cron.create` RPC).
[ ] C2  Existing crons as card rows (name/schedule/enabled/last-run).
[ ] C3  Time-to-next-activation per row.
[ ] C4  Summary of last run's output (expand row → tail/summary).

### Memory tab

[ ] M1  Recent memory activity feed (last N add/replace/remove).
[ ] M2  Plugins section — description of the active memory system.
[ ] M3  Install/activate inactive memory plugins.
[ ] M4  Deactivate active memory plugins.

### Agents tab

(Overlaps G4-G8 above; vault phrasing kept for intent.)
[ ] A1  Overview page of profiles (covered — left pane).
[ ] A2  Edit/view configs + SOUL.md per profile (→ G6/G8).
[ ] A3  Click-to-switch profile. Conflicts with current "switch
        severs session" stance — revisit: spawn second gateway vs
        restart-with-confirm.

### Sessions tab

[ ] E1  "Summarize this session" action on selected row.
[ ] E2  Titles for sessions (gateway already emits; render + edit).
[x] E3  Confirmation prompt before loading/resuming a session.
[ ] E4  Combine sessions — forward a slice of one into another.

### Context tab

[ ] X1  MVP: claude-code-style context viewer.
[ ] X2  Granular per-block detail.
[ ] X3  Grid visualization with dynamic LoD.
[ ] X4  Expunge context blocks; lock non-expungeable (system prompt).
[ ] X5  Compression management — model selector.
[ ] X6  Compression management — default behavior/prompt.
[ ] X7  Grid stickied left, content pane scrollable.

### Chat tab

[ ] H1  Thinking rendered in thought-cloud (eikon overlay already
        does burst; extend to full stream).
[ ] H2  `/btw` renders in a chat bubble, not system strip.
[ ] H3  Tool calls in right-hand gutter (not inline).
[x] H4  Default-to-resume last session on launch. Already the
        behavior via `boot()`; added `resumeOnLaunch` pref to
        opt out (tui.json).
[ ] H5  opencode-style multiline composer behavior.
[ ] H6  ASCII image representation in chat (eikon/chafa pipeline).
[ ] H7  Subagent chat in a "sub-herm" nested view.
