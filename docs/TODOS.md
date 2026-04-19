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
