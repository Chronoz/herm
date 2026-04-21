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

    expect(t.frame()).toContain("Permission required")
    expect(t.frame()).toContain("$ rm -rf /")

    act(() => t.keys.pressEscape())
    await t.settle()

    const call = t.gw.last("approval.respond")
    expect(call?.params.choice).toBe("deny")
    expect(t.frame()).not.toContain("Permission required")

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
    expect(t.frame()).toContain("Configuration") // category header from pairs shape

    // filter by prefix — would fail if names still carried leading "/"
    await act(async () => { await t.keys.typeText("re") })
    await until(t, () => !t.frame().includes("/model"))
    expect(t.frame()).toContain("/retry")
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

  test("/save toasts the file path via session.save RPC", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/save", "Save conversation"]] }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/save") })
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Saved → /tmp/conv.json"))
    expect(t.gw.last("session.save")).toBeDefined()
    expect(t.gw.last("slash.exec")).toBeUndefined()
    t.destroy()
  })

  test("click user message → action menu → Rewind → N×session.undo → composer seeded", async () => {
    // History after rewind: server-authoritative via session.history.
    const hist = (n: number) => Array.from({ length: n }, (_, i) => ({
      role: i % 2 ? "assistant" : "user", text: `turn${Math.floor(i / 2)}`,
    }))
    let left = 4
    const gw = new MockGateway({
      "session.undo": () => { left = Math.max(0, left - 2); return { removed: 2 } },
      "session.history": () => ({ count: left, messages: hist(left) }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    // Two full turns in the transcript.
    for (const msg of ["first q", "second q"]) {
      await act(async () => { await t.keys.typeText(msg) })
      act(() => t.keys.pressEnter())
      await t.settle()
      act(() => {
        gw.push({ type: "message.start" })
        gw.push({ type: "message.complete", payload: { text: `re: ${msg}`, usage: { input: 1, output: 1, total: 2 } } })
      })
      await until(t, () => t.frame().includes(`re: ${msg}`))
    }

    // Click the first user message → action menu. It's under the cloud
    // overlay in a short transcript, so scroll it into view first.
    const row = () => {
      const rows = t.frame().split("\n")
      return rows.findIndex(l => l.includes("first q") && !l.includes("re:") && !l.includes("┇"))
    }
    await act(async () => {
      for (let i = 0; i < 30 && row() < 0; i++) await t.mouse.scroll(20, 20, "up")
    })
    await until(t, () => row() > 0)
    await act(async () => { await t.mouse.click(4, row()) })
    await until(t, () => t.frame().includes("Message Actions"))
    expect(t.frame()).toContain("Rewind here")
    expect(t.frame()).toContain("Fork here")

    // Select Rewind here (↓ from Copy).
    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    // rewind() is async (N×undo + history fetch) — poll for the seed
    await until(t, () => t.frame().includes("> first q"))

    const undos = t.gw.calls.filter(c => c.method === "session.undo").length
    expect(undos).toBe(2)
    expect(t.gw.last("session.history")).toBeDefined()
    expect(t.frame()).not.toContain("second q")
    expect(t.frame()).not.toContain("Message Actions")
    t.destroy()
  })

  test("action menu → Fork → session.branch + undo-in-branch + switch", async () => {
    const gw = new MockGateway({
      "session.branch": () => ({ session_id: "branch-sid", title: "branch 1" }),
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    // One turn so there's something to fork from.
    await act(async () => { await t.keys.typeText("seed q") })
    act(() => t.keys.pressEnter())
    await t.settle()
    act(() => {
      gw.push({ type: "message.start" })
      gw.push({ type: "message.complete", payload: { text: "re: seed q", usage: { input: 1, output: 1, total: 2 } } })
    })
    await until(t, () => t.frame().includes("re: seed q"))

    const rows = t.frame().split("\n")
    const y = rows.findIndex(l => l.includes("seed q") && !l.includes("re:") && !l.includes("┇"))
    await act(async () => { await t.mouse.click(4, y) })
    await until(t, () => t.frame().includes("Message Actions"))

    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("forked → branch 1"))

    expect(t.gw.last("session.branch")).toBeDefined()
    // Undo targets the BRANCH session, not the original.
    const u = t.gw.calls.find(c => c.method === "session.undo")
    expect(u?.params.session_id).toBe("branch-sid")
    // Switched into it.
    expect(t.gw.last("session.resume")?.params.session_id).toBe("branch-sid")
    // Composer seeded.
    expect(t.frame()).toContain("> seed q")
    t.destroy()
  })

  test("queue: Enter while streaming stacks; drains one per idle; Ctrl+U pops", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    // Turn 1 starts.
    await act(async () => { await t.keys.typeText("first") })
    act(() => t.keys.pressEnter())
    await t.settle()
    act(() => t.gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))

    // Queue two follow-ups while streaming.
    for (const msg of ["follow up a", "follow up b"]) {
      await act(async () => { await t.keys.typeText(msg) })
      act(() => t.keys.pressEnter())
      await t.settle()
    }
    await until(t, () => t.frame().includes("⏸ 2. follow up b"))
    expect(t.gw.calls.filter(c => c.method === "prompt.submit").length).toBe(1)

    // Turn 1 completes → exactly one queued item drains.
    act(() => t.gw.push({ type: "message.complete", payload: { text: "r1", usage: { input: 1, output: 1, total: 2 } } }))
    await until(t, () => t.gw.calls.filter(c => c.method === "prompt.submit").length === 2)
    expect(t.gw.last("prompt.submit")?.params.text).toBe("follow up a")
    act(() => t.gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("⏸ 1. follow up b"))
    expect(t.frame()).not.toContain("⏸ 2.")        // one chip left
    // still just the one extra submit
    expect(t.gw.calls.filter(c => c.method === "prompt.submit").length).toBe(2)

    // Ctrl+U pops tail into composer (removes chip, seeds input).
    act(() => t.keys.pressKey("u", { ctrl: true }))
    await until(t, () => !t.frame().includes("⏸ 1."))
    expect(t.frame()).toContain("> follow up b")

    // Turn 2 completes with empty queue → no further submit.
    act(() => t.gw.push({ type: "message.complete", payload: { text: "r2", usage: { input: 1, output: 1, total: 2 } } }))
    await until(t, () => t.frame().includes("Ready"))
    expect(t.gw.calls.filter(c => c.method === "prompt.submit").length).toBe(2)
    t.destroy()
  })

  test("/usage opens KV dialog populated from session.usage", async () => {
    const gw = new MockGateway({
      "session.usage": () => ({
        model: "test-model", calls: 7, input: 1234, output: 567, total: 1801,
        cache_read: 0, cache_write: 0, cost_usd: 0.0412, cost_status: "estimated",
        context_used: 4200, context_max: 200_000, context_percent: 2,
      }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/usage") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("API calls"))

    const f = t.frame()
    expect(f).toContain("Usage")
    expect(f).toContain("7")          // calls
    expect(f).toContain("1.2k")       // input fmt
    expect(f).toContain("$0.04")      // cost
    expect(f).toContain("2%")         // context percent
    expect(f).toContain("estimated")  // cost_status note
    expect(t.gw.last("slash.exec")).toBeUndefined() // intercepted locally

    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("API calls"))
    t.destroy()
  })

  test("/status dialog reads from cached SessionInfo", async () => {
    const gw = new MockGateway()
    const t = await mount({ gw })
    act(() => gw.push({
      type: "session.info",
      payload: {
        model: "test-model", session_id: "sid-abc", version: "9.9.9",
        cwd: "/workspace", tools: { web: ["a", "b"], file: ["c"] }, skills: {},
      },
    }))
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/status") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Version"))

    const f = t.frame()
    expect(f).toContain("9.9.9")
    expect(f).toContain("sid-abc")
    expect(f).toContain("/workspace")
    expect(f).toContain("3 in 2 toolsets")
    t.destroy()
  })

  test("/history opens transcript dialog from session.history RPC", async () => {
    const gw = new MockGateway({
      "session.history": () => ({
        count: 3,
        messages: [
          { role: "user", text: "write a haiku about debugging" },
          { role: "tool", name: "terminal", context: "ls -la" },
          { role: "assistant", text: "silent stack\nunfolds" },
        ],
      }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/history") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Session History"))

    const f = t.frame()
    expect(f).toContain("3 messages")
    expect(f).toContain("▸ You")
    expect(f).toContain("write a haiku about debugging")
    expect(f).toContain("⚙ terminal")
    expect(f).toContain("ls -la")
    expect(f).toContain("◂ Agent")
    expect(f).toContain("silent stack unfolds")   // newlines collapsed
    expect(t.gw.last("slash.exec")).toBeUndefined() // intercepted locally

    act(() => t.keys.pressEscape())
    await t.settle()
    expect(t.frame()).not.toContain("Session History")
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
