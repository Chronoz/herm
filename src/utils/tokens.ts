/**
 * Token count estimator.
 *
 * Uses gpt-tokenizer with o200k_base (GPT-4o / GPT-5 / Claude-close-enough)
 * for accurate counts on static blocks. Falls back to chars/4 if the
 * tokenizer import fails at runtime (shouldn't in production, but keeps
 * tests resilient and prevents a bad dep from breaking renders).
 *
 * Load-time: gpt-tokenizer is 55MB and costs ~170ms to import — roughly
 * half the cold-start import graph. Nothing on the first-frame path
 * (splash, composer, sidebar) needs real token counts, so the module is
 * require()'d lazily on first count() call. Bun's require() is sync and
 * cached, so the first call takes the hit and subsequent calls are free.
 * Background warmup() lets app.tsx kick the import after first render
 * so the first Context-tab visit doesn't stall.
 *
 * Cached by content hash (DJB2) so repeated counts of the same text
 * are free. The grid recomputes on every snapshot refresh (10s) but
 * most content is stable across refreshes — skills, tool schemas, SOUL.
 */

type Enc = { countTokens: (s: string) => number }
let enc: Enc | null | undefined

const load = (): Enc | null => {
  if (enc !== undefined) return enc
  try { enc = require("gpt-tokenizer") as Enc }
  catch { enc = null }
  return enc
}

/** Kick the lazy import off the hot path. Fire-and-forget. */
export const warmup = () => { queueMicrotask(load) }

// Simple DJB2 hash — fast, collision-tolerant for cache keys.
const hash = (s: string): string => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return String(h)
}

const cache = new Map<string, number>()
const CACHE_MAX = 1024

// Fallback when tokenizer unavailable — matches the old chars/4 behavior.
const roughCount = (s: string): number => Math.ceil(s.length / 4)

/**
 * Count tokens in a string. Cached by content hash.
 * Returns 0 for empty string.
 */
export function count(s: string): number {
  if (!s) return 0
  const k = hash(s)
  const hit = cache.get(k)
  if (hit !== undefined) return hit
  let n: number
  try { n = load()?.countTokens(s) ?? roughCount(s) }
  catch { n = roughCount(s) }
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(k, n)
  return n
}

/** Clear the count cache. For tests. */
export function clearCache(): void {
  cache.clear()
}

/**
 * Human-format a token count for compact display:
 *   999 → "999"   1_000 → "1.0K"   10_000 → "10K"
 *   258_000 → "258K"   1_000_000 → "1M"   1_250_000 → "1.2M"
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}
