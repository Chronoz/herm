#!/usr/bin/env bun
// Drives a CONTROL=1 herm instance through scenes.ts via the :7777 server.
// Emits a one-line log per step to stderr; stdout stays clean.

import { SCENES, type Step } from "./scenes"

const PORT = Number(process.env.CONTROL_PORT) || 7777
const BASE = `http://127.0.0.1:${PORT}`
const TICK = 150

const log = (s: string) => process.stderr.write(`[drive] ${s}\n`)
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const get = (p: string) => fetch(BASE + p).then(r => r.json()).catch(() => null)
const post = (p: string, body: unknown) =>
  fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => null)

type Status = { ready: boolean; streaming: boolean; tab: number; tabName: string }

async function status(): Promise<Status | null> {
  const r = await get("/status")
  return r && typeof r === "object" && "ready" in r ? (r as Status) : null
}

async function until(pred: (s: Status) => boolean, timeout: number) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const s = await status()
    if (s && pred(s)) return true
    await sleep(TICK)
  }
  return false
}

async function frameHas(grep: string, timeout: number) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const r = await fetch(`${BASE}/frame?json=1&grep=${encodeURIComponent(grep)}`)
      .then(x => x.json() as Promise<{ match?: boolean }>).catch(() => null)
    if (r?.match) return true
    await sleep(TICK)
  }
  return false
}

async function run(step: Step) {
  switch (step.do) {
    case "note":
      return log(step.text)
    case "hold":
      return sleep(step.ms)
    case "tab":
      log(`tab ${step.n}`)
      return get(`/tab/${step.n}`)
    case "key":
      log(`key ${step.ctrl ? "ctrl+" : ""}${step.shift ? "shift+" : ""}${step.name}`)
      return post("/key", step)
    case "keys":
      log(`keys ×${step.seq.length}`)
      return post("/keys", { keys: step.seq, delay: step.delay ?? 0, safe: true })
    case "type":
      log(`type "${step.text.slice(0, 40)}${step.text.length > 40 ? "…" : ""}"`)
      return post("/type", { text: step.text, delay: step.delay ?? 0 })
    case "input":
      return post("/input", { text: step.text })
    case "send":
      log(`send "${step.text.slice(0, 40)}…"`)
      return post("/send", { message: step.text })
    case "wait": {
      const t = step.timeout ?? 30_000
      if (step.for === "ready") {
        log("wait ready…")
        // /status 503s until bridge is set; until() tolerates nulls
        const ok = await until(s => s.ready, t)
        return log(ok ? "ready" : "ready TIMEOUT")
      }
      if (step.for === "idle") {
        log("wait idle…")
        // brief settle so the turn actually starts before we check it's over
        await sleep(400)
        const ok = await until(s => !s.streaming, t)
        return log(ok ? "idle" : "idle TIMEOUT")
      }
      log(`wait frame~"${step.for.grep}"…`)
      const ok = await frameHas(step.for.grep, t)
      return log(ok ? "matched" : "grep TIMEOUT")
    }
    case "quit":
      log("quit")
      await get("/quit")
      return sleep(200)
  }
}

async function main() {
  log(`→ ${BASE}  (${SCENES.length} steps)`)
  // Wait for the server to bind at all — herm boots slower than we do.
  const end = Date.now() + 30_000
  while (Date.now() < end && !(await status())) await sleep(TICK)
  for (const s of SCENES) await run(s)
  log("done")
}

main()
