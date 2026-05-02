// Create/edit a kanban task. Tab cycles fields; ↑↓ pick assignee or
// bump priority depending on focused field; Enter submits when title
// is non-empty. Body is single-line here — longer specs go in as a
// follow-up comment (c) from the board.

import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

export type Draft = {
  title: string; body: string; assignee: string | null
  priority: number; parent: string | null
}

type Field = "title" | "body" | "assignee" | "priority"
const ORDER: Field[] = ["title", "body", "assignee", "priority"]

export function openCreateTask(
  dialog: DialogContext,
  opts: { assignees: string[]; parent?: { id: string; title: string } },
): Promise<Draft | null> {
  return new Promise(resolve => {
    const done = (r: Draft | null) => { dialog.clear(); resolve(r) }
    dialog.replace(<Form pool={opts.assignees} parent={opts.parent} done={done} />)
  })
}

const Form = (p: {
  pool: string[]; parent?: { id: string; title: string }; done: (r: Draft | null) => void
}) => {
  const theme = useTheme().theme
  const pool = ["(unassigned)", ...p.pool]
  const [field, setField] = useState<Field>("title")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [who, setWho] = useState(0)
  const [pri, setPri] = useState(0)
  const valid = title.trim().length > 0

  const edit = (fn: (s: string) => string) =>
    field === "title" ? setTitle(fn) : setBody(fn)

  useKeyboard((key) => {
    if (key.name === "escape") return p.done(null)
    if (key.name === "return") {
      if (!valid) return
      return p.done({
        title: title.trim(), body: body.trim(),
        assignee: who === 0 ? null : pool[who],
        priority: pri, parent: p.parent?.id ?? null,
      })
    }
    if (key.name === "tab") {
      const i = ORDER.indexOf(field)
      return setField(ORDER[(i + (key.shift ? ORDER.length - 1 : 1)) % ORDER.length])
    }
    if (key.name === "up" || key.name === "down") {
      const d = key.name === "up" ? -1 : 1
      if (field === "priority") return setPri(n => Math.max(0, Math.min(9, n + d)))
      return setWho(i => (i + d + pool.length) % pool.length)
    }
    if (field === "title" || field === "body") {
      if (key.name === "backspace") return edit(s => s.slice(0, -1))
      if (key.ctrl && key.name === "u") return edit(() => "")
      if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1 && key.raw >= " ")
        return edit(s => s + key.raw)
    }
  })

  const row = (f: Field, label: string, val: string) => (
    <box height={1} flexDirection="row">
      <box width={11}><text fg={field === f ? theme.accent : theme.textMuted}>
        {field === f ? "▸ " : "  "}{label}
      </text></box>
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <text>
          <span fg={theme.text}>{val}</span>
          {field === f && (f === "title" || f === "body")
            ? <span fg={theme.accent}>█</span> : null}
        </text>
      </box>
    </box>
  )

  return (
    <box flexDirection="column" width={64}>
      <box height={1}><text fg={theme.primary}>
        <strong>{p.parent ? `New Task  ·  child of ${p.parent.id}` : "New Task"}</strong>
      </text></box>
      {p.parent ? <box height={1}><text fg={theme.textMuted}>  {p.parent.title}</text></box> : null}
      <box height={1} />
      {row("title", "Title", title)}
      {row("body", "Body", body || "—")}
      {row("assignee", "Assignee", pool[who])}
      {row("priority", "Priority", pri ? `P${pri}` : "—")}
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {valid ? "Enter create  ·  Tab field  ·  ↑↓ pick  ·  Esc cancel" : "type a title  ·  Tab field"}
      </text></box>
    </box>
  )
}
