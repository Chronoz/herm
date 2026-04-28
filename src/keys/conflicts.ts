import { DEFAULTS, scopesOverlap, type ActionId } from "./catalog"
import { key, type Chord } from "./chord"

export type Conflict = { chord: Chord; a: ActionId; b: ActionId }

/**
 * Find all action pairs that share a chord in overlapping scopes.
 * O(N) bucket by chord-key, then pairwise scopesOverlap() within each
 * bucket (buckets are tiny in practice).
 */
export function conflicts(table: ReadonlyMap<ActionId, ReadonlyArray<Chord>>): Conflict[] {
  const buckets = new Map<string, Array<[ActionId, Chord]>>()
  for (const [id, chords] of table)
    for (const c of chords) {
      const k = key(c)
      const b = buckets.get(k)
      if (b) b.push([id, c])
      else buckets.set(k, [[id, c]])
    }
  const out: Conflict[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    for (let i = 0; i < bucket.length; i++)
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, c] = bucket[i], [b] = bucket[j]
        if (scopesOverlap(DEFAULTS[a].scope, DEFAULTS[b].scope))
          out.push({ chord: c, a, b })
      }
  }
  return out
}

/** Actions whose current chord collides with `id`'s in an overlapping scope. */
export function conflictsWith(
  table: ReadonlyMap<ActionId, ReadonlyArray<Chord>>,
  id: ActionId,
): ActionId[] {
  const mine = new Set((table.get(id) ?? []).map(key))
  if (mine.size === 0) return []
  const scope = DEFAULTS[id].scope
  const out: ActionId[] = []
  for (const [other, chords] of table) {
    if (other === id) continue
    if (!scopesOverlap(scope, DEFAULTS[other].scope)) continue
    if (chords.some(c => mine.has(key(c)))) out.push(other)
  }
  return out
}
