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
    expect(t.gw.last("session.create")).toBeDefined()

    t.destroy()
  })

  test("ctrl+left/right switches tabs", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    // → Overview (index 0)
    act(() => t.keys.pressArrow("left", { ctrl: true }))
    await until(t, () => /overview|Identity/i.test(t.frame()))

    // → Sessions (index 3)
    act(() => { for (let i = 0; i < 3; i++) t.keys.pressArrow("right", { ctrl: true }) })
    await t.settle()
    // Sandboxed HERMES_HOME has no state.db → empty state
    expect(t.frame()).toContain("No sessions")

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
    expect(f).toContain("Hermes")   // assistant header
    expect(f).toContain("3→5")      // usage footer

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
    expect(t.frame()).toContain("You")
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
      "commands.catalog": () => ({ pairs: [["model", "Switch model"]] }),
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
