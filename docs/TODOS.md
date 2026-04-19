# TODOS

Post-gateway-migration review (2026-04-18). The `tui_gateway` stdio transport
is in; `app.tsx` is decomposed into `src/app/` hooks + `turnReducer`. What
remains is correctness, render hygiene, and finishing the RPC migration.

Ordered roughly by blast radius.

---

## Correctness — blocks real use

### Prompt dialogs don't round-trip on cancel

`ApprovalPrompt` advertises "Esc deny" but has no escape handler.
`DialogProvider` catches Escape globally and calls `clear()`, which unmounts
the overlay without sending `approval.respond`. The Python side blocks
forever. Same for `ClarifyPrompt` (open-ended → Esc), `SudoPrompt`,
`SecretPrompt`.

Every `dialog.replace(<…Prompt />)` in `app.tsx` needs an `onClose` that sends
the deny/cancel response, guarded by a `responded` flag the prompt sets on
explicit submit (same pattern as `openThemePicker`).

### Free-text prompts never capture input

`ClarifyPrompt` (custom answer) and `MaskedPrompt` wire `onChange={setValue}`.
OpenTUI `<input>` `onChange` fires on blur; per-keystroke is `onInput`. State
stays `""`, Enter submits empty. Sudo, secret, and clarify-other are dead.

### `MaskedPrompt` renders cleartext

`"*".repeat(value.length)` is passed as `placeholder`, which only shows when
the field is empty. The actual value renders unmasked. Either overlay a
`<text>` of bullets and set input `textColor` = `backgroundColor`, or drop the
`<input>` and drive a buffer from `useKeyboard` directly.

### Tab `useKeyboard` handlers ignore `focusRegion`

Every tab (`Sessions`, `Skills`, `Config`, `Env`, `Cron`, `Toolsets`) installs
a global `useKeyboard` with bare `up`/`down`/`return`/letter keys and no
focus gate. With the chat input focused on the Sessions tab, ↑ both recalls
prompt history *and* moves the list cursor; typing `d` both opens the delete
dialog *and* refocuses input (`useAppKeys` auto-refocus); `/` both enters
search mode *and* types into the composer.

Tabs need a `focused: boolean` prop (= `focusRegion === "content"`) and must
early-return when false. The auto-refocus-on-printable branch in `useAppKeys`
should `key.stopPropagation()` so the swallowed character doesn't also reach
tab handlers.

### `slash` / `newSession` forward-referenced without deps

`send()` calls `slash(...)` (declared after, not in deps). The command-palette
effect closes over `newSession` (declared after, not in deps). Works today
only because the callbacks are rebuilt every render for other reasons. Either
hoist, add to deps, or route through a ref.

---

## Render hygiene

### Unstable context values drive continuous churn

`CommandProvider`, `DialogProvider`, `ToastProvider`, `GatewayProvider` all
build their context `value` as a fresh object literal per render.
`useSession()` returns a fresh `{ boot, create, … }` per call. These feed
`app.tsx` effect deps (`[cmd, dialog, themeCtx, session, gw]`), so the
command-palette `register()` effect re-runs every render, which bumps
`setRevision`, which re-renders `CommandProvider`, which changes `cmd`, …

`useMemo` every provider value; `useMemo` the `useSession` return object;
strip churn-only identities from `app.tsx` effect deps. Verify with `PERF=1`
that `<shell>` render count is ~O(events), not O(frames).

### `handle` resubscribes every render

`app.tsx:120` deps `[session, dialog, toast]` are unstable → `useGatewayEvent`
tears down/reattaches the listener on every render. Fix falls out of the
provider memoization above; until then, route the side-effect callbacks
through a ref and give `handle` an empty dep array.

### `GatewayProvider` drains before `AppInner` subscribes

`c.start(); c.drain()` flips `sub=true` immediately. Any event arriving
between that and `useGatewayEvent`'s effect in `AppInner` goes only to the
provider's local listener (which drops everything except
`ready`/`session.info`). Move `drain()` into the first `useGatewayEvent`
subscription.

### `InputArea` `memo` never hits

13 props, `popover` is a fresh array on every keystroke. Either move
`useSlashPopover` inside `InputArea` (it already has `value`) or lift the
popover overlay out as a sibling in `app.tsx`.

---

