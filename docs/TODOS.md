# TODOS

Herm now talks to `tui_gateway` over stdio JSON-RPC. The `HermesApiClient`
HTTP/SSE path is gone; all agent interaction flows through `GatewayClient`.

---

## ~~1. Replace HermesApiClient with stdio JSON-RPC GatewayClient~~ ✅

`src/utils/gateway-client.ts` spawns `python -m tui_gateway.entry` and
speaks newline-delimited JSON-RPC 2.0. `GatewayProvider` exposes a
singleton via `useGateway()` / `useGatewayEvent()` / `useGatewayReady()`.
`hermes-api-client.ts` and `cron-api.ts` are deleted.

## ~~2. Interactive prompts~~ ✅

`ApprovalPrompt`, `ClarifyPrompt`, `SudoPrompt`, `SecretPrompt` in
`src/ui/prompts.tsx`. `gatewayEvents.ts` routes `approval.request` /
`clarify.request` / `sudo.request` / `secret.request` to the
`DialogProvider`; responses go back via `*.respond`.

## ~~3. Session CRUD via RPC~~ ✅

`useSession()` wraps `session.create` / `session.resume` / `session.interrupt`
/ `session.branch` / `session.compress` / `session.undo`. The reducer
owns message state, so tab switches no longer nuke the transcript.
`lastSessionId` persists via `preferences.set`.

## ~~4. Slash command execution via RPC~~ ✅

`useSlashCommands` pulls `commands.catalog` (categories, aliases,
args_hint, subcommands). `slash.exec` runs commands server-side with a
`prompt.submit` fallback. `complete.slash` is available for rich
completion and wired for future popover use.

## ~~5. Extract state into stores~~ ✅

Replaced with a single `turnReducer` (`src/app/turnReducer.ts`) + React
hooks (`useSession`, `useSlashCommands`, `useSlashPopover`,
`useInputHistory`, `useAppKeys`). `app.tsx` is now ~330 LOC of wiring.

## ~~6. Enrich tool display with progress events~~ ✅

Reducer handles `tool.progress` / `tool.generating` / `tool.complete`
(with `inline_diff`) and all `subagent.*` events as nested tool parts.
`ToolCallItem` renders subagent parts with a dedicated icon.

## 7. Replace filesystem reads with RPC calls — partial

Done: `Skills`, `Toolsets`, `Cron`, `Config`.
Still reading `hermes-home.ts`: `Overview`, `Analytics`, `Env`, `Memory`,
`Context`, `Sessions`. These need RPC equivalents on the gateway side
(session.list is already there; the rest need verifying) before migrating.

## 8. Add features now trivially available via RPC — partial

Done: model picker (`model.options` + `config.set`), session
branch/compress/undo in the command palette, background/btw events
surface as toasts/system messages.

Still to add:
- Rollback UI (`rollback.list` / `rollback.restore` / `rollback.diff`)
- Voice toggle (`voice.toggle` / `voice.record` / `voice.tts`)
- MCP reload (`reload.mcp`)
- `session.usage` wired into Analytics tab
