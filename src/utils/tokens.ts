/**
 * Token count estimator.
 *
 * Uses gpt-tokenizer with o200k_base (GPT-4o / GPT-5 / Claude-close-enough)
 * for accurate counts on static blocks. Falls back to chars/4 if the
 * tokenizer import fails at runtime (shouldn't in production, but keeps
 * tests resilient and prevents a bad dep from breaking renders).
 *
 * Cached by content hash (DJB2) so repeated counts of the same text
 * are free. The grid recomputes on every snapshot refresh (10s) but
 * most content is stable across refreshes — skills, tool schemas, SOUL.
 *
 * Accuracy over chars/4:
 *   prose         — within a few percent either way
 *   JSON schemas  — trend LOWER than chars/4 (common keys like "type" /
 *                   "properties" are single-token despite their length)
 *   CJK / emoji   — MUCH higher than chars/4 (1-3 tokens per char)
 *
 * The grid cares about relative proportions, not absolute counts; any
 * single consistent tokenizer produces a more honest visual ratio than
 * chars/4 for heterogeneous content (English prompt + JSON schemas +
 * non-ASCII memory entries side-by-side). o200k_base is ~3-5% off real
 * Anthropic counts, which doesn't matter for visualization.
 */

import { countTokens as gptCount } from "gpt-tokenizer"

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
  try {
    n = gptCount(s)
  } catch {
    n = roughCount(s)
  }
  if (cache.size >= CACHE_MAX) {
    // Drop oldest entry (first in insertion order).
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
 *
 * Under 10k keeps one decimal; at/above 10k integer K; at/above 1M uses
 * one decimal unless the value is a whole multiple.
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
