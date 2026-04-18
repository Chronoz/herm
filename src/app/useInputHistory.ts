// Up/down history for composer input.

import { useState, useRef, useCallback } from "react"

const MAX = 50

export function useInputHistory(input: string, setInput: (v: string) => void) {
  const [history, setHistory] = useState<string[]>([])
  const idx = useRef(-1)
  const stash = useRef("")

  const push = useCallback((msg: string) => {
    setHistory(prev => [msg, ...prev.filter(h => h !== msg)].slice(0, MAX))
    idx.current = -1
    stash.current = ""
  }, [])

  const up = useCallback(() => {
    if (history.length === 0) return
    if (idx.current === -1) stash.current = input
    const next = Math.min(idx.current + 1, history.length - 1)
    idx.current = next
    setInput(history[next])
  }, [history, input, setInput])

  const down = useCallback(() => {
    if (idx.current === -1) return
    const next = idx.current - 1
    idx.current = next
    setInput(next === -1 ? stash.current : history[next])
  }, [history, setInput])

  return { push, up, down }
}
