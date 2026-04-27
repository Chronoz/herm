# Upstream wishlist — hermes-agent tui_gateway

Gaps found while building Herm against stock `tui_gateway/server.py`.
Herm works around all of these today; this file tracks what we'd
upstream if/when we PR against NousResearch/hermes-agent.

**Local patches applied** (reapply after any upstream pull with
`git -C ~/.hermes/hermes-agent apply ~/Dev/herm/patches/*.patch`):

- `agent-config.patch` — `_make_agent()` reads `max_iterations` /
  `fallback_model` from config; `_background_agent_kwargs()` reads
  `agent.max_turns` (was top-level `max_turns=25`). *Not* in upstream
  as of 9be83728 despite earlier claim.
- `cron-manage.patch` — `cron.manage` handler: `list` passes
  `include_disabled=True` so paused jobs stay visible; routes
  `action="run"` through to `cronjob()`.

## Wanted RPCs

### `session.search`
FTS5 search over messages_fts, collapsed to one hit per session.
Herm workaround: `searchSessions()` in `src/utils/hermes-home.ts`
queries state.db directly. Won't work against a remote gateway.

### `session.delete`
Delete a session + its messages (orphan children).
Herm workaround: `deleteSession()` in `src/utils/hermes-home.ts`
opens state.db writable. Won't work against a remote gateway, and
doesn't guard against deleting the active session the way an RPC
could.

### `session.title {session_id, title}`
Current RPC resolves session via `_sess(params)` → only ever edits
the gateway's *current* session. Passing an arbitrary `session_id`
is ignored. Herm's Sessions-tab rename (`t`) writes state.db
directly (`renameSession()` in `src/utils/hermes-home.ts`); won't
work against a remote gateway.

### `session.create` — return `session_key`
Response is `{session_id, info}` where `session_id` is the
ephemeral 8-hex `_sessions` key. The persistent state.db row id
(`_new_session_key()`) is never returned — it only surfaces later
via `session.title`'s read-mode `{title, session_key}`. Herm needs
the db key to persist for resume-on-reload (`lastSessionId` pref).
Workaround: the `session.info` event → `session.title` round-trip
in `app.tsx onSessionInfo` captures it one tick late. Would also
accept `session.info` carrying `session_key` in `_session_info()`.

### `session.list` — filter 0-msg stubs
Stock RPC returns eagerly-created stub rows (every abandoned connect
leaves one). Herm filters `message_count > 0` client-side in
`src/tabs/Sessions.tsx load()`, but this wastes half the `limit` on
stubs when there's a lot of churn.

### `session.close` — delete 0-msg stub
Related: close handler should drop the eagerly-created row if no
message was ever sent. No client-side workaround possible; stubs
accumulate until `hermes sessions prune`.

### `tool.start` / `tool.complete` — carry args and result
Stock emits:
  tool.start    {tool_id, name, context}   context = build_tool_preview()
                                            string ≤80ch, NOT the args dict
  tool.complete {tool_id, name, summary?,  summary = "Completed in Ns"
                 inline_diff?, error?,      (or web "Did N searches")
                 duration_s?}
Herm wants the oc-style per-tool body renderers (terminal stdout
block, todo checklist, search_files match list), which need
`args: dict` on start and `result: str` on complete. Without them
every tool is an InlineTool row with just the preview string.
Herm workaround: none. `tool/frame.tsx` BlockTool is built and
waiting; the dispatch switch will grow cases when the wire does.

### `image.detach` / `image.clear`
`clipboard.paste` and `image.attach` append to
`session["attached_images"]` but there's no RPC to remove one (or
all) before `prompt.submit` drains them. Herm chips are display-only
for now; oc's ✕-to-remove is blocked on this.

### `profile.list` / `profile.create` / `profile.delete`
Herm workaround: `src/utils/hermes-profiles.ts` reads `~/.hermes/profiles/`
directly; create scaffolds dirs via `fs.mkdirSync`; delete goes through
`shell.exec → hermes profile delete -y`. Works, but:
- fs scan can't see profiles on a remote gateway
- `shell.exec` has a 30s timeout and `detect_dangerous_command` gate
- no way to switch active profile without restarting herm

### `mcp.status`
Herm reads `session.info.mcp_servers` (populated at boot) but there's
no way to poll connection state after `reload.mcp`. Would want
`{name, transport, connected, tool_count, error}[]`.

### `delegation.steer {subagent_id, text}`
Per-child steer. `session.steer` exists for the main agent; subagents
have `subagent.interrupt` but no non-interrupting note injection.
Herm wants this alongside `k`/`p` in the Delegation pane action set.

### `config.schema`
Field → type/options/description, same shape the web UI's
`/api/config/schema` returns. Would let `Config.tsx` drop the
hardcoded `SELECTS`/`CATEGORIES`/`MERGES` tables. No workaround.

### `spawn_tree.snapshot` push event
One-shot current-tree emitted on subscribe. `spawn_tree.{save,list,load}`
are persistence RPCs; there's no push of the *current* registry.
Herm workaround: immediate `delegation.status` call on tab mount +
`subagent.*` event folding (Agents.tsx `liveMap`), but there's still
one poll-tick of latency on first paint.

### `session.end` on gateway shutdown / crash
`ended_at` is NULL for ~80% of rows because tui_gateway never calls
`SessionDB.end_session()`. Herm derives duration from
`MAX(messages.timestamp)` instead.

### `tips.list`
Herm workaround: `src/utils/tips.ts` scrapes string literals out of
`hermes_cli/tips.py` via `hermesAgentRoot()`. Brittle; breaks if the
file moves or the list becomes non-literal.

### `platforms.list` (or equivalent)
`/platforms` falls through to `slash.exec` and renders raw CLI output
as a system line. A structured `{name, configured, running}[]` would
let it live in the same KV info-dialog family as /status /usage
/profile (`src/dialogs/info.tsx`).

### `cron.manage action=update`
`cronjob(action='update', ...)` exists in `tools/cronjob_tools.py` but
the `cron.manage` handler doesn't route it. Would enable rename +
schedule/prompt edit from Cron tab. Herm workaround: none (edit
requires `hermes cron update` in a shell).

### `cron.manage` list — return full prompt
`_format_job()` returns `prompt_preview` (100ch) only. Cron DetailPanel
can't show the full prompt. Herm workaround: none short of reading
`~/.hermes/cron/jobs.json` directly, which reintroduces fs coupling.

### `cron.output {job_id, lines?}`
Tail of the newest file under `~/.hermes/cron/output/{job_id}/`.
Herm workaround: fs-read that dir directly (Cron.tsx DetailPanel).
Won't work against a remote gateway.
