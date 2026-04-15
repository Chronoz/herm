/**
 * control.ts — HTTP control server for headless/automated interaction.
 *
 * Runs on CONTROL_PORT (default 7777) when CONTROL=1 env is set.
 * Exposes imperative actions: tab navigation, message sending, perf dumps.
 *
 * Usage:
 *   CONTROL=1 bun run dev              # start with control server
 *   curl localhost:7777/status          # get app state
 *   curl localhost:7777/tab/3           # switch to Sessions tab
 *   curl -X POST localhost:7777/send -d '{"message":"hello"}'
 *   curl localhost:7777/perf            # dump perf report
 *
 * The bridge is set by AppInner via control.setBridge({...}).
 */

import * as perf from "./perf"

const PORT = Number(process.env.CONTROL_PORT) || 7777
export const enabled = process.env.CONTROL === "1"

export type Bridge = {
  tab: () => number
  setTab: (n: number) => void
  send: (msg: string) => void
  ready: () => boolean
  streaming: () => boolean
  messages: () => number
  session: () => string
}

let bridge: Bridge | null = null

export function setBridge(b: Bridge) {
  bridge = b
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  if (!bridge) return json({ error: "bridge not ready" }, 503)

  // GET /status — app state snapshot
  if (path === "/status") {
    const m = process.memoryUsage()
    return json({
      tab: bridge.tab(),
      ready: bridge.ready(),
      streaming: bridge.streaming(),
      messages: bridge.messages(),
      session: bridge.session(),
      rss: Math.round(m.rss / 1024 / 1024),
      heap: Math.round(m.heapUsed / 1024 / 1024),
    })
  }

  // GET /tab/:n — switch tab
  const tabMatch = path.match(/^\/tab\/(\d+)$/)
  if (tabMatch) {
    const n = Number(tabMatch[1])
    if (n < 0 || n > 10) return json({ error: "tab 0-10" }, 400)
    bridge.setTab(n)
    return json({ tab: n })
  }

  // POST /send — send a message
  if (path === "/send" && req.method === "POST") {
    const body = await req.json() as { message?: string }
    if (!body.message) return json({ error: "message required" }, 400)
    if (!bridge.ready()) return json({ error: "not connected" }, 503)
    if (bridge.streaming()) return json({ error: "already streaming" }, 409)
    bridge.send(body.message)
    return json({ sent: true, message: body.message })
  }

  // GET /perf — return all profiling data as JSON
  if (path === "/perf") {
    const d = perf.data()
    if (!d) return json({ error: "PERF not enabled" }, 400)
    return json(d)
  }

  // GET /tabs — cycle through all tabs with a delay
  if (path === "/tabs") {
    const ms = Number(url.searchParams.get("delay") || "500")
    for (let i = 0; i <= 10; i++) {
      bridge.setTab(i)
      await new Promise(r => setTimeout(r, ms))
    }
    bridge.setTab(1)
    return json({ cycled: 11, delay: ms })
  }

  // GET /mem — memory snapshot
  if (path === "/mem") {
    perf.mem("control:snapshot")
    const m = process.memoryUsage()
    return json({
      rss: Math.round(m.rss / 1024 / 1024),
      heap: Math.round(m.heapUsed / 1024 / 1024),
      heapTotal: Math.round(m.heapTotal / 1024 / 1024),
      external: Math.round(m.external / 1024 / 1024),
    })
  }

  return json({ error: "not found", routes: ["/status", "/tab/:n", "/send", "/perf", "/tabs", "/mem"] }, 404)
}

export function start() {
  if (!enabled) return
  Bun.serve({ port: PORT, fetch: handle })
  process.stderr.write(`\x1b[90m[control] http://localhost:${PORT}\x1b[0m\n`)
}
