/**
 * Command palette — register commands with keybinds, open with Ctrl+K.
 *
 * Usage:
 *   <CommandProvider><App /></CommandProvider>
 *
 *   const cmd = useCommand()
 *   useEffect(() => cmd.register([
 *     { title: "Help", value: "help", keybind: "f1", onSelect: () => {} },
 *   ]), [])
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo } from "react"
import type { ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import { useDialog } from "./dialog"
import { DialogSelect } from "./dialog-select"
import type { SelectOption } from "./dialog-select"

export type Command = {
  readonly title: string
  readonly value: string
  readonly keybind?: string
  readonly description?: string
  readonly category?: string
  readonly onSelect: () => void
}

type CommandContext = {
  readonly register: (cmds: ReadonlyArray<Command>) => () => void
  readonly setEnabled: (val: boolean) => void
}

const Ctx = createContext<CommandContext | null>(null)

export const CommandProvider = ({ children }: { children: ReactNode }) => {
  const registry = useRef<Map<string, ReadonlyArray<Command>>>(new Map())
  const [, setRevision] = useState(0)
  const enabled = useRef(true)
  const dialog = useDialog()

  const all = useCallback((): Command[] => {
    const result: Command[] = []
    registry.current.forEach(cmds => cmds.forEach(c => result.push(c)))
    return result
  }, [])

  const register = useCallback((cmds: ReadonlyArray<Command>) => {
    const id = String(Date.now()) + Math.random()
    registry.current.set(id, cmds)
    setRevision(r => r + 1)
    return () => {
      registry.current.delete(id)
      setRevision(r => r + 1)
    }
  }, [])

  const setEnabled = useCallback((val: boolean) => {
    enabled.current = val
  }, [])

  const open = useCallback(() => {
    const cmds = all()
    const options: SelectOption[] = cmds.map(c => ({
      title: c.title,
      value: c.value,
      description: c.keybind ? `[${c.keybind}]` : c.description,
      category: c.category,
    }))
    dialog.replace(
      <DialogSelect
        title="Command Palette"
        options={options}
        onSelect={(opt) => {
          dialog.clear()
          const found = cmds.find(c => c.value === opt.value)
          if (found) found.onSelect()
        }}
        placeholder="Search commands..."
      />
    )
  }, [all, dialog])

  useKeyboard((key) => {
    if (!enabled.current) return

    // Ctrl+K opens command palette
    if (key.ctrl && key.name === "k") {
      open()
      return
    }

    // Match registered keybinds
    const cmds = all()
    cmds.forEach(cmd => {
      if (!cmd.keybind) return
      const kb = cmd.keybind.toLowerCase()
      if (kb === "f1" && key.name === "f1") { cmd.onSelect(); return }
      if (kb === "?" && key.sequence === "?") { cmd.onSelect(); return }
    })
  })

  const value = useMemo<CommandContext>(() => ({ register, setEnabled }), [register, setEnabled])

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}

export const useCommand = (): CommandContext => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useCommand() must be inside <CommandProvider>")
  return ctx
}
