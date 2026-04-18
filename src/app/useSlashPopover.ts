// Popover filtering and ghost text for the slash-command composer.

import { useMemo, useEffect, useState } from "react"
import { filter as filterSlash, matchSub, type SlashCommand } from "../commands/slash"

export function useSlashPopover(input: string, cmds: ReadonlyArray<SlashCommand>) {
  const [cursor, setCursor] = useState(0)

  const popover = useMemo(() => {
    const subs = matchSub(cmds, input)
    if (subs) return subs
    const m = input.match(/^\/(\S*)$/)
    return m ? filterSlash(cmds, m[1]) : null
  }, [input, cmds])

  // Reset cursor when input changes
  useEffect(() => { setCursor(c => c === 0 ? c : 0) }, [input])

  const ghost = useMemo(() => {
    if (!popover || popover.length === 0) return ""
    const best = popover[Math.min(cursor, popover.length - 1)]
    if (!best || best.name.includes(" ")) return ""
    const m = input.match(/^\/(\S*)$/)
    if (!m) return ""
    const typed = m[1]
    if (typed.length < 2) return ""
    if (!best.name.toLowerCase().startsWith(typed.toLowerCase())) return ""
    return best.name.slice(typed.length)
  }, [input, popover, cursor])

  const open = popover !== null && popover.length > 0

  return { popover, cursor, setCursor, ghost, open }
}
