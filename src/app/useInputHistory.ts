// Up/down history for composer input.
// Persisted to ~/.config/herm/history (one line per entry, newest last).

import { useState, useRef, useCallback } from "react"
import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs"

const MAX = 500

const DIR = process.env.HERM_CONFIG_DIR || join(homedir(), ".config", "herm")
const FILE = join(DIR, "history")

// In-memory order is newest-first (index 0 = most recent); on-disk is
// append-only newest-last, so load() reverses.
function load() {
  if (!existsSync(FILE)) return []
  return readFileSync(FILE, "utf-8").split("\n").filter(Boolean).slice(-MAX).reverse()
}

export function useInputHistory(input: string, setInput: (v: string) => void) {
  const hist = useRef<string[]>(null)
  if (hist.current === null) hist.current = load()
  const [, bump] = useState(0)
  const idx = useRef(-1)
  const stash = useRef("")

  const push = useCallback((msg: string) => {
    idx.current = -1
    stash.current = ""
    const h = hist.current!
    if (msg === h[0]) return
    h.unshift(msg)
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
    if (h.length > MAX) {
      h.length = MAX
      writeFileSync(FILE, [...h].reverse().join("\n") + "\n", "utf-8")
    } else {
      appendFileSync(FILE, msg + "\n", "utf-8")
    }
    bump(n => n + 1)
  }, [])

  const up = useCallback(() => {
    const h = hist.current!
    if (h.length === 0) return
    if (idx.current === -1) stash.current = input
    const next = Math.min(idx.current + 1, h.length - 1)
    idx.current = next
    setInput(h[next])
  }, [input, setInput])

  const down = useCallback(() => {
    if (idx.current === -1) return
    const next = idx.current - 1
    idx.current = next
    setInput(next === -1 ? stash.current : hist.current![next])
  }, [setInput])

  return { push, up, down }
}
