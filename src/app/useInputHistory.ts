// Up/down history for composer input.
// Persisted under the herm config dir (typically ~/.hermes/herm/history).

import { useState, useRef, useCallback } from "react"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs"
import { configDir } from "../utils/paths"

const MAX = 500

const file = () => join(configDir(), "history")

// In-memory order is newest-first (index 0 = most recent); on-disk is
// append-only newest-last, so load() reverses.
function load() {
  const FILE = file()
  if (!existsSync(FILE)) return []
  return readFileSync(FILE, "utf-8").split("\n").filter(Boolean)
    .map(l => l.replace(/\0/g, "\n")).slice(-MAX).reverse()
}

function enc(s: string) { return s.replace(/\n/g, "\0") }

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
    const DIR = configDir()
    const FILE = file()
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
    if (h.length > MAX) {
      h.length = MAX
      writeFileSync(FILE, [...h].reverse().map(enc).join("\n") + "\n", "utf-8")
    } else {
      appendFileSync(FILE, enc(msg) + "\n", "utf-8")
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
