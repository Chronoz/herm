// Shell-level keyboard routing. Input-scoped keys (popover nav, prompt
// history) are delegated to the Composer via its imperative handle so
// there is exactly one global useKeyboard.

import { useKeyboard, useRenderer } from "@opentui/react"
import { useRef, type RefObject } from "react"
import { copySelection } from "../utils/clipboard"
import { editInEditor } from "../utils/editor"
import type { ComposerHandle } from "../components/chat/Composer"

const INTERRUPT_MS = 5000

type Region = "input" | "content"

type Opts = {
  tab: number
  tabMax: number
  setTab: (fn: (t: number) => number) => void
  focusRegion: Region
  setFocusRegion: (r: Region | ((r: Region) => Region)) => void
  streaming: boolean
  composer: RefObject<ComposerHandle | null>
  onInterrupt: () => void
  onInterruptNotice: () => void
  onCopyLast: () => void
  onNotice: (text: string) => void
  /** Inject text into the running turn via session.steer (Shift+Enter). */
  onSteer: (text: string) => void
  /** Pop last queued prompt into the composer; returns whether one existed. */
  onQueuePop: () => boolean
}

export function useAppKeys(o: Opts) {
  const renderer = useRenderer()
  const lastEsc = useRef(0)

  useKeyboard((key) => {
    const c = o.composer.current

    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    if (key.ctrl && key.name === "z") {
      renderer.suspend()
      process.kill(process.pid, "SIGTSTP")
      // Resumes on SIGCONT; OpenTUI's suspend/resume cycle re-enables
      // raw mode and redraws on the next frame.
      process.once("SIGCONT", () => renderer.resume())
      return
    }

    if (key.ctrl && key.name === "g" && !o.streaming) {
      const seed = c?.value() ?? ""
      void editInEditor(renderer, seed).then(out => {
        if (out === undefined) {
          if (!process.env.VISUAL && !process.env.EDITOR)
            o.onNotice("Set $EDITOR or $VISUAL to use Ctrl+G")
          return
        }
        c?.set("")
        c?.insert(out)
        o.setFocusRegion("input")
      })
      return
    }

    if (key.ctrl && key.name === "left") {
      o.setTab(t => Math.max(0, t - 1))
      o.setFocusRegion("input")
      return
    }
    if (key.ctrl && key.name === "right") {
      o.setTab(t => Math.min(o.tabMax, t + 1))
      o.setFocusRegion("input")
      return
    }

    // Shift+Enter while streaming → steer the running turn. Plain Enter
    // falls through to <input> onSubmit (queues). Stop propagation so the
    // input doesn't also enqueue on the same keystroke.
    if (o.streaming && key.shift && key.name === "return") {
      const text = c?.value().trim() ?? ""
      if (text) { o.onSteer(text); c?.set("") }
      key.stopPropagation()
      return
    }

    // Popover owns up/down/tab/escape while open; other keys fall through
    // to the <input> renderable for continued filtering. Popovers are
    // suppressed during streaming (composer input queues instead).
    if (!o.streaming && c?.popOpen()) {
      if (key.name === "escape") return c.popCancel()
      if (key.name === "up") return c.popNav(-1)
      if (key.name === "down") return c.popNav(1)
      if (key.name === "tab") return c.popAccept()
      return
    }

    if (key.name === "tab" && !o.streaming) {
      o.setFocusRegion(r => r === "input" ? "content" : "input")
      return
    }

    if (key.name === "escape") {
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
      if (o.focusRegion === "content") o.setFocusRegion("input")
      return
    }

    if (key.ctrl && key.name === "y") return o.onCopyLast()
    // Ctrl+U (readline kill-to-start) repurposed: if there's a queued
    // prompt, pop it back into the input instead. Only stop propagation
    // on success so the readline binding still works on an empty queue.
    if (key.ctrl && key.name === "u") {
      if (o.onQueuePop()) key.stopPropagation()
      return
    }

    if (o.focusRegion === "input" && !o.streaming) {
      if (key.name === "up") return c?.historyUp()
      if (key.name === "down") return c?.historyDown()
    }

    // Printable char while content has focus → bounce to input. Stop
    // propagation so tab-level handlers (d=delete, /=search, etc.) don't
    // also fire on the same keystroke.
    if (o.focusRegion === "content" && !o.streaming && !key.ctrl && !key.meta) {
      if (key.name.length === 1 && key.name !== " ") {
        o.setFocusRegion("input")
        key.stopPropagation()
      }
    }
  })
}
