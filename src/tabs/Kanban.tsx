import { useState, useEffect, useCallback, useMemo, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { board, detail, STATUSES, type Task, type Status, type Detail } from "../utils/hermes-kanban"
import { useKeys } from "../keys"
import { useTheme } from "../theme"
import { TabShell } from "../ui/shell"
import { KVBlock } from "../ui/kv"
import { ago, trunc } from "../ui/fmt"

// Read-only board for ~/.hermes/kanban.db. Columns per status; ↑↓
// within a column, ←→ across, Enter shows a detail pane with body /
// result / lineage / comments. Writes go through `hermes kanban` or
// the dashboard; this is the monitoring surface.

const HEAD: Record<Status, string> = {
  triage: "triage", todo: "todo", ready: "ready",
  running: "running", blocked: "blocked", done: "done",
}

const Card = memo((p: { t: Task; on: boolean; colOn: boolean; onPick: () => void }) => {
  const theme = useTheme().theme
  const fg = p.on ? theme.accent : p.colOn ? theme.text : theme.textMuted
  return (
    <box height={2} flexDirection="column"
         backgroundColor={p.on ? theme.backgroundElement : undefined}
         onMouseDown={p.onPick}>
      <box height={1} overflow="hidden">
        <text>
          <span fg={p.on ? theme.primary : theme.textMuted}>{p.on ? "▸ " : "  "}</span>
          <span fg={fg}>{trunc(p.t.title, 60)}</span>
        </text>
      </box>
      <box height={1} overflow="hidden">
        <text fg={theme.textMuted}>
          {`  ${p.t.id.slice(0, 8)}  ${p.t.assignee ?? "—"}${p.t.priority ? `  P${p.t.priority}` : ""}${p.t.pid ? `  pid ${p.t.pid}` : ""}`}
        </text>
      </box>
    </box>
  )
})

const Column = memo((p: {
  status: Status; tasks: Task[]; on: boolean; sel: number
  onPick: (i: number) => void
}) => {
  const theme = useTheme().theme
  const tint = p.status === "blocked" ? theme.warning
    : p.status === "running" ? theme.success
    : p.status === "done" ? theme.textMuted : theme.primary
  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={20}
         border borderColor={p.on ? theme.primary : theme.border} paddingLeft={1} paddingRight={1}>
      <box height={1}>
        <text>
          <span fg={tint}><strong>{HEAD[p.status]}</strong></span>
          <span fg={theme.textMuted}>{`  ${p.tasks.length}`}</span>
        </text>
      </box>
      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          {p.tasks.map((t, i) => (
            <Card key={t.id} t={t} on={p.on && i === p.sel} colOn={p.on}
                  onPick={() => p.onPick(i)} />
          ))}
        </box>
      </scrollbox>
    </box>
  )
})

const DetailPane = memo((p: { d: Detail }) => {
  const { theme, syntaxStyle } = useTheme()
  const d = p.d
  return (
    <box flexDirection="column" padding={1} border borderColor={theme.border}
         backgroundColor={theme.backgroundPanel} width="50%">
      <box height={1}>
        <text>
          <span fg={theme.primary}><strong>{d.id}</strong></span>
          <span fg={theme.textMuted}>{`  ·  ${d.status}  ·  ${ago(d.updated_at)}`}</span>
        </text>
      </box>
      <box height={1}><text fg={theme.accent}><strong>{d.title}</strong></text></box>
      <box height={1} />
      <KVBlock rows={[
        ["Assignee", d.assignee ?? "—"],
        ["Priority", d.priority ? `P${d.priority}` : "—"],
        ["Tenant", d.tenant ?? undefined],
        ["Parents", d.parents.length ? d.parents.join(", ") : undefined],
        ["Children", d.children.length ? d.children.join(", ") : undefined],
        ["PID", d.pid ? String(d.pid) : undefined],
        ["Error", d.error ?? undefined, theme.error],
      ]} />
      <box height={1} />
      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          {d.body ? <markdown content={d.body} fg={theme.markdownText} syntaxStyle={syntaxStyle} /> : null}
          {d.result ? <>
            <box height={1} />
            <box height={1}><text fg={theme.textMuted}>Result</text></box>
            <markdown content={d.result} fg={theme.markdownText} syntaxStyle={syntaxStyle} />
          </> : null}
          {d.comments.length > 0 ? <>
            <box height={1} />
            <box height={1}><text fg={theme.textMuted}>{`Comments (${d.comments.length})`}</text></box>
            {d.comments.map((c, i) => (
              <box key={i} flexDirection="column" marginTop={1}>
                <box height={1}><text fg={theme.textMuted}>{`${c.author}  ·  ${ago(c.at)}`}</text></box>
                <text wrapMode="word">{c.body}</text>
              </box>
            ))}
          </> : null}
        </box>
      </scrollbox>
    </box>
  )
})

export const Kanban = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const dims = useTerminalDimensions()
  const [data, setData] = useState(() => board())
  const [col, setCol] = useState(0)
  const [row, setRow] = useState(0)
  const [open, setOpen] = useState<Detail | null>(null)

  const load = useCallback(() => setData(board()), [])
  useEffect(load, [load])

  // Drop empty columns at narrow widths but never collapse the one
  // the selection is on.
  const cols = useMemo(() => {
    const all = STATUSES.map(s => ({ status: s, tasks: data.get(s) ?? [] }))
    if (dims.width >= 160) return all
    return all.filter((c, i) => c.tasks.length > 0 || i === col)
  }, [data, dims.width, col])

  const cur = cols[Math.min(col, cols.length - 1)]
  const task = cur?.tasks[Math.min(row, (cur?.tasks.length ?? 1) - 1)]
  const total = [...data.values()].reduce((a, v) => a + v.length, 0)

  const keys = useKeys()
  useKeyboard((key) => {
    if (!props.focused) return
    if (key.name === "escape" && open) return setOpen(null)
    if (keys.match("list.refresh", key)) return load()
    if (key.name === "left")
      return setCol(c => { const n = Math.max(0, c - 1); setRow(0); return n })
    if (key.name === "right")
      return setCol(c => { const n = Math.min(cols.length - 1, c + 1); setRow(0); return n })
    if (key.name === "up")
      return setRow(r => Math.max(0, r - 1))
    if (key.name === "down")
      return setRow(r => Math.min((cur?.tasks.length ?? 1) - 1, r + 1))
    if (key.name === "return" && task)
      return setOpen(o => o?.id === task.id ? null : detail(task.id))
  })

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={`Kanban · ${total} task${total === 1 ? "" : "s"}`}
        hint="←→ column  ↑↓ task  Enter detail  r reload"
      >
        {total === 0
          ? <text fg={theme.textMuted}>no tasks — board at ~/.hermes/kanban.db</text>
          : (
            <box flexDirection="row" flexGrow={1} gap={1}>
              {cols.map((c, i) => (
                <Column key={c.status} status={c.status} tasks={c.tasks}
                        on={i === Math.min(col, cols.length - 1)} sel={row}
                        onPick={r => { setCol(i); setRow(r); setOpen(detail(c.tasks[r].id)) }} />
              ))}
            </box>
          )}
      </TabShell>
      {open ? <DetailPane d={open} /> : null}
    </box>
  )
})
