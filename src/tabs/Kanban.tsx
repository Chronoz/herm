import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  board, detail, assignees, tailLog, q, STATUSES,
  type Task, type Status, type Detail,
} from "../utils/hermes-kanban"
import { useKeys } from "../keys"
import { useTheme } from "../theme"
import { useGateway } from "../app/gateway"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import { openConfirm } from "../dialogs/confirm"
import { openTextPrompt } from "../dialogs/text-prompt"
import { openCreateTask } from "../dialogs/new-task"
import { TabShell } from "../ui/shell"
import { KVBlock } from "../ui/kv"
import { ago, trunc } from "../ui/fmt"

// Operator board for ~/.hermes/kanban.db.
//
// Reads are sidecar SQLite. Every write routes through
// `shell.exec → hermes kanban <verb>` so kanban_db.py owns the state
// machine (recompute_ready, link-cycle guard, task_events, notify
// subs) and herm can't drift from the CLI/dashboard.
//
// Verbs exposed here cover the human-operator loop from the
// kanban-orchestrator/worker skills:
//
//   n  create          c  comment              a  assign
//   N  create-child     u  unblock (+answer)    d  archive
//   D  dispatch         r  reload               l  worker log
//   Enter detail        ←→↑↓ nav                Esc close pane

type Sh = { stdout: string; stderr: string; code: number }

const HEAD: Record<Status, string> = {
  triage: "triage", todo: "todo", ready: "ready",
  running: "running", blocked: "blocked", done: "done",
}

const Card = memo((p: { id: string; t: Task; on: boolean; colOn: boolean; onPick: () => void }) => {
  const theme = useTheme().theme
  const fg = p.on ? theme.accent : p.colOn ? theme.text : theme.textMuted
  return (
    <box id={p.id} height={2} flexDirection="column"
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
  const box = useRef<ScrollBoxRenderable | null>(null)
  const id = (i: number) => `kb-${p.status}-${i}`
  // Keep the selected card in view. Fires on ↑↓ and on ←→ (p.on flips
  // true) so entering a column that was previously scrolled away snaps
  // to row 0. No-op while this column isn't active.
  useEffect(() => {
    if (p.on) box.current?.scrollChildIntoView(id(p.sel))
  }, [p.on, p.sel])
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
      <scrollbox ref={box} scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          {p.tasks.map((t, i) => (
            <Card key={t.id} id={id(i)} t={t} on={p.on && i === p.sel} colOn={p.on}
                  onPick={() => p.onPick(i)} />
          ))}
        </box>
      </scrollbox>
    </box>
  )
})

type Pane = { kind: "detail"; d: Detail } | { kind: "log"; id: string; text: string }

const SidePane = memo((p: { pane: Pane }) => {
  const { theme, syntaxStyle } = useTheme()
  if (p.pane.kind === "log") return (
    <box flexDirection="column" padding={1} border borderColor={theme.border}
         backgroundColor={theme.backgroundPanel} width="50%">
      <box height={1}><text>
        <span fg={theme.primary}><strong>{p.pane.id}</strong></span>
        <span fg={theme.textMuted}>{"  ·  worker log (tail)"}</span>
      </text></box>
      <box height={1} />
      <scrollbox scrollY flexGrow={1}>
        <text wrapMode="word" fg={theme.textMuted}>{p.pane.text || "(empty)"}</text>
      </scrollbox>
    </box>
  )
  const d = p.pane.d
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
      <box height={1}><text fg={theme.textMuted}>a assign  c comment  u unblock  d archive  l log  N child</text></box>
    </box>
  )
})

