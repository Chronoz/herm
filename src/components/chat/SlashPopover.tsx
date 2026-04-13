/**
 * Slash command popover — OpenCode style.
 *
 * Purely presentational. All keyboard navigation is handled by the parent
 * (app.tsx useKeyboard) to avoid OpenTUI's global keyboard event conflicts.
 *
 * Uses a sliding window that follows the cursor instead of scrollbox
 * (scrollbox needs focus/keyboard to scroll, which conflicts with input).
 */

import { useMemo } from "react"
import { useTheme } from "../../theme"
import type { SlashCommand } from "../../commands/slash"
import { labels } from "../../commands/slash"

type Props = {
  readonly commands: ReadonlyArray<SlashCommand>
  readonly cursor: number
  readonly onCursor: (idx: number) => void
  readonly onSelect: (cmd: SlashCommand) => void
}

type Row = { type: "header"; cat: string } | { type: "cmd"; cmd: SlashCommand; flat: number }

const MAX_VISIBLE = 14

export const SlashPopover = ({ commands: cmds, cursor, onCursor, onSelect }: Props) => {
  const { theme } = useTheme()

  if (cmds.length === 0) {
    return (
      <box
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingX={1}
        height={3}
      >
        <text fg={theme.textMuted}>No matching commands</text>
      </box>
    )
  }

  // Build flat row list with headers interleaved
  const rows = useMemo(() => {
    const result: Row[] = []
    const groups = new Map<string, { cmd: SlashCommand; flat: number }[]>()
    let flat = 0
    for (const cmd of cmds) {
      const cat = cmd.category
      const arr = groups.get(cat) ?? []
      arr.push({ cmd, flat: flat++ })
      groups.set(cat, arr)
    }
    for (const [cat, items] of groups) {
      result.push({ type: "header", cat })
      for (const item of items) result.push({ type: "cmd", ...item })
    }
    return result
  }, [cmds])

  // Find the row index of the cursor for windowing
  const cursorRow = rows.findIndex(r => r.type === "cmd" && r.flat === cursor)
  const start = Math.max(0, Math.min(cursorRow - 2, rows.length - MAX_VISIBLE))
  const visible = rows.slice(start, start + MAX_VISIBLE)
  const clipped = rows.length > MAX_VISIBLE
  const above = clipped && start > 0
  const below = clipped && start + MAX_VISIBLE < rows.length
  const height = visible.length + 2 + (above ? 1 : 0) + (below ? 1 : 0)

  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      paddingX={1}
      height={height}
    >
      {above ? (
        <box height={1} paddingLeft={1}>
          <text fg={theme.textMuted}>↑ more</text>
        </box>
      ) : null}
      {visible.map((row, i) => {
        if (row.type === "header") {
          return (
            <box key={`h-${row.cat}`} height={1} paddingLeft={1}>
              <text>
                <span fg={theme.textMuted}>
                  <strong>{labels[row.cat as SlashCommand["category"]] ?? row.cat}</strong>
                </span>
              </text>
            </box>
          )
        }
        const active = row.flat === cursor
        return (
          <box
            key={`c-${row.cmd.name}`}
            height={1}
            flexDirection="row"
            backgroundColor={active ? theme.backgroundElement : undefined}
            onMouseOver={() => onCursor(row.flat)}
            onMouseDown={() => onSelect(row.cmd)}
            paddingLeft={2}
            paddingRight={1}
          >
            <box flexGrow={1} height={1}>
              <text>
                <span fg={active ? theme.primary : theme.text}>
                  /{row.cmd.name}
                </span>
                <span fg={theme.textMuted}>
                  {"  "}{row.cmd.description}
                </span>
              </text>
            </box>
            <box height={1}>
              <text>
                <span fg={row.cmd.target === "gateway" ? theme.info : theme.textMuted}>
                  {row.cmd.target === "gateway" ? "gateway" : "local"}
                </span>
              </text>
            </box>
          </box>
        )
      })}
      {below ? (
        <box height={1} paddingLeft={1}>
          <text fg={theme.textMuted}>↓ more</text>
        </box>
      ) : null}
    </box>
  )
}
