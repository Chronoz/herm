// Global keyboard routing for the chat shell.

import { useKeyboard, useRenderer } from "@opentui/react"
import { useRef } from "react"
import { copySelection } from "../utils/clipboard"

const INTERRUPT_MS = 5000

type Region = "input" | "content"

type Opts = {
  tab: number
  tabMax: number
  setTab: (fn: (t: number) => number) => void
  focusRegion: Region
  setFocusRegion: (r: Region | ((r: Region) => Region)) => void
  streaming: boolean
  popOpen: boolean
  onPopNavigate: (d: -1 | 1) => void
  onPopAccept: () => void
  onPopCancel: () => void
  onHistoryUp: () => void
  onHistoryDown: () => void
  onInterrupt: () => void
  onInterruptNotice: () => void
  onCopyLast: () => void
  input: string
}

export function useAppKeys(o: Opts) {
  const renderer = useRenderer()
  const lastEsc = useRef(0)

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
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

    if (o.popOpen) {
      if (key.name === "escape") return o.onPopCancel()
      if (key.name === "up") return o.onPopNavigate(-1)
      if (key.name === "down") return o.onPopNavigate(1)
      if (key.name === "tab") return o.onPopAccept()
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
        } else {
          lastEsc.current = now
          o.onInterruptNotice()
        }
      } else if (o.focusRegion === "content") {
        o.setFocusRegion("input")
      }
      return
    }

    if (key.ctrl && key.name === "y") return o.onCopyLast()

    if (o.focusRegion === "input" && !o.streaming) {
      if (key.name === "up") return o.onHistoryUp()
      if (key.name === "down") return o.onHistoryDown()
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
