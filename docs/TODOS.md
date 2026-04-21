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
- `reload.mcp`
- `session.usage` → Analytics tab live-session row (status bar already
  uses it; Analytics still reads historical totals from `state.db`)

## Rich slash completion

`complete.slash` RPC exists on the gateway but isn't wired. `Composer`
owns `useSlashPopover` now, so the hook can swap its local `filter()`
for an async gateway call (debounced) to get skill/plugin/arg
completions the static catalog can't provide.

───────────────────────────────────────────────────────────────────────
## Agents tab
───────────────────────────────────────────────────────────────────────

Herm-original surface (`†` — no Ink/oc analogue). WHAT reference is
`hermes_cli/profiles.py` (1085L). Two panes today: Profiles (fs scan)
and Running (`agents.list` → `process_registry`).

Correctness — these bite:

[ ] G1  `k` kills everything. Upstream `process.stop` ignores
        `session_id` and calls `kill_all()`. Until that's fixed,
        relabel the action ("stop all") + confirm dialog. Don't
        pretend it's per-row.
[ ] G2  `gateway_running` misses JSON pidfiles. `hermes-profiles.ts:80`
        does `Number(read().trim())`; upstream writes `{"pid":N}` in
        some paths. Parse both → `●` stops lying.
[ ] G3  `is_active` derives from herm's process env, not the gateway's.
        Same failure mode as the Sessions-tab item above. Fetch
        `config.get key=profile` once on mount; compare names against
        that, not `activeProfileName()`.

Create path — unify on the CLI:

[ ] G4  Drop fs `createProfile()`; call `shell.exec → hermes profile
        create <name> [--clone --clone-from <src>]`. Gains skill seed,
        default SOUL.md, wrapper alias, and subcommand/PATH-collision
        validation for free. Add `--no-alias` toggle to the dialog.
        Deletes ~20L from `hermes-profiles.ts`.
[ ] G5  `validateName()` — keep as pre-flight UX only (live error text
        in the dialog); authoritative check is G4's CLI exit.

Actions — the tab is read-mostly today:

[ ] G6  Enter → action menu on selected profile. Reuse E2's
        `dialog-message` pattern. Actions: edit SOUL.md, open
        config.yaml, open .env, start/stop gateway, set sticky
        default, rename, export. Most dispatch via `shell.exec →
        hermes profile <verb>` / `<name> gateway <verb>`.
[ ] G7  Surface sticky default. Read `<root>/active_profile`; badge
        the row (`★`); expose "set sticky" / "clear" in G6.
[ ] G8  `<FileLink>` for Path / SOUL.md / config.yaml / .env in the
        detail panel. Plain strings now.

Right pane — decide what "Running" means:

[ ] G9  `agents.list` returns this session's background terminal
        procs — not subagents, not other profiles' gateways. Either
        (a) relabel to "Background" and move under Status, or
        (b) replace with per-profile gateway rows (name · PID ·
        uptime · stop), which is what the tab name implies. Data for
        (b) is already computed in `listProfiles()`.

Polish:

[ ] G10 SOUL preview: strip first `#` heading + leading blank lines
        instead of raw `slice(0, 400)`.
[ ] G11 Detail panel: add session count, cron job count, service
        status (`systemctl --user is-active hermes-gateway-<name>`).
[ ] G12 Narrow layout: Enter on a row swaps list→detail (Sessions
        tab already does this). Today detail is invisible <130 cols.
[ ] G13 `listProfiles()` does sync `readdirSync` skill-walk per
        profile per refresh. Cache until `r`, or make async.
[ ] G14 Delete path can exceed `shell.exec` 30s (systemctl stop +
        10s SIGTERM wait). Pre-check `gateway_running` and warn, or
        fire-and-refresh instead of awaiting.

Order: G1-G3 (correctness) → G4 (unify create) → G6/G7/G8 (actions)
→ G9 (pane identity) → G10-G14 (polish).
