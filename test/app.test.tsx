import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"
import type { GatewayEvent } from "../src/utils/gateway-types"

describe("app", () => {
  test("boots and renders chat tab with status bar", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    const f = t.frame()
    expect(f).toContain("Chat")            // tab bar
    expect(f).toContain("test-model")      // status bar from session.info
    expect(f).toContain("Message Hermes")  // composer placeholder
    // boot() resumes lastSessionId if set by an earlier test, else creates
    expect(t.gw.last("session.create") ?? t.gw.last("session.resume")).toBeDefined()

    t.destroy()
  })

  test("ctrl+left/right switches tabs", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    // Chat is index 0; ctrl+left should clamp (no Overview anymore)
    act(() => t.keys.pressArrow("left", { ctrl: true }))
    await t.settle()
    expect(t.frame()).toContain("Message Hermes")

    // → Sessions (index 2)
    act(() => { for (let i = 0; i < 2; i++) t.keys.pressArrow("right", { ctrl: true }) })
    await t.settle()
    // Sandboxed HERMES_HOME has no state.db → empty state
    expect(t.frame()).toContain("No sessions")

    t.destroy()
  })

  test("sidebar hides below 120 cols", async () => {
    const t = await mount({ width: 160, height: 48 })
    await until(t, () => t.frame().includes("Ready"))
    expect(t.frame()).toContain("Identity")

    t.resize(100, 48)
    await t.settle(); await t.settle()
    expect(t.frame()).not.toContain("Identity")

    t.resize(160, 48)
    await t.settle(); await t.settle()
    expect(t.frame()).toContain("Identity")
    t.destroy()
  })

  test("gateway stream renders into transcript", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    const feed: GatewayEvent[] = [
      { type: "message.start" },
      { type: "message.delta", payload: { text: "stream chunk one" } },
      { type: "message.complete", payload: { text: "stream chunk one", usage: { input: 3, output: 5, total: 8 } } },
    ]
    act(() => { for (const ev of feed) t.gw.push(ev) })
    // markdown renders async (tree-sitter) — poll until it lands
    await until(t, () => t.frame().includes("stream chunk one"), 3000)

    const f = t.frame()
    expect(f).toContain("│")        // assistant gutter bar
    expect(f).toContain("3→5 tok")  // usage in header

    t.destroy()
  })

  test("typing + Enter sends prompt.submit and echoes user message", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("hello gateway") })
    await t.settle()
    expect(t.frame()).toContain("hello gateway")  // visible in input

    act(() => t.keys.pressEnter())
    await t.settle()

    const call = t.gw.last("prompt.submit")
    expect(call?.params.text).toBe("hello gateway")
    expect(t.frame()).toContain("▸ you")
    expect(t.frame()).toContain("hello gateway")

    t.destroy()
  })

  test("approval.request renders dialog; escape sends deny", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.gw.push({
      type: "approval.request",
      payload: { command: "rm -rf /", description: "delete everything" },
    }))
    await t.settle()

    expect(t.frame()).toContain("Approval required")
    expect(t.frame()).toContain("rm -rf /")

    act(() => t.keys.pressEscape())
    await t.settle()

    const call = t.gw.last("approval.respond")
    expect(call?.params.choice).toBe("deny")
    expect(t.frame()).not.toContain("Approval required")

    t.destroy()
  })

  test("slash popover opens on '/' and Enter dispatches local command", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/model", "Switch model"]] }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/") })
    await t.settle()
    expect(t.frame()).toContain("/clear")  // local command in popover

    await act(async () => { await t.keys.typeText("cle") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await t.settle()

    // /clear is local — no gateway call, transcript cleared, popover closed
    expect(t.gw.last("slash.exec")).toBeUndefined()
    expect(t.frame()).not.toContain("/clear")

    t.destroy()
  })

  test("/title <arg> sets via session.title RPC and shows in status bar", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/title my overnight run") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes('"my overnight run"'))

    expect(t.gw.last("session.title")?.params.title).toBe("my overnight run")
    expect(t.gw.last("prompt.submit")).toBeUndefined() // intercepted
    expect(t.frame()).toContain("Title: my overnight run") // system line
    t.destroy()
  })

  test("gateway catalog commands appear in popover; filter matches bare name", async () => {
    // Regression: gateway sends slash-prefixed names + {name,pairs} categories;
    // old parser stored "/model" verbatim → filter("mo") never matched and
    // category enrichment was a no-op (wrong key shape).
    const gw = new MockGateway({
      "commands.catalog": () => ({
        pairs: [["/model", "Switch model"], ["/retry", "Retry last"]],
        categories: [{ name: "Configuration", pairs: [["/model", "Switch model"]] }],
        canon: { "/m": "/model" },
        sub: { "/model": ["list"] },
      }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("/model"))
    expect(t.frame()).toContain("/retry")
    expect(t.frame()).toContain("Configuration") // category header from pairs shape

    // filter by prefix — would fail if names still carried leading "/"
    await act(async () => { await t.keys.typeText("mo") })
    await until(t, () => !t.frame().includes("/retry"))
    expect(t.frame()).toContain("/model")
    t.destroy()
  })

  test("popover survives tab round-trip (z-order regression)", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("/clear"))

    act(() => t.keys.pressArrow("right", { ctrl: true }))
    await t.settle()
    act(() => t.keys.pressArrow("left", { ctrl: true }))
    await t.settle(); await t.settle()

    // Content tab remounted after Composer in the parent's paint order;
    // without zIndex on the composer container it overdraws the absolute
    // popover. Popover must still be visible.
    expect(t.frame()).toContain("/clear")
    t.destroy()
  })

  test("failed MCP servers surface as system line on ready", async () => {
    const gw = new MockGateway()
    const t = await mount({ gw })
    // gateway.ready already fired in start(); push a session.info with servers
    act(() => gw.push({
      type: "session.info",
      payload: {
        model: "test-model", session_id: "test-sid", tools: {}, skills: {},
        mcp_servers: [
          { name: "goodsrv", transport: "stdio", tools: 5, connected: true },
          { name: "badsrv", transport: "http", tools: 0, connected: false, error: "ECONNREFUSED" },
        ],
      },
    }))
    await until(t, () => t.frame().includes("MCP:"))
    const f = t.frame()
    expect(f).toContain("1 server(s) failed")
    expect(f).toContain("badsrv (ECONNREFUSED)")
    expect(f).not.toContain("goodsrv (") // good one not listed in failure line
    // sidebar MCP section appears (collapsed) with hint
    expect(f).toContain("▸ MCP")
    expect(f).toContain("1/2 up")
    t.destroy()
  })

  test("gateway slash matching a tab name jumps to that tab", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/skills", "Manage skills"], ["/model", "Switch model"]] }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/skills") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Skills ("))
    // intercepted as tab jump — never hit the slash worker
    expect(t.gw.last("slash.exec")).toBeUndefined()
    expect(t.gw.last("prompt.submit")).toBeUndefined()
    t.destroy()
  })

  test("sidebar Identity shows Profile row", async () => {
    const t = await mount({ width: 160 })
    await until(t, () => t.frame().includes("Identity"))
    // preload.ts sets HERMES_HOME to a sandbox that isn't under profiles/
    expect(t.frame()).toMatch(/Profile\s+default/)
    t.destroy()
  })

  test("failed turn (status=error, text=null) renders error in transcript", async () => {
    // Reproduces the wire trace from a model 404: message.start →
    // lifecycle status.update → message.complete {status:error, text:null}.
    // Before the fix this ended the turn with zero visible output.
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    const feed: GatewayEvent[] = [
      { type: "message.start" },
      { type: "status.update", payload: { kind: "lifecycle", text: "HTTP 404: 404 page not found" } },
      { type: "message.complete", payload: { text: null, status: "error", usage: { input: 0, output: 0, total: 0 } } },
    ]
    act(() => { for (const ev of feed) t.gw.push(ev) })
    await t.settle()

    const f = t.frame()
    expect(f).toContain("HTTP 404")          // lifecycle status persisted as system line
    expect(f).toContain("Error:")            // message.complete status=error → error action
    expect(f).toContain("request failed")

    t.destroy()
  })
})
