/**
 * Toast notification system — auto-dismiss messages.
 *
 * Usage:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   const toast = useToast()
 *   toast.show({ variant: "success", message: "Done!" })
 *   toast.error(new Error("oops"))
 */

import { createContext, useContext, useState, useCallback, useRef } from "react"
import type { ReactNode } from "react"
import { useTheme } from "../theme"
import type { RGBA } from "@opentui/core"

type ToastVariant = "info" | "error" | "warning" | "success"

type ToastOptions = {
  readonly variant: ToastVariant
  readonly title?: string
  readonly message: string
  readonly duration?: number
}

type ToastEntry = ToastOptions & {
  readonly id: number
}

type ToastContext = {
  readonly show: (opts: ToastOptions) => void
  readonly error: (err: Error) => void
}

const Ctx = createContext<ToastContext | null>(null)

const DEFAULT_DURATION = 3000

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastEntry[]>([])
  const counter = useRef(0)

  const show = useCallback((opts: ToastOptions) => {
    const id = ++counter.current
    setItems(prev => [...prev, { ...opts, id }])
    const dur = opts.duration ?? DEFAULT_DURATION
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, dur)
  }, [])

  const error = useCallback((err: Error) => {
    show({ variant: "error", title: "Error", message: err.message })
  }, [show])

  const value: ToastContext = { show, error }

  return (
    <Ctx.Provider value={value}>
      {children}
      {items.length > 0 ? <ToastOverlay items={items} /> : null}
    </Ctx.Provider>
  )
}

const ToastOverlay = ({ items }: { items: ReadonlyArray<ToastEntry> }) => {
  const { theme } = useTheme()

  const color = (variant: ToastVariant): RGBA => {
    switch (variant) {
      case "error": return theme.error
      case "warning": return theme.warning
      case "success": return theme.success
      default: return theme.info
    }
  }

  return (
    <box
      position="absolute"
      top={2}
      right={2}
      flexDirection="column"
      gap={1}
      zIndex={200}
      maxWidth={60}
    >
      {items.map(item => (
        <box
          key={item.id}
          backgroundColor={theme.backgroundPanel}
          border={["left"] as const}
          borderStyle="single"
          borderColor={color(item.variant)}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
        >
          {item.title ? (
            <text fg={theme.text}>
              <strong>{item.title}</strong>
            </text>
          ) : null}
          <text fg={theme.textMuted} wrapMode="word">
            {item.message}
          </text>
        </box>
      ))}
    </box>
  )
}

export const useToast = (): ToastContext => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useToast() must be inside <ToastProvider>")
  return ctx
}
