/**
 * Fuzzy subsequence scorer.
 *
 * Returns a positive number when `needle` is a (case-insensitive) subsequence
 * of `hay`, weighted so that tighter / earlier / boundary-aligned matches rank
 * higher. Returns 0 when the needle cannot be found as a subsequence.
 *
 * Bonuses:
 *  - start of string
 *  - consecutive characters
 *  - word boundaries: after `_ - / . space` or a lower→Upper camel hump
 *  - exact prefix (guarantees prefix matches outrank scattered ones)
 */

const SEP = new Set(["-", "_", "/", " ", "."])

function boundary(hay: string, i: number) {
  if (i === 0) return true
  const prev = hay[i - 1]
  if (SEP.has(prev)) return true
  if (prev === prev.toLowerCase() && hay[i] !== hay[i].toLowerCase()) return true
  return false
}

export function score(needle: string, hay: string): number {
  if (!needle) return 0
  const n = needle.toLowerCase()
  const h = hay.toLowerCase()
  let pts = 0
  let from = 0
  let prev = -2
  for (let i = 0; i < n.length; i++) {
    const at = h.indexOf(n[i], from)
    if (at < 0) return 0
    pts += 1
    if (at === 0) pts += 8
    if (at === prev + 1) pts += 5
    if (at !== prev + 1 && boundary(hay, at)) pts += 4
    pts -= (at - (prev < 0 ? 0 : prev + 1)) * 0.1
    prev = at
    from = at + 1
  }
  if (h.startsWith(n)) pts += 100
  return pts - hay.length * 0.01
}
