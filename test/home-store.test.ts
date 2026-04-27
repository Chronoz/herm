import { describe, test, expect, beforeAll, afterEach } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

const HH = process.env.HERMES_HOME!
let HomeStore: typeof import("../src/home/store").HomeStore

const writeConfig = (provider: string) =>
  writeFileSync(
    join(HH, "config.yaml"),
    `memory:\n  provider: ${provider}\n  memory_char_limit: 2200\n  user_char_limit: 1375\n`,
  )

beforeAll(async () => {
  mkdirSync(HH, { recursive: true })
  mkdirSync(join(HH, "memories"), { recursive: true })
  writeConfig("mem0")
  writeFileSync(join(HH, "mem0.json"), JSON.stringify({ api_key: "sk-abcdef123456", user_id: "u" }))
  writeFileSync(join(HH, "memories", "MEMORY.md"), "one\n§\ntwo\n§\nthree")
  writeFileSync(join(HH, "memories", "USER.md"), "name: test")
  // Import after fixtures exist so module-level hermesPath resolves to the sandbox.
  HomeStore = (await import("../src/home/store")).HomeStore
})

const stores: InstanceType<typeof HomeStore>[] = []
const mk = () => {
  const s = new HomeStore()
  stores.push(s)
  return s
}
afterEach(() => {
  while (stores.length) stores.pop()!.close()
})

const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

describe("HomeStore", () => {
  test("ensure reads and caches; get is sync", async () => {
    const h = mk()
    expect(h.get("config")).toBeUndefined()
    const c = await h.ensure("config")
    expect(c?.memory.provider).toBe("mem0")
    expect(h.get("config")).toBe(c)
    // Second ensure returns the cached value, not a re-read.
    expect(await h.ensure("config")).toBe(c)
  })

  test("concurrent ensure dedupes inflight", async () => {
    const h = mk()
    const [a, b] = await Promise.all([h.ensure("config"), h.ensure("config")])
    expect(a).toBe(b)
  })

  test("deps resolve before read", async () => {
    const h = mk()
    const providers = await h.ensure("memoryProviders")
    // memoryProviders depends on config for the active name; config must be populated.
    expect(h.get("config")).not.toBeUndefined()
    expect(providers.find(p => p.name === "mem0")?.active).toBe(true)
  })

  test("invalidate cascades to dependents", async () => {
    const h = mk()
    const c0 = await h.ensure("config")
    await h.ensure("memoryProviders")
    let fired = 0
    h.subscribe("memoryProviders", () => { fired++ })
    h.invalidate("config")
    // Dependent has a subscriber → re-ensure cascades, which re-pulls config.
    await settle(10)
    expect(fired).toBeGreaterThan(0)
    expect(h.get("config")).not.toBe(c0)
  })

  test("subscribe + unsubscribe", async () => {
    const h = mk()
    let n = 0
    const off = h.subscribe("config", () => { n++ })
    await h.ensure("config")
    expect(n).toBe(1)
    off()
    h.invalidate("config")
    await h.ensure("config")
    expect(n).toBe(1)
  })

  test("memory slice consumes config limit via deps", async () => {
    const h = mk()
    const m = await h.ensure("memory")
    expect(m?.charLimit).toBe(2200)
    expect(m?.entryCount).toBe(3)
  })

  test("fs.watch drives re-read on external write", async () => {
    const h = mk()
    await h.ensure("config")
    const seen: string[] = []
    h.subscribe("config", () => {
      const v = h.get("config")
      if (v) seen.push(v.memory.provider)
    })
    writeConfig("honcho")
    // Debounce is 50ms; fs.watch latency varies. 200ms is comfortably past both.
    await settle(200)
    expect(seen).toContain("honcho")
    // Restore for other test files that share the sandbox.
    writeConfig("mem0")
    await settle(100)
  })

  test("close disposes watchers and state", async () => {
    const h = mk()
    await h.ensure("config")
    h.close()
    expect(h.get("config")).toBeUndefined()
    // Writing after close must not throw (watcher gone) and must not revive state.
    writeConfig("mem0")
    await settle(100)
    expect(h.get("config")).toBeUndefined()
  })
})