## Dead / wrong code

### `status` state is write-only

`setStatus` is called from `onStatus` (`thinking.delta`, `status.update`) but
`status` is never rendered. Either surface it in the status bar (intent of
commit 6105449) or delete.

### `visible` prop is tautological

`content()` mounts exactly one tab via `switch(tab)`, so `visible={tab === N}`
is always `true` and effect cleanup already stops polling on unmount. Drop
the prop from `Overview`/`Context`/`Analytics`/`Memory` — or switch to
persistent mount + visibility gating for instant tab switches. Pick one.

### Hardcoded cost model

`(u.input * 3 + u.output * 15) / 1e6` is one model's pricing. The gateway
already reports `cost_usd` on `session.usage`. Poll that after
`message.complete` and drop the client-side arithmetic.

### Hardcoded paths / magic numbers

- `gateway-client.ts:77` and `hermes-home.ts:17` fall back to `"/home/kaio"`.
  Use `os.homedir()`.
- `useAppKeys.ts:45` `Math.min(10, t+1)` — pass `tabs.length - 1` in.
- `control.ts` `TAB_NAMES` duplicates `app.tsx` `tabs`. Export one array.
- `Config.tsx` `agent.reasoning_effort` options `["low","medium","high"]` —
  missing `none`/`minimal`/`xhigh`. Better: fetch schema from gateway instead
  of hardcoding `SELECTS`.

### The one `tsc` error

`preferences.ts:66` — `cached` is `TuiPreferences | null`, TS doesn't narrow
across the assignment. Assign to a local and return that. While there,
replace the inline `require("fs")` calls with the top-level import (or
`Bun.file`/`Bun.write`).

### Sessions debounce leaks

The search-debounce effect sets a timeout and returns no cleanup. Tab switch
leaves a pending timer that calls `setResults` on an unmounted component.

### Unused exports

`hermes-home.ts`: `querySessionMessages`, `readSystemPromptInfo`,
`MessageRow`, `TotalsRow`. `open-file.ts`: `openUrl`, `openHermesFile`.
`useSlashCommands`: `complete()` (RPC completion never wired to popover).
`preferences.ts`: `reload`, `configDir`, `configFile`. `useAppKeys` returns
`{ onCopy }` — never consumed.

### Unused imports

`Sidebar.tsx` (`useEffect`, `useCallback`), `theme-picker.tsx` (`useRef`),
`app.tsx` (`userMessage`, `systemMessage`).

---

## Style / AGENTS.md compliance

### `useTheme()` destructuring

Repo rule is `const theme = useTheme().theme`. 18 files still do
`const { theme } = useTheme()`. `app.tsx:300` calls `useTheme()` a second time
when `themeCtx` is already in scope — use `themeCtx.theme`.

### `any`

`prompts.tsx` `onSubmit={fn as any}` → documented
`as unknown as (e: SubmitEvent) => void`. `theme/context.tsx` `children: any`
→ `ReactNode`. `hermes-home.ts` four `any` → `unknown` + narrow.

---

## Architecture

### Two data paths, one session concept

Chat/Config/Cron/Skills/Toolsets go through RPC; Sessions/Env/Analytics/
Overview/Memory/Context still read `~/.hermes/` via `hermes-home.ts`.
`Sessions.tsx` lists rows from `state.db` while `useSession.resume()` goes
through RPC — if the gateway's `HERMES_HOME`/profile differs, the list shows
sessions you can't open. Migrate Sessions to `session.list` first; the rest
can stay filesystem-backed for now, but the split should be deliberate.

### `turnReducer` loses part interleaving

One `buf` string + one streaming `TextPart` means text→tool→text collapses
into tool-then-text. `MessageItem` renders `thinkingParts` then `toolParts`
then `content` regardless of insertion order, so chronological rendering
(OpenCode-style) is impossible. Reducer should close the open text part on
`tool.start` and open a fresh one on the next `message.delta`; `MessageItem`
should iterate `parts` in order.

### Remaining RPC surface (from previous pass)

- Rollback UI — `rollback.list` / `rollback.restore` / `rollback.diff`
- Voice — `voice.toggle` / `voice.record` / `voice.tts`
- MCP — `reload.mcp`
- `session.usage` → Analytics tab (replaces client-side cost math above)
