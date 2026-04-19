// Test harness — MockGateway + mount() wrapper around OpenTUI's testRender.
//
// Usage:
//   const t = await mount()
//   t.gw.emit("event", { type: "message.delta", payload: { text: "hi" } })
//   await t.settle()
//   expect(t.frame()).toContain("hi")
//   t.keys.pressArrow("right", { ctrl: true })
//   t.destroy()

import { EventEmitter } from "events"
import { act, type ReactNode } from "react"
import { testRender } from "@opentui/react/test-utils"
import type { MockInput, MockMouse, TestRenderer } from "@opentui/core/testing"
import { App } from "../src/app"
import type { Gateway } from "../src/app/gateway"
import { GatewayProvider } from "../src/app/gateway"
import { ThemeProvider } from "../src/theme"
import { DialogProvider } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { CommandProvider } from "../src/ui/command"
import type { GatewayEvent } from "../src/utils/gateway-types"

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>

/** Scriptable in-memory Gateway. No subprocess. */
export class MockGateway extends EventEmitter implements Gateway {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = []
  private handlers = new Map<string, Handler>()
  private buf: GatewayEvent[] = []
  private logs: string[] = []
  private sub = false
  private sid = ""
  ok = false

  constructor(handlers: Record<string, Handler> = {}) {
    super()
    // Sane defaults so <App> boots without hanging.
    this.on$("session.create", () => ({ session_id: "test-sid" }))
    this.on$("session.resume", p => ({ session_id: p.session_id ?? "test-sid", messages: [] }))
    this.on$("session.list", () => ({ sessions: [] }))
    this.on$("session.search", () => ({ results: [] }))
    this.on$("session.delete", () => ({ deleted: true }))
    this.on$("agents.list", () => ({ processes: [] }))
    this.on$("complete.path", () => ({ items: [] }))
    this.on$("config.get", p => p.key === "full" ? { config: {} } : {})
    this.on$("session.title", p => ({ title: p.title ?? "" }))
    this.on$("session.usage", () => ({}))
    this.on$("commands.catalog", () => ({ pairs: [] }))
    for (const [m, h] of Object.entries(handlers)) this.on$(m, h)
  }

  /** Register (or override) an RPC handler. */
  on$(method: string, fn: Handler) { this.handlers.set(method, fn); return this }

  get ready() { return this.ok }
  setSession(sid: string) { this.sid = sid }

  start() {
    this.ok = true
    this.push({ type: "gateway.ready" })
    this.push({ type: "session.info", payload: { model: "test-model", session_id: "test-sid", tools: {}, skills: {} } })
  }

  drain() {
    if (this.sub) return
    this.sub = true
    for (const ev of this.buf.splice(0)) this.emit("event", ev)
  }

  kill() {}

  tail(n = 200) { return this.logs.slice(-n).join("\n") }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const merged = this.sid && params.session_id === undefined ? { session_id: this.sid, ...params } : params
    this.calls.push({ method, params: merged })
    const h = this.handlers.get(method)
    return (h ? await h(merged) : {}) as T
  }

  /** Push an event; buffers until drained, then emits live. */
  push(ev: GatewayEvent) {
    if (ev.type === "gateway.stderr") this.logs.push(ev.payload.line)
    if (this.sub) return void this.emit("event", ev)
    this.buf.push(ev)
  }

  /** Convenience: last call for a method, or undefined. */
  last(method: string) { return [...this.calls].reverse().find(c => c.method === method) }
}

export type Harness = {
  renderer: TestRenderer
  keys: MockInput
  mouse: MockMouse
  gw: MockGateway
  /** Rendered screen as a newline-joined string. */
  frame: () => string
  /** Flush React + render one frame. Await after any state mutation. */
  settle: () => Promise<void>
  resize: (w: number, h: number) => void
  destroy: () => void
}

type Opts = {
  width?: number
  height?: number
  gw?: MockGateway
  handlers?: Record<string, Handler>
}

/** Mount the full <App> under a test renderer with a MockGateway. */
export async function mount(opts: Opts = {}): Promise<Harness> {
  const gw = opts.gw ?? new MockGateway(opts.handlers)
  return render(<App gateway={gw} />, gw, opts)
}

/** Mount an arbitrary subtree wrapped in all providers (for component tests). */
export async function mountNode(node: ReactNode, opts: Opts = {}): Promise<Harness> {
  const gw = opts.gw ?? new MockGateway(opts.handlers)
  return render(
    <ThemeProvider>
      <GatewayProvider client={gw}>
        <ToastProvider>
          <DialogProvider>
            <CommandProvider>{node}</CommandProvider>
          </DialogProvider>
        </ToastProvider>
      </GatewayProvider>
    </ThemeProvider>,
    gw, opts,
  )
}

async function render(node: ReactNode, gw: MockGateway, opts: Opts): Promise<Harness> {
  const setup = await testRender(node, {
    width: opts.width ?? 160,
    height: opts.height ?? 48,
    // Raw-mode ESC is ambiguous (could prefix an arrow); kitty protocol
    // disambiguates so pressEscape() fires a single clean keypress.
    kittyKeyboard: true,
  })

  const settle = async () => {
    await act(async () => { await Promise.resolve() })
    await act(async () => { await setup.renderOnce() })
  }

  // Two passes: mount effects → drain → state updates → second frame.
  await settle()
  await settle()

  return {
    renderer: setup.renderer,
    keys: setup.mockInput,
    mouse: setup.mockMouse,
    gw,
    frame: setup.captureCharFrame,
    settle,
    resize: setup.resize,
    destroy: () => setup.renderer.destroy(),
  }
}

/** Poll until `fn()` is truthy. Throws on timeout with the last frame. */
export async function until(t: Harness, fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error(`until() timed out\n${t.frame()}`)
    await t.settle()
    await Bun.sleep(5)
  }
}
