/**
 * Reactive data layer for ~/.hermes/.
 *
 * A slice is a typed reader with optional dependency keys and optional
 * fs.watch paths. `ensure(k)` lazily resolves deps, reads, and starts a
 * watcher on first pull. `invalidate(k)` drops the value, re-reads if there
 * are subscribers, and cascades to dependents.
 *
 * Pilot scope: `config` and `memoryProviders`. Remaining readers migrate
 * in from utils/hermes-home.ts as they're converted to collectors.
 */

import { watch, existsSync, statSync, type FSWatcher } from "node:fs"
import { dirname, basename } from "node:path"
import {
  hermesPath,
  readConfig,
  readMemoryFile,
  readMemoryProviders,
  type HermesConfig,
  type MemoryFileInfo,
  type MemoryProviderInfo,
} from "../utils/hermes-home"

// ─── State shape ──────────────────────────────────────────────────────

export interface HomeState {
  config: HermesConfig | null
  memory: MemoryFileInfo | null
  userProfile: MemoryFileInfo | null
  memoryProviders: MemoryProviderInfo[]
}

export type SliceKey = keyof HomeState

export interface Slice<K extends SliceKey> {
  /** Produce the value. Receives already-resolved dependency values. */
  read: (deps: Partial<HomeState>) => Promise<HomeState[K]>
  /** Slice keys this reader needs resolved first. Invalidation cascades along these edges. */
  deps?: readonly SliceKey[]
  /** Absolute paths to fs.watch. Change → invalidate(k). */
  watch?: readonly string[]
}

type Slices = { [K in SliceKey]: Slice<K> }

const SLICES: Slices = {
  config: {
    read: () => readConfig(),
    watch: [hermesPath("config.yaml")],
  },
  memory: {
    read: (d) => readMemoryFile("MEMORY.md", d.config?.memory?.memory_char_limit ?? 2200),
    deps: ["config"],
    watch: [hermesPath("memories/MEMORY.md")],
  },
  userProfile: {
    read: (d) => readMemoryFile("USER.md", d.config?.memory?.user_char_limit ?? 1375),
    deps: ["config"],
    watch: [hermesPath("memories/USER.md")],
  },
  memoryProviders: {
    read: (d) => readMemoryProviders(d.config?.memory?.provider ?? ""),
    deps: ["config"],
  },
}

/** Reverse dep edges: key → slices that listed it in `deps`. */
const DEPENDENTS: ReadonlyMap<SliceKey, readonly SliceKey[]> = (() => {
  const m = new Map<SliceKey, SliceKey[]>()
  for (const [k, s] of Object.entries(SLICES) as [SliceKey, Slice<SliceKey>][]) {
    for (const d of s.deps ?? []) {
      const arr = m.get(d) ?? []
      arr.push(k)
      m.set(d, arr)
    }
  }
  return m
})()

// ─── Store ────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 50

export class HomeStore {
  private data: Partial<HomeState> = {}
  private subs = new Map<SliceKey, Set<() => void>>()
  private inflight = new Map<SliceKey, Promise<unknown>>()
  private watchers = new Map<SliceKey, FSWatcher[]>()
  private debounce = new Map<SliceKey, ReturnType<typeof setTimeout>>()

  /** Current value, or undefined if not yet loaded. Stable ref until changed. */
  get<K extends SliceKey>(k: K): HomeState[K] | undefined {
    return this.data[k] as HomeState[K] | undefined
  }

  /** Register a change listener. Returns unsubscribe. */
  subscribe<K extends SliceKey>(k: K, cb: () => void): () => void {
    let set = this.subs.get(k)
    if (!set) this.subs.set(k, (set = new Set()))
    set.add(cb)
    return () => set.delete(cb)
  }

  /**
   * Resolve deps, read, store, start watching (first call only), notify.
   * Concurrent calls for the same key share one inflight promise.
   */
  ensure<K extends SliceKey>(k: K): Promise<HomeState[K]> {
    if (k in this.data) return Promise.resolve(this.data[k] as HomeState[K])
    const hit = this.inflight.get(k)
    if (hit) return hit as Promise<HomeState[K]>

    const slice = SLICES[k]
    const p = (async () => {
      const deps: Partial<HomeState> = {}
      for (const d of slice.deps ?? []) {
        (deps as Record<SliceKey, unknown>)[d] = await this.ensure(d)
      }
      const v = await slice.read(deps)
      this.data[k] = v
      this.startWatch(k, slice.watch)
      this.notify(k)
      return v
    })().finally(() => this.inflight.delete(k))

    this.inflight.set(k, p)
    return p
  }

  /**
   * Drop the cached value. If there are active subscribers, re-read.
   * Cascades to every slice that declared `k` as a dep.
   */
  invalidate(k: SliceKey): void {
    if (!(k in this.data) && !this.inflight.has(k)) return
    delete this.data[k]
    if (this.subs.get(k)?.size) void this.ensure(k)
    for (const dep of DEPENDENTS.get(k) ?? []) this.invalidate(dep)
  }

  /** Dispose all watchers and timers. Tests must call this. */
  close(): void {
    for (const ws of this.watchers.values()) for (const w of ws) w.close()
    for (const t of this.debounce.values()) clearTimeout(t)
    this.watchers.clear()
    this.debounce.clear()
    this.subs.clear()
    this.inflight.clear()
    this.data = {}
  }

  private notify(k: SliceKey): void {
    const set = this.subs.get(k)
    if (set) for (const cb of set) cb()
  }

  private startWatch(k: SliceKey, paths: readonly string[] | undefined): void {
    if (!paths || this.watchers.has(k)) return
    const ws: FSWatcher[] = []
    const fire = () => {
      const prev = this.debounce.get(k)
      if (prev) clearTimeout(prev)
      this.debounce.set(k, setTimeout(() => this.invalidate(k), DEBOUNCE_MS))
    }
    for (const p of paths) {
      // Watching a file by path is unreliable across rewrites on Linux
      // (inotify binds to the inode). Watch the parent dir and filter on
      // basename; for directory targets watch the dir itself.
      let dir = p
      let name: string | null = null
      try {
        if (existsSync(p) && statSync(p).isFile()) {
          dir = dirname(p)
          name = basename(p)
        }
      } catch {
        continue
      }
      if (!existsSync(dir)) continue
      try {
        ws.push(watch(dir, { persistent: false }, (_ev, f) => {
          if (name === null || f === name) fire()
        }))
      } catch {
        // Unwatchable (permissions, exotic fs). Slice still works; just not reactive.
      }
    }
    this.watchers.set(k, ws)
  }
}

export const home = new HomeStore()
