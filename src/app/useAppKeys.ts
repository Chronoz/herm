// Shell-level keyboard routing. Input-scoped keys (popover nav, prompt
// history) are delegated to the Composer via its imperative handle so
// there is exactly one global useKeyboard.

import { useKeyboard, useRenderer } from "@opentui/react"
import { useRef, useEffect, type RefObject } from "react"
import { copySelection } from "../utils/clipboard"
import { editInEditor } from "../utils/editor"
import { useKeys, conflicts } from "../keys"
import { print as chordPrint } from "../keys/chord"
import type { ComposerHandle } from "../components/chat/Composer"

const INTERRUPT_MS = 5000
export const DOUBLE_TAB_MS = 400

type Region = "input" | "content"

type Opts = {
  tab: number
  tabMax: number
  chatTab: number
  setTab: (fn: (t: number) => number) => void
  focusRegion: Region
  setFocusRegion: (r: Region | ((r: Region) => Region)) => void
  streaming: boolean
  composer: RefObject<ComposerHandle | null>
  onInterrupt: () => void
  onInterruptNotice: () => void
  onCopyLast: () => void
  onAttachClipboard: () => void
  onNotice: (text: string) => void
}

export function useAppKeys(o: Opts) {
  const renderer = useRenderer()
  const keys = useKeys()
  const lastEsc = useRef(0)
  const lastTab = useRef(0)

  // Tabs with their own keyboard surface own focus on entry; Chat keeps
  // the composer since its content region has no keybinds.
  const regionFor = (t: number): Region => t === o.chatTab ? "input" : "content"

  // One-shot conflict scan whenever the resolved table changes (i.e. a
  // user override was written). DEFAULTS are swept by a test, so any
  // hit here is user-introduced — warn but honor the override.
  useEffect(() => {
    const found = conflicts(keys.table)
      .filter(c => !(c.a === "session.interrupt" && c.b === "dialog.cancel"))
    if (found.length === 0) return
    const first = found[0]
    o.onNotice(
      `Keybinding conflict: ${chordPrint([first.chord])} → ${first.a} and ${first.b}` +
      (found.length > 1 ? ` (+${found.length - 1} more)` : ""),
    )
  }, [keys.table])

  useKeyboard((key) => {
    const c = o.composer.current

    if (keys.match("app.exit", key)) {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    if (keys.match("app.suspend", key)) {
      renderer.suspend()
      process.kill(process.pid, "SIGTSTP")
      // Resumes on SIGCONT; OpenTUI's suspend/resume cycle re-enables
      // raw mode and redraws on the next frame.
      process.once("SIGCONT", () => renderer.resume())
      return
    }

    if (keys.match("editor.open", key) && !o.streaming) {
      const seed = c?.value() ?? ""
      void editInEditor(renderer, seed).then(out => {
        if (out === undefined) {
          if (!process.env.VISUAL && !process.env.EDITOR)
            o.onNotice("Set $EDITOR or $VISUAL to use the external editor")
          return
        }
        c?.set(out)
        o.setFocusRegion("input")
      })
      return
    }

    if (keys.match("tab.prev", key)) {
      o.setTab(t => { const n = Math.max(0, t - 1); o.setFocusRegion(regionFor(n)); return n })
      return
    }
    if (keys.match("tab.next", key)) {
      o.setTab(t => { const n = Math.min(o.tabMax, t + 1); o.setFocusRegion(regionFor(n)); return n })
      return
    }
    // Ctrl+1..0 → tab 1..10 (1-indexed), Ctrl+- → tab 11. Structural,
    // not catalog — ten near-identical rebindable actions is noise.
    if (key.ctrl && !key.meta && !key.shift && key.eventType !== "release") {
      const map: Record<string, number> = {
        "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
        "6": 5, "7": 6, "8": 7, "9": 8, "0": 9, "-": 10,
      }
      const n = map[key.name]
      if (n !== undefined && n <= o.tabMax) {
        o.setTab(() => { o.setFocusRegion(regionFor(n)); return n })
        key.stopPropagation()
        return
      }
    }

    // Popover owns up/down/tab/escape while open; stopPropagation keeps the
    // textarea renderable from also moving the cursor on the same keypress.
    // Structural — popover nav is composer-state, not a catalog action.
    if (!o.streaming && c?.popOpen()) {
      if (key.name === "escape") return c.popCancel()
      if (key.name === "up") { c.popNav(-1); key.stopPropagation(); return }
      if (key.name === "down") { c.popNav(1); key.stopPropagation(); return }
      if (key.name === "tab") return c.popAccept()
      return
    }

    if (keys.match("focus.cycle", key) && !o.streaming) {
      if (o.tab === o.chatTab) {
        o.setFocusRegion(r => r === "input" ? "content" : "input")
        return
      }
      if (o.focusRegion === "input") {
        o.setFocusRegion("content")
        return
      }
      // Content-focused on a non-Chat tab: single Tab stays (tab owns it as a
      // nav key); double-tap within the window jumps to the composer.
      const now = Date.now()
      if (now - lastTab.current < DOUBLE_TAB_MS) {
        o.setFocusRegion("input")
        lastTab.current = 0
        key.stopPropagation()
      } else {
        lastTab.current = now
      }
      return
    }

    if (keys.match("session.interrupt", key)) {
      if (o.streaming) {
        const now = Date.now()
        if (now - lastEsc.current < INTERRUPT_MS) {
          o.onInterrupt()
          lastEsc.current = 0
          return
        }
        lastEsc.current = now
        o.onInterruptNotice()
        return
      }
      if (o.tab === o.chatTab && o.focusRegion === "content") o.setFocusRegion("input")
      return
    }

    if (keys.match("reply.copy", key)) return o.onCopyLast()
    if (keys.match("clipboard.attach", key)) {
      o.onAttachClipboard()
      key.stopPropagation()
      return
    }

    // ↑/↓ with a single-line buffer cycles prompt history; with a multi-line
    // buffer historyUp/Down return false so the keystroke falls through to
    // the textarea renderable's move-up/move-down. No stopPropagation — on a
    // single-line buffer the textarea's move-up/down is a no-op anyway, and
    // swallowing the key would starve dialog/select renderables that share
    // the global key bus while focusRegion is still "input".
    if (o.focusRegion === "input" && !o.streaming) {
      if (key.name === "up") return void c?.historyUp()
      if (key.name === "down") return void c?.historyDown()
    }

    // Printable char while Chat transcript has focus → bounce to composer.
    // Other tabs own their printable keys (v=reveal, d=delete, etc.), so the
    // shell must not intercept there.
    if (o.tab === o.chatTab && o.focusRegion === "content" && !o.streaming && !key.ctrl && !key.meta) {
      if (key.name.length === 1 && key.name !== " ") {
        o.setFocusRegion("input")
        key.stopPropagation()
      }
    }
  })
}
