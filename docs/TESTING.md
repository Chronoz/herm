# Testing

Herm has two complementary ways to validate behaviour without eyeballing
the UI: an in-process `bun test` harness and a live-instance HTTP control
surface. Both read the same OpenTUI render buffer as plain text.

## `bun test` (headless, no subprocess)

```bash
bun test              # all
bun test test/app     # one file
bun run typecheck     # tsc --noEmit
```

The preload (`test/preload.ts`) points `HERMES_HOME` and `HERM_CONFIG_DIR`
at a per-run tmpdir, so tests never touch `~/.hermes` or `~/.config/herm`.

### Harness (`test/harness.tsx`)

`mount()` renders the full `<App>` under `@opentui/react`'s test renderer
with a **`MockGateway`** injected in place of the Python `tui_gateway`
child. No subprocess. Returns:

| | |
|---|---|
| `t.frame()` | Entire screen as a `\n`-joined string |
| `t.keys` | `pressKey/typeText/pressArrow/pressEnter/pressEscape/...` |
| `t.mouse` | `click/moveTo/drag/scroll` |
| `t.gw` | `MockGateway` — `.push(event)`, `.on$(method, handler)`, `.calls`, `.last(method)` |
| `t.settle()` | Flush React + render one frame |
| `t.destroy()` | Tear down the renderer |

`until(t, () => cond)` polls `settle()` until `cond` is truthy and throws
the current frame on timeout (so a failing assertion shows you the screen).

`mountNode(<Foo/>)` wraps an arbitrary subtree in all providers for
component-level tests.

**MockGateway** ships default handlers for `session.create`, `session.resume`,
`session.usage`, `commands.catalog` so the app boots to "Ready" without
configuration. Override with `mount({ handlers: { "foo.bar": p => ({...}) } })`
or `gw.on$("foo.bar", fn)` after mount. Every `request()` is recorded in
`gw.calls`.

### Writing a test

```ts
import { act } from "react"
import { mount, until } from "./harness"

test("stream renders", async () => {
  const t = await mount()
  await until(t, () => t.frame().includes("Ready"))

  act(() => t.gw.push({ type: "message.delta", payload: { text: "hello" } }))
  await until(t, () => t.frame().includes("hello"))

  t.destroy()
})
```

Rule of thumb: wrap anything that triggers React state (`t.gw.push`,
`t.keys.*`) in `act()`; then `await t.settle()` or `await until(...)`
before asserting on `t.frame()`.

## Control server (live instance, real gateway)

When you need to validate against the real `tui_gateway` (end-to-end),
start herm with `CONTROL=1` and drive it over HTTP on port 7777. Frame
capture uses the same buffer read as the test harness.

```bash
pkill -f 'bun run.*src/index'             # only this pattern — see AGENTS.md
CONTROL=1 bun run src/index.tsx &>/dev/null & disown
sleep 4

curl -s localhost:7777/status | jq .
curl -s localhost:7777/frame              # full screen as text
curl -s 'localhost:7777/frame?grep=Ready' # matching lines only
curl -s localhost:7777/tab/3              # switch to Sessions
curl -s -X POST localhost:7777/type -d '{"text":"hi"}'
curl -s -X POST localhost:7777/key  -d '{"name":"return","safe":false}'
curl -s localhost:7777/frame
```

Endpoints: `/status`, `/tab/:n`, `/send`, `/key`, `/keys`, `/type`,
`/frame`, `/focus`, `/perf`, `/tabs`, `/mem`. Dangerous keys are blocked
per-tab unless `safe:false` is passed.