export const Kanban = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()
  const dims = useTerminalDimensions()
  const keys = useKeys()

  const [data, setData] = useState(() => board())
  const [col, setCol] = useState(0)
  const [row, setRow] = useState(0)
  const [pane, setPane] = useState<Pane | null>(null)

  const load = useCallback(() => {
    setData(board())
    setPane(p => p?.kind === "detail" ? (d => d ? { kind: "detail", d } : null)(detail(p.d.id)) : p)
  }, [])
  useEffect(load, [load])

  // Cheap live-ish refresh while focused AND something is running.
  // `running` changing length recreates the interval; back off to
  // manual `r` when idle — no dispatcher → no row churn.
  const running = data.get("running")?.length ?? 0
  useEffect(() => {
    if (!props.focused || running === 0) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [props.focused, running, load])

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

  // `shell.exec → hermes kanban <verb>`. Non-zero → toast the CLI's
  // own stderr (cycle detected, unknown id, etc). reload on success.
  const sh = useCallback((argv: string, ok?: string) =>
    gw.request<Sh>("shell.exec", { command: `hermes kanban ${argv}` }).then(r => {
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
      if (ok) toast.show({ variant: "success", message: ok })
      load()
      return r.stdout
    }).catch((e: Error) => void toast.show({ variant: "error", message: trunc(e.message, 120) })),
  [gw, toast, load])

  // ── Actions ────────────────────────────────────────────────────────

  const live = useRef({ task })
  live.current = { task }

  const create = useCallback((parent?: Task) =>
    openCreateTask(dialog, {
      assignees: assignees(),
      parent: parent ? { id: parent.id, title: parent.title } : undefined,
    }).then(d => {
      if (!d) return
      const flags = [
        d.assignee ? `--assignee ${q(d.assignee)}` : "",
        d.body ? `--body ${q(d.body)}` : "",
        d.priority ? `--priority ${d.priority}` : "",
        d.parent ? `--parent ${q(d.parent)}` : "",
      ].filter(Boolean).join(" ")
      return sh(`create ${q(d.title)} ${flags}`.trim(),
        `Created${d.assignee ? ` → ${d.assignee}` : ""}`)
    }), [dialog, sh])

  const assign = useCallback((t: Task) => {
    const opts = [{ title: "(unassigned)", value: "none" },
      ...assignees().map(n => ({ title: n, value: n }))]
    dialog.replace(
      <DialogSelect title={`Assign ${t.id}`} options={opts} current={t.assignee ?? "none"}
        placeholder="Search profiles…"
        onSelect={o => {
          dialog.clear()
          void sh(`assign ${q(t.id)} ${q(o.value)}`,
            o.value === "none" ? `Unassigned ${t.id}` : `${t.id} → ${o.value}`)
        }} />,
    )
  }, [dialog, sh])

  const comment = useCallback((t: Task) =>
    openTextPrompt(dialog, { title: `Comment on ${t.id}`, label: t.title })
      .then(v => v && sh(`comment ${q(t.id)} ${q(v)} --author user`, "Comment added")),
  [dialog, sh])

  const unblock = useCallback((t: Task) => {
    if (t.status !== "blocked")
      return void toast.show({ variant: "info", message: `${t.id} is ${t.status}, not blocked` })
    return openTextPrompt(dialog, {
      title: `Unblock ${t.id}`, label: "Answer (posted as comment, then task → ready)",
    }).then(async v => {
      // Comment first so the respawned worker sees the answer in its
      // context (build_worker_context reads the thread). Empty answer
      // still unblocks — operator just wants a retry.
      if (v) await sh(`comment ${q(t.id)} ${q(v)} --author user`)
      return sh(`unblock ${q(t.id)}`, `Unblocked ${t.id}`)
    })
  }, [dialog, sh, toast])

  const archive = useCallback((t: Task) =>
    openConfirm(dialog, {
      title: "Archive task?", danger: true, yes: "archive",
      body: `${t.id}  ·  ${trunc(t.title, 60)}\n\nMoves to 'archived' and ends any open run. Children stay; their dependency on this task is treated as satisfied.`,
    }).then(ok => { if (ok) void sh(`archive ${q(t.id)}`, `Archived ${t.id}`) }),
  [dialog, sh])

  const dispatch = useCallback(() => {
    const ready = data.get("ready")?.length ?? 0
    if (ready === 0)
      return void toast.show({ variant: "info", message: "No tasks in 'ready'" })
    return openConfirm(dialog, {
      title: "Dispatch ready tasks?",
      body: `${ready} task${ready === 1 ? "" : "s"} in 'ready'. Spawns one worker per task (one pass).`,
      yes: "dispatch",
    }).then(ok => { if (ok) void sh("dispatch --json", `Dispatched (${ready} ready)`) })
  }, [dialog, sh, toast, data])

  const showLog = useCallback((t: Task) => {
    const text = tailLog(t.id)
    if (text == null)
      return void toast.show({ variant: "info", message: `No worker log for ${t.id}` })
    setPane({ kind: "log", id: t.id, text })
  }, [toast])

  // Data-driven verb table. `when` gates availability; anything that
  // needs a selected task reads through `live.current`.
  type Act = { key: string; title: string; when: (t?: Task) => boolean; run: (t?: Task) => void }
  const ACTS = useMemo<Act[]>(() => [
    { key: "n", title: "New task",      when: () => true,            run: () => void create() },
    { key: "N", title: "New child",     when: t => !!t,              run: t => void create(t) },
    { key: "a", title: "Assign",        when: t => !!t,              run: t => assign(t!) },
    { key: "c", title: "Comment",       when: t => !!t,              run: t => void comment(t!) },
    { key: "u", title: "Unblock",       when: t => t?.status === "blocked", run: t => void unblock(t!) },
    { key: "d", title: "Archive",       when: t => !!t,              run: t => void archive(t!) },
    { key: "l", title: "Worker log",    when: t => !!t,              run: t => showLog(t!) },
    { key: "D", title: "Dispatch",      when: () => true,            run: () => void dispatch() },
  ], [create, assign, comment, unblock, archive, showLog, dispatch])

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (key.name === "escape" && pane) return setPane(null)
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
      return setPane(p => p?.kind === "detail" && p.d.id === task.id
        ? null : (d => d ? { kind: "detail", d } : null)(detail(task.id)))
    const t = live.current.task
    const hit = ACTS.find(a => a.key === key.raw && a.when(t))
    if (hit) return hit.run(t)
  })

  const hint = useMemo(() => {
    const t = task
    return ["←→↑↓ nav", "Enter detail",
      ...ACTS.filter(a => a.when(t)).map(a => `${a.key} ${a.title.toLowerCase()}`),
      "r reload"].join("  ")
  }, [ACTS, task])

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={`Kanban · ${total} task${total === 1 ? "" : "s"}${running ? ` · ${running} running` : ""}`}
        hint={hint}
      >
        {total === 0
          ? <box flexDirection="column">
              <text fg={theme.textMuted}>no tasks — board at ~/.hermes/kanban.db</text>
              <box height={1} />
              <text fg={theme.textMuted}>press <span fg={theme.accent}>n</span> to create one</text>
            </box>
          : (
            <box flexDirection="row" flexGrow={1} gap={1}>
              {cols.map((c, i) => (
                <Column key={c.status} status={c.status} tasks={c.tasks}
                        on={i === Math.min(col, cols.length - 1)} sel={row}
                        onPick={r => {
                          setCol(i); setRow(r)
                          const d = detail(c.tasks[r].id)
                          if (d) setPane({ kind: "detail", d })
                        }} />
              ))}
            </box>
          )}
      </TabShell>
      {pane ? <SidePane pane={pane} /> : null}
    </box>
  )
})
