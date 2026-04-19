// @-ref completion for the composer. Triggers when the word under the
// cursor starts with `@` (and we're not in slash mode). The gateway's
// `complete.path` already understands the `@` prefix — it returns the
// fixed keyword list for bare `@`, and path completions for
// `@file:…` / `@folder:…` (and maps bare `@<path>` → `@file:` / `@folder:`).
//
// Expansion itself happens server-side in `prompt.submit`; this hook
// only drives the popover UI and text insertion.

import { useEffect, useRef, useState } from "react"
import { useGateway, useGatewayReady } from "./gateway"

export type AtRefItem = {
  readonly text: string
  readonly display: string
  readonly meta: string
}

// Find the @-word the caret is at the end of. Returns {word, start}
// or null when not applicable. Bails on slash-command input so the
// two popovers never contend.
export function atWordAt(input: string): { word: string; start: number } | null {
  if (input.startsWith("/")) return null
  const end = input.length
  let i = end
  while (i > 0 && !/\s/.test(input[i - 1])) i--
  if (i >= end || input[i] !== "@") return null
  return { word: input.slice(i, end), start: i }
}

export function useAtRefPopover(input: string) {
  const gw = useGateway()
  const ready = useGatewayReady()
  const [items, setItems] = useState<AtRefItem[]>([])
  const [cursor, setCursor] = useState(0)
  const seq = useRef(0)
  const dismissed = useRef<string | null>(null)

  const spot = atWordAt(input)

  useEffect(() => {
    if (!spot || !ready) { setItems([]); setCursor(0); return }
    if (dismissed.current === spot.word) return
    dismissed.current = null
    const me = ++seq.current
    gw.request<{ items: AtRefItem[] }>("complete.path", { word: spot.word })
      .then(r => {
        if (seq.current !== me) return
        setItems(r.items ?? [])
        setCursor(0)
      })
      .catch(() => { if (seq.current === me) setItems([]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot?.word, ready, gw])

  const open = spot !== null && items.length > 0

  const accept = (src: string, idx = cursor): string | null => {
    const at = atWordAt(src)
    const it = items[idx]
    if (!at || !it) return null
    const trail = it.text.endsWith(":") || it.text.endsWith("/") ? "" : " "
    return src.slice(0, at.start) + it.text + trail + src.slice(at.start + at.word.length)
  }

  const dismiss = () => {
    seq.current++
    dismissed.current = spot?.word ?? null
    setItems([])
  }

  return { open, items, cursor, setCursor, accept, dismiss }
}
