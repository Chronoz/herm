# Upstream wishlist — hermes-agent tui_gateway

Gaps found while building Herm against stock `tui_gateway/server.py`.
Herm works around all of these today; this file tracks what we'd
upstream if/when we PR against NousResearch/hermes-agent.

## Constraint note (2026-04-19)
Overnight rule: no hermes-agent edits. Interpretation applied:
- **Reverted** `profile.list/create/delete` RPCs added during P0
  (overnight, unreviewed).
- **Kept** `session.search/delete`, `session.list` 0-msg filter,
  `session.close` stub cleanup, `_make_agent` max_iterations fix —
  these were added during phases 4-10 with kaio present and were
  slated for kaio to commit separately. Reverting them would break
  the Sessions tab kaio already reviewed. **If this reading is wrong,
  Sessions needs rework to shell out to `hermes sessions` or read
  state.db directly for search/delete.**

## Wanted RPCs

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

### `session.end` on gateway shutdown / crash
`ended_at` is NULL for ~80% of rows because tui_gateway never calls
`SessionDB.end_session()`. Herm derives duration from
`MAX(messages.timestamp)` instead.
