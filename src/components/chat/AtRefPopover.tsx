// @-ref popover — same sliding-window shell as SlashPopover but with
// a flat file/keyword list (no categories, no source badges).

import { memo } from "react"
import { useTheme } from "../../theme"
import type { AtRefItem } from "../../app/useAtRefPopover"

type Props = {
  readonly items: ReadonlyArray<AtRefItem>
  readonly cursor: number
  readonly onCursor: (idx: number) => void
  readonly onSelect: (idx: number) => void
}

const MAX_VISIBLE = 10

export const AtRefPopover = memo(({ items, cursor, onCursor, onSelect }: Props) => {
  const theme = useTheme().theme

  const start = Math.max(0, Math.min(cursor - 2, items.length - MAX_VISIBLE))
  const visible = items.slice(start, start + MAX_VISIBLE)
  const above = start > 0
  const below = start + MAX_VISIBLE < items.length
  const height = visible.length + 2 + (above ? 1 : 0) + (below ? 1 : 0)

  return (
    <box flexDirection="column" border borderStyle="single"
         borderColor={theme.border} backgroundColor={theme.backgroundPanel}
         paddingX={1} height={height}>
      {above ? <box height={1} paddingLeft={1}><text fg={theme.textMuted}>↑ more</text></box> : null}
      {visible.map((it, j) => {
        const i = start + j
        const active = i === cursor
        return (
          <box key={it.text} height={1} flexDirection="row"
               backgroundColor={active ? theme.backgroundElement : undefined}
               onMouseOver={() => onCursor(i)} onMouseDown={() => onSelect(i)}
               paddingLeft={2} paddingRight={1}>
            <box flexGrow={1} height={1} overflow="hidden">
              <text>
                <span fg={active ? theme.primary : theme.text}>{it.display}</span>
                {it.text !== it.display
                  ? <span fg={theme.textMuted}>{`  ${it.text}`}</span>
                  : null}
              </text>
            </box>
            <box height={1}><text fg={theme.textMuted}>{it.meta}</text></box>
          </box>
        )
      })}
      {below ? <box height={1} paddingLeft={1}><text fg={theme.textMuted}>↓ more</text></box> : null}
    </box>
  )
})
