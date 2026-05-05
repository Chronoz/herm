import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  boardOf, detailOf, tailLogOf, assignees, q, STATUSES,
  currentBoard, listBoards, resetKanban,
  type Task, type Status, type Detail, type Board,
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

// Operator surface for every kanban board under ~/.hermes/.
//
// Boards stack vertically; each is a collapsible section (▾/▸
// header + capped-height row of status columns). Reads are sidecar
// SQLite per board. Every write routes through `shell.exec → hermes
// kanban --board <slug> <verb>` so kanban_db.py owns the state
// machine (recompute_ready, link-cycle guard, task_events, notify
// subs) and herm can't drift from the CLI/dashboard.
//
//   [/]  board            Space collapse         b  new board
//   ←→↑↓ nav              Enter detail           Esc close pane
//   n/N  create/child     a  assign              c  comment
//   u    unblock          d  archive             l  worker log
//   D    dispatch         r  reload

type Sh = { stdout: string; stderr: string; code: number }

// Column scrollbars hidden — the column border + ↑↓ are enough
// signal at kanban card density; the bar steals a col per status.
// Hoisted so `!==` in the host reconciler's setProperty bails.
const NOBAR = { visible: false } as const

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
  slug: string; status: Status; tasks: Task[]; on: boolean; sel: number
  onPick: (i: number) => void
}) => {
  const theme = useTheme().theme
  const box = useRef<ScrollBoxRenderable | null>(null)
  const id = (i: number) => `kb-${p.slug}-${p.status}-${i}`
  // Keep the selected card in view. Fires on ↑↓ and on ←→ (p.on flips
  // true) so entering a column that was previously scrolled away snaps
  // to row 0. No-op while this column isn't active.
  useEffect(() => {
    if (p.on && p.tasks.length > 0) box.current?.scrollChildIntoView(id(p.sel))
  }, [p.on, p.sel, p.tasks.length])
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
      <scrollbox ref={box} scrollY flexGrow={1} verticalScrollbarOptions={NOBAR}>
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

type ColSpec = { status: Status; tasks: Task[] }
type Section = { board: Board; cols: ColSpec[]; total: number; running: number; cap: number }

type Pane = { kind: "detail"; slug: string; d: Detail } | { kind: "log"; slug: string; id: string; text: string }

const SidePane = memo((p: { pane: Pane }) => {
  const { theme, syntaxStyle } = useTheme()
  if (p.pane.kind === "log") return (
    <box flexDirection="column" padding={1} border borderColor={theme.border}
         backgroundColor={theme.backgroundPanel} width="50%">
      <box height={1}><text>
        <span fg={theme.primary}><strong>{p.pane.id}</strong></span>
        <span fg={theme.textMuted}>{`  ·  ${p.pane.slug}  ·  worker log (tail)`}</span>
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
          <span fg={theme.textMuted}>{`  ·  ${p.pane.slug}  ·  ${d.status}  ·  ${ago(d.updated_at)}`}</span>
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

  const [boards, setBoards] = useState<Board[]>(listBoards)
  const [data, setData] = useState<Map<string, Map<Status, Task[]>>>(
    () => new Map(boards.map(b => [b.slug, boardOf(b.slug)])),
  )
  const [at, setAt] = useState<string>(currentBoard)
  const [open, setOpen] = useState<Set<string>>(() => {
    const init = currentBoard()
    return new Set(listBoards()
      .filter(b => b.slug === init
        || [...boardOf(b.slug).values()].some(v => v.length > 0))
      .map(b => b.slug))
  })
  const [col, setCol] = useState(0)
  const [row, setRow] = useState(0)
  const [pane, setPane] = useState<Pane | null>(null)

  const outer = useRef<ScrollBoxRenderable | null>(null)

  const load = useCallback(() => {
    const bs = listBoards()
    setBoards(bs)
    setData(new Map(bs.map(b => [b.slug, boardOf(b.slug)])))
    setPane(p => p?.kind === "detail"
      ? (d => d ? { ...p, d } : null)(detailOf(p.slug, p.d.id)) : p)
  }, [])
  useEffect(load, [load])

  const wide = dims.width >= 160
  // Per-section column height cap. Short boards shrink to content;
  // tall boards stop at `max` and scroll inside the column. `max` is
  // the vertical budget left after TabShell chrome so a single open
  // board can fill the tab, but multiple boards still stack (the
  // outer scrollbox handles overflow). 3 = column border(2)+header.
  const max = Math.max(8, dims.height - 14)
  const sections = useMemo<Section[]>(() => boards.map(b => {
    const d = data.get(b.slug) ?? new Map<Status, Task[]>()
    const all = STATUSES.map(s => ({ status: s, tasks: d.get(s) ?? [] }))
    const total = all.reduce((a, c) => a + c.tasks.length, 0)
    const cols = wide || total === 0 ? all : all.filter(c => c.tasks.length > 0)
    const tall = all.reduce((a, c) => Math.max(a, c.tasks.length), 0)
    return {
      board: b, cols, total,
      running: d.get("running")?.length ?? 0,
      cap: Math.min(max, Math.max(5, 3 + 2 * tall)),
    }
  }), [boards, data, wide, max])

  const secOf = (s: string) => sections.find(x => x.board.slug === s)
  const sec = secOf(at) ?? sections[0]
  const cols = sec?.cols ?? []
  const cur = cols[Math.min(col, Math.max(0, cols.length - 1))]
  const task = cur?.tasks[Math.min(row, Math.max(0, (cur?.tasks.length ?? 1) - 1))]

  const grand = sections.reduce((a, s) => a + s.total, 0)
  const running = sections.reduce((a, s) => a + s.running, 0)

  // Cheap live-ish refresh while focused AND something is running.
  useEffect(() => {
    if (!props.focused || running === 0) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [props.focused, running, load])

  // Bring the active section into view on board switch or expand.
  useEffect(() => {
    outer.current?.scrollChildIntoView(`kb-sec-${at}`)
  }, [at, open])

  // `shell.exec → hermes kanban --board <at> <verb>`. --board pins
  // every write to the section the cursor is on, so a concurrent
  // `hermes kanban boards switch` in another shell can't redirect
  // herm's writes. Non-zero → toast the CLI's own stderr.
  const sh = useCallback((argv: string, ok?: string) =>
    gw.request<Sh>("shell.exec", { command: `hermes kanban --board ${q(at)} ${argv}` }).then(r => {
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
      if (ok) toast.show({ variant: "success", message: ok })
      load()
      return r.stdout
    }).catch((e: Error) => void toast.show({ variant: "error", message: trunc(e.message, 120) })),
  [gw, toast, load, at])

  const goto = useCallback((s: string) => {
    setAt(s); setCol(0); setRow(0)
    setOpen(o => o.has(s) ? o : new Set(o).add(s))
  }, [])

  const toggle = useCallback((s: string) =>
    setOpen(o => {
      const n = new Set(o)
      n.has(s) ? n.delete(s) : n.add(s)
      return n
    }), [])

  const newBoard = useCallback(() =>
    openTextPrompt(dialog, { title: "New board", label: "Slug (a-z, 0-9, -_)" })
      .then(v => {
        if (!v) return
        return gw.request<Sh>("shell.exec",
            { command: `hermes kanban boards create ${q(v)}` })
          .then(r => r.code === 0
            ? (toast.show({ variant: "success", message: `Board '${v}' created` }),
               resetKanban(), load(), goto(v))
            : Promise.reject(new Error((r.stderr || r.stdout).trim())))
          .catch((e: Error) => toast.show({ variant: "error", message: trunc(e.message, 120) }))
      }),
  [dialog, gw, toast, load, goto])

  // ── Actions ────────────────────────────────────────────────────────

  const live = useRef({ task, at })
  live.current = { task, at }

  const create = useCallback((parent?: Task) =>
    openCreateTask(dialog, {
      assignees: assignees(live.current.at),
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
      ...assignees(live.current.at).map(n => ({ title: n, value: n }))]
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
    const ready = secOf(live.current.at)?.cols
      .find(c => c.status === "ready")?.tasks.length ?? 0
    if (ready === 0)
      return void toast.show({ variant: "info", message: `No 'ready' tasks on ${live.current.at}` })
    return openConfirm(dialog, {
      title: `Dispatch · ${live.current.at}`,
      body: `${ready} task${ready === 1 ? "" : "s"} in 'ready'. Spawns one worker per task (one pass).`,
      yes: "dispatch",
    }).then(ok => { if (ok) void sh("dispatch --json", `Dispatched (${ready} ready)`) })
  }, [dialog, sh, toast, sections])

  const showLog = useCallback((t: Task) => {
    const s = live.current.at
    const text = tailLogOf(s, t.id)
    if (text == null)
      return void toast.show({ variant: "info", message: `No worker log for ${t.id}` })
    setPane({ kind: "log", slug: s, id: t.id, text })
  }, [toast])

  type Act = { key: string; title: string; when: (t?: Task) => boolean; run: (t?: Task) => void }
  const ACTS = useMemo<Act[]>(() => [
    { key: "n", title: "New task",      when: () => true,            run: () => void create() },
    { key: "N", title: "New child",     when: t => !!t,              run: t => void create(t) },
    { key: "a", title: "Assign",        when: t => !!t,              run: t => void assign(t!) },
    { key: "c", title: "Comment",       when: t => !!t,              run: t => void comment(t!) },
    { key: "u", title: "Unblock",       when: t => t?.status === "blocked", run: t => void unblock(t!) },
    { key: "d", title: "Archive",       when: t => !!t,              run: t => void archive(t!) },
    { key: "l", title: "Worker log",    when: t => !!t,              run: t => showLog(t!) },
    { key: "b", title: "New board",     when: () => true,            run: () => void newBoard() },
    { key: "D", title: "Dispatch",      when: () => true,            run: () => void dispatch() },
  ], [create, assign, comment, unblock, archive, showLog, newBoard, dispatch])

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (key.name === "escape" && pane) return setPane(null)
    if (keys.match("list.refresh", key)) return load()
    if (key.raw === "[" || key.raw === "]") {
      const i = sections.findIndex(s => s.board.slug === at)
      const n = (i + (key.raw === "]" ? 1 : -1) + sections.length) % sections.length
      return goto(sections[n].board.slug)
    }
    if (key.name === "space" || key.name === " ") return toggle(at)
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
        ? null : (d => d ? { kind: "detail", slug: at, d } : null)(detailOf(at, task.id)))
    const t = live.current.task
    const hit = ACTS.find(a => a.key === key.raw && a.when(t))
    if (hit) return hit.run(t)
  })

  const hint = useMemo(() => {
    const t = task
    return ["[/] board", "←→↑↓ nav", "Space fold", "Enter detail",
      ...ACTS.filter(a => a.when(t)).map(a => `${a.key} ${a.title.toLowerCase()}`),
      "r reload"].join("  ")
  }, [ACTS, task])

  // Stable callbacks keyed by slug so Section memo bails.
  const onHead = useCallback((s: string) => { toggle(s); setAt(s) }, [toggle])
  const onPick = useCallback((s: string, c: number, r: number, id: string) => {
    if (s !== at) setAt(s)
    setCol(c); setRow(r)
    setOpen(o => o.has(s) ? o : new Set(o).add(s))
    const d = detailOf(s, id)
    if (d) setPane({ kind: "detail", slug: s, d })
  }, [at])

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={`Kanban · ${sections.length} board${sections.length === 1 ? "" : "s"} · ${grand} task${grand === 1 ? "" : "s"}${running ? ` · ${running} running` : ""}`}
        hint={hint}
      >
        <scrollbox ref={outer} scrollY flexGrow={1} verticalScrollbarOptions={NOBAR}>
          <box flexDirection="column" width="100%">
            {sections.map(s => {
              const on = s.board.slug === at
              const isOpen = open.has(s.board.slug)
              return (
                <box key={s.board.slug} id={`kb-sec-${s.board.slug}`}
                     flexDirection="column" flexShrink={0} marginBottom={1}>
                  <box height={1} onMouseDown={() => onHead(s.board.slug)}>
                    <text>
                      <span fg={on ? theme.accent : theme.textMuted}>{isOpen ? "▾ " : "▸ "}</span>
                      <span fg={on ? theme.primary : theme.text}><strong>{s.board.name}</strong></span>
                      <span fg={theme.textMuted}>
                        {s.total === 0 ? "  ·  empty"
                          : `  ·  ${s.total} task${s.total === 1 ? "" : "s"}${s.running ? ` · ${s.running} running` : ""}`}
                      </span>
                    </text>
                  </box>
                  {isOpen ? (
                    s.total === 0 ? (
                      <box height={1} marginLeft={2}>
                        <text fg={theme.textMuted}>
                          no tasks — <span fg={theme.accent}>n</span> to create one here
                        </text>
                      </box>
                    ) : (
                      <box flexDirection="row" height={s.cap} gap={1}>
                        {s.cols.map((c, ci) => (
                          <Column key={c.status} slug={s.board.slug} status={c.status}
                                  tasks={c.tasks}
                                  on={on && ci === Math.min(col, s.cols.length - 1)}
                                  sel={on ? row : 0}
                                  onPick={ri => onPick(s.board.slug, ci, ri, c.tasks[ri].id)} />
                        ))}
                      </box>
                    )
                  ) : null}
                </box>
              )
            })}
          </box>
        </scrollbox>
      </TabShell>
      {pane ? <SidePane pane={pane} /> : null}
    </box>
  )
})
