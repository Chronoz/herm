/**
 * Filterable select dialog — reusable pick-list for dialogs.
 *
 * Keyboard: up/down navigate, enter selects, typing filters.
 * Mouse: hover highlights, click selects.
 * Grouped by category with headers.
 */

import { useState, useMemo, useEffect } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"

export type SelectOption = {
  readonly title: string
  readonly value: string
  readonly description?: string
  readonly category?: string
}

type Props = {
  readonly title: string
  readonly options: ReadonlyArray<SelectOption>
  readonly onSelect: (option: SelectOption) => void
  readonly onMove?: (option: SelectOption) => void
  readonly placeholder?: string
  readonly current?: string
}

export const DialogSelect = (props: Props) => {
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState(0)
  const { theme } = useTheme()

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase()
    return props.options.filter(o =>
      o.title.toLowerCase().includes(lower) ||
      (o.description ?? "").toLowerCase().includes(lower)
    )
  }, [filter, props.options])

  // Group by category
  const groups = useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    filtered.forEach(o => {
      const cat = o.category ?? ""
      const arr = map.get(cat) ?? []
      arr.push(o)
      map.set(cat, arr)
    })
    return map
  }, [filtered])

  // Clamp cursor
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1))
  }, [filtered.length, cursor])

  // Notify on move
  useEffect(() => {
    const item = filtered[cursor]
    if (item && props.onMove) props.onMove(item)
  }, [cursor, filtered, props.onMove])

  useKeyboard((key) => {
    if (key.name === "up") {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.name === "down") {
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }
    if (key.name === "return") {
      const item = filtered[cursor]
      if (item) props.onSelect(item)
      return
    }
  })

  // Build flat list with index tracking
  const rows: { type: "header"; cat: string }[] | { type: "item"; option: SelectOption; idx: number }[] = []
  let idx = 0
  const entries = Array.from(groups.entries())

  return (
    <box flexDirection="column" width={60}>
      <text fg={theme.text}>
        <strong>{props.title}</strong>
      </text>
      <box height={1} />
      <input
        value={filter}
        onChange={setFilter}
        placeholder={props.placeholder ?? "Type to filter..."}
        focused={true}
        textColor={theme.text}
        placeholderColor={theme.textMuted}
        backgroundColor={theme.backgroundElement}
        focusedBackgroundColor={theme.backgroundElement}
      />
      <box height={1} />
      <scrollbox scrollY maxHeight={16} flexDirection="column">
        {filtered.length === 0 ? (
          <text fg={theme.textMuted}>{"No results found"}</text>
        ) : null}
        {entries.map(([cat, items]) => {
          const elements: React.ReactNode[] = []
          if (cat) {
            elements.push(
              <text key={`cat-${cat}`} fg={theme.textMuted}>
                <strong>{cat}</strong>
              </text>
            )
          }
          items.forEach(item => {
            const i = idx++
            const active = i === cursor
            const current = item.value === props.current
            elements.push(
              <box
                key={item.value}
                backgroundColor={active ? theme.backgroundElement : undefined}
                onMouseOver={() => setCursor(i)}
                onMouseDown={() => props.onSelect(item)}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={active ? theme.text : theme.textMuted}>
                  {current ? "● " : "  "}{item.title}{item.description ? ` — ${item.description}` : ""}
                </text>
              </box>
            )
          })
          return elements
        }).flat()}
      </scrollbox>
    </box>
  )
}
