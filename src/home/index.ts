import { useEffect, useSyncExternalStore } from "react"
import { home, type HomeState, type SliceKey } from "./store"

export { home } from "./store"
export type { HomeState, SliceKey } from "./store"

/**
 * Subscribe to a single slice of ~/.hermes/ state.
 *
 * Returns `undefined` until the first read resolves, then the current value.
 * Rerenders on fs.watch-driven invalidation or explicit `home.invalidate(k)`,
 * and only for the requested key.
 */
export function useHome<K extends SliceKey>(k: K): HomeState[K] | undefined {
  const v = useSyncExternalStore(
    (cb) => home.subscribe(k, cb),
    () => home.get(k),
  )
  useEffect(() => {
    void home.ensure(k)
  }, [k])
  return v
}
