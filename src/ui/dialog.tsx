/**
 * Dialog overlay system — modal stack with backdrop.
 *
 * Usage:
 *   <DialogProvider><App /></DialogProvider>
 *
 *   const dialog = useDialog()
 *   dialog.replace(<MyContent />, () => revert())
 *   dialog.clear()
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { RGBA } from "@opentui/core"
import { useTheme } from "../theme"

type DialogEntry = {
  readonly element: ReactNode
  readonly onClose?: () => void
}

type DialogContext = {
  readonly replace: (element: ReactNode, onClose?: () => void) => void
  readonly clear: () => void
  readonly stack: ReadonlyArray<DialogEntry>
}

const Ctx = createContext<DialogContext | null>(null)

const BACKDROP = RGBA.fromInts(0, 0, 0, 150)

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<DialogEntry[]>([])

  const replace = useCallback((element: ReactNode, onClose?: () => void) => {
    setStack([{ element, onClose }])
  }, [])

  const clear = useCallback(() => {
    setStack(prev => {
      const top = prev[prev.length - 1]
      if (top?.onClose) top.onClose()
      return []
    })
  }, [])

  useKeyboard((key) => {
    if (key.name !== "escape") return
    if (stack.length === 0) return
    clear()
  })

  const value = useMemo<DialogContext>(() => ({ replace, clear, stack }), [replace, clear, stack])
  const top = stack.length > 0 ? stack[stack.length - 1] : undefined

  return (
    <Ctx.Provider value={value}>
      {children}
      {top ? <Overlay entry={top} onClose={clear} /> : null}
    </Ctx.Provider>
  )
}

const Overlay = ({ entry, onClose }: { entry: DialogEntry; onClose: () => void }) => {
  const dims = useTerminalDimensions()
  const theme = useTheme().theme

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dims.width}
      height={dims.height}
      zIndex={100}
      backgroundColor={BACKDROP}
      justifyContent="center"
      alignItems="center"
      onMouseDown={onClose}
    >
      <box
        backgroundColor={theme.backgroundPanel}
        borderStyle="single"
        border={true}
        borderColor={theme.border}
        padding={1}
        flexDirection="column"
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        {entry.element}
      </box>
    </box>
  )
}

export const useDialog = (): DialogContext => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useDialog() must be inside <DialogProvider>")
  return ctx
}
