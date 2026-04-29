# herm

> A modern terminal UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

**herm** /hɜːm/ _noun_ — a sculptured head of Hermes on a square stone pillar, used in ancient Greece as a boundary marker at crossroads.

Herm is a tabbed, mouse-aware TUI built with [OpenTUI](https://github.com/anomalyco/opentui) (React renderer) and [Bun](https://bun.sh/). It speaks to a long-lived `tui_gateway` Python process over stdio JSON-RPC — the same gateway `hermes --tui` uses — which means your sessions, history, memory, skills and config are the same whether you're in herm or the Ink client.

> **Status:** pre-release. APIs and keybinds are stable enough to use daily; expect rough edges. See [Known issues](#known-issues).

<!-- TODO: hero screenshot — chat tab, eikon avatar, thought cloud mid-stream -->

## What it does

- **Chat** — streaming, markdown, code blocks, diff rendering, tool-call expansion, animated ASCII avatar (`.eikon`) with ambient thought cloud
- **Sessions** — browse, branch, rollback, rename
- **Context / Agents / Skills / Cron / Toolsets / Memory / Env / Config** — each its own tab
- **Command palette** (`Ctrl+K`), **slash popover** with prefix matching, **@-refs** for file/diff context
- **Fully rebindable keys** (`/keys`), theme picker, per-profile settings

## Install

Herm is a client. It needs a working [Hermes Agent](https://github.com/NousResearch/hermes-agent) checkout and Python venv on the same machine.

### Option A — from source (recommended for feedback)

```bash
# 1. Hermes Agent — installed + working (check: `hermes --version`)
# 2. Clone herm
git clone https://github.com/liftaris/herm.git
cd herm
bun install

# 3. Run
bun run src/index.tsx
```

### Option B — `bunx`

```bash
bunx github:liftaris/herm
```

`bun install` runs a postinstall that stubs out a few heavy OpenTUI peer deps (`three`, `planck`, `jimp`, `bun-webgpu`, `@dimforge/rapier2d-simd-compat`) that herm doesn't use. See `scripts/postinstall.ts`.

## Gateway discovery

Herm spawns `tui_gateway` from your Hermes Agent checkout. It looks in this order:

| precedence | location |
|---|---|
| 1 | `$HERMES_AGENT_ROOT` env var |
| 2 | `~/.hermes/hermes-agent` |
| 3 | `~/Dev/hermes-agent` |

Python is resolved similarly: `$HERMES_PYTHON` > `$VIRTUAL_ENV/bin/python` > `<root>/venv/bin/python` > `<root>/.venv/bin/python` > `python3`.

If startup hangs, tail `~/.hermes/logs/gateway.log`.

## Keybinds (default)

Global:

| key | action |
|---|---|
| `Tab` / `Shift+Tab` | next / prev tab |
| `Ctrl+1`…`Ctrl+9` | jump to tab N |
| `Ctrl+K` | command palette |
| `Ctrl+L` | force-repaint terminal |
| `F1` | help / shortcut catalog |
| `Ctrl+C` | quit (or copy selection) |
| `Ctrl+Z` | suspend to shell |

Chat:

| key | action |
|---|---|
| `Enter` | send (or queue while streaming) |
| `Shift+Enter` / `Ctrl+J` / `Alt+Enter` | newline |
| `Esc` × 2 | interrupt turn |
| `/` | slash popover |
| `@` | context ref popover |
| `Ctrl+G` | open buffer in `$EDITOR` |

Run `/keys` in-app to rebind anything.

## Slash commands

`/help`, `/new`, `/clear`, `/model`, `/theme`, `/title`, `/eikon`, `/rollback`, `/keys`, `/logs` — plus every command the gateway exposes (skills, plugins, MCP prompts). `/h` resolves by unique prefix; ambiguous prefixes show a disambiguation row.

Composer supports `{!cmd}` shell interpolation, e.g. `review {!git diff --cached}` expands via `shell.exec`.

## Avatars (`.eikon`)

The sidebar avatar animates through states (`idle`, `thinking`, `streaming`, …) via an NDJSON ASCII animation format. Herm scans `~/.hermes/eikons` and `~/Dev/eikon/avatars` by default — drop `*.eikon` files into either, or set `HERM_EIKON_DIRS` (colon-separated) to point elsewhere. Use `/eikon` in-app to browse.

Eikon authoring tooling lives in a separate repo.

## Environment variables

| var | purpose |
|---|---|
| `HERMES_AGENT_ROOT` | override gateway source tree location |
| `HERMES_PYTHON` | override Python interpreter |
| `HERMES_HOME` | override `~/.hermes` (sessions, memory, skills, config) |
| `HERM_CONFIG_DIR` | override `~/.config/herm` (herm's TUI prefs) |
| `HERM_EIKON_DIRS` | colon-separated `.eikon` search paths |
| `PERF=1` | periodic memory + render timing logs |
| `PERF=verbose` | per-frame render stats |
| `CONTROL=1` | expose control server on `:7777` for headless testing |

See `.env.example` for a copy-pastable template.

## Development

```bash
bun run dev            # watch mode
bun run typecheck      # tsc --noEmit
bun test               # runs the OpenTUI headless harness
bun run dev:perf       # with profiling
```

Tests use the harness in `test/harness.tsx` — real React + real OpenTUI renderer against a null framebuffer, no DOM-style mocks.

## Known issues

Pre-release; here's what's already filed and why you shouldn't `git blame` on it:

- **Toolsets tab:** toggling a non-core toolset (e.g. `hermes-cli`, MCP bundles) appears to flip then reverts. The gateway's `tools.configure` whitelist rejects it; herm doesn't yet surface this. Works fine for `file`, `web`, `terminal`, `browser`, etc.
- **Config tab:** in narrow terminals, arrow keys can get stuck steering the wrong pane. Workaround: widen the window, or use mouse / `←→` to switch pane focus explicitly.
- **Chat tab:** short responses (< 6 lines) can be occluded by the thought-cloud overlay until streaming completes. `[wontfix]` — it's a visual layering tradeoff; use `Esc×2` then re-read if it bothers you.
- **Sidebar:** currently carries more operational detail than it needs. Redesign in flight.

## Architecture (one paragraph)

`src/index.tsx` spins up an OpenTUI renderer and mounts `<App>`. `<App>` owns the single `useKeyboard` handler and routes keys via a rebindable catalog (`src/keys/`). State per-tab is React-local; cross-tab state lives in `src/home/` (Hermes home dir mirror) and the gateway. The gateway client (`src/utils/gateway-client.ts`) is a line-delimited JSON-RPC 2.0 transport over stdio with an event emitter. UI primitives (`src/ui/`, `src/components/`) are composed from OpenTUI's `<box>`/`<text>`/`<scrollbox>`/`<textarea>`.

## Acknowledgments

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — the brain
- [OpenTUI](https://github.com/anomalyco/opentui) — the TUI framework
- [ascii-image-converter](https://github.com/TheZoraiz/ascii-image-converter) — source of the avatar art

## License

MIT — see [LICENSE](./LICENSE).
