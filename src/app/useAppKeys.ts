// Global keyboard routing for the chat shell.

import { useKeyboard, useRenderer } from "@opentui/react"
import { useRef, useCallback } from "react"
import { copySelection } from "../utils/clipboard"

const INTERRUPT_WINDOW = 5000

type Opts = {
  tab: number
  setTab: (fn: (t: number) => number) => void
  focusRegion: "input" | "content"
  setFocusRegion: (r: "input" | "content" | ((r: "input" | "content") => "input" | "content")) => void
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

export function useAppKeys(opts: Opts) {
  const renderer = useRenderer()
  const lastEsc = useRef(0)
  const onCopy = useCallback(() => copySelection(renderer), [renderer])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    if (key.ctrl && key.name === "left") {
      opts.setTab(t => Math.max(0, t - 1))
      opts.setFocusRegion("input")
      return
    }
    if (key.ctrl && key.name === "right") {
      opts.setTab(t => Math.min(10, t + 1))
      opts.setFocusRegion("input")
      return
    }

    if (opts.popOpen) {
      if (key.name === "escape") return opts.onPopCancel()
      if (key.name === "up") return opts.onPopNavigate(-1)
      if (key.name === "down") return opts.onPopNavigate(1)
      if (key.name === "tab") return opts.onPopAccept()
      return
    }

    if (key.name === "tab" && !opts.streaming) {
      opts.setFocusRegion(r => r === "input" ? "content" : "input")
      return
    }

    if (key.name === "escape") {
      if (opts.streaming) {
        const now = Date.now()
        if (now - lastEsc.current < INTERRUPT_WINDOW) {
          opts.onInterrupt()
          lastEsc.current = 0
        } else {
          lastEsc.current = now
          opts.onInterruptNotice()
        }
      } else if (opts.focusRegion === "content") {
        opts.setFocusRegion("input")
      }
      return
    }

    if (key.ctrl && key.name === "y") return opts.onCopyLast()

    if (opts.focusRegion === "input" && !opts.streaming) {
      if (key.name === "up") return opts.onHistoryUp()
      if (key.name === "down") return opts.onHistoryDown()
    }

    if (opts.focusRegion === "content" && !opts.streaming && !key.ctrl && !key.meta) {
      if (key.name.length === 1 && key.name !== " ") opts.setFocusRegion("input")
    }
  })

  return { onCopy }
}
