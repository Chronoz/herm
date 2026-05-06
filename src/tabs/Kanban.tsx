import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { BorderSides, ScrollBoxRenderable } from "@opentui/core"
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
import { Ticker } from "../ui/ticker"
import { FilterChip, cycle, type Tri } from "../ui/filter-chip"
import { openConfirm } from "../dialogs/confirm"
import { openTextPrompt } from "../dialogs/text-prompt"
import { openCreateTask } from "../dialogs/new-task"
import { TabShell } from "../ui/shell"
import { KVBlock } from "../ui/kv"
import { ago, trunc } from "../ui/fmt"

// Operator surface for every kanban board under ~/.hermes/.
//
// Boards stack vertically; each is a collapsible section (▾/▸
// header + filter-chip bar + capped-height row of status columns).
// Reads are sidecar SQLite per board. Every write routes through
// `shell.exec → hermes kanban --board <slug> <verb>` so kanban_db.py
// owns the state machine.
//
// Focus model — one cursor, three tiers per board:
//   head    the ▾/▸ line            Space folds the board
//   filter  chip bar                ←→ chip, Space toggles
//   grid    columns × rows          ←→ col, ↑↓ row
// ↑↓ walk the whole vertical stack — head → filter → every row →
// next board's head → … — so holding ↓ reads top-to-bottom across
// all boards. Tab/⇧Tab is the accelerator: jump straight to the
// next/prev board's head without stepping through rows.
//
//   Tab/⇧Tab board        ←→↑↓ nav            Enter detail
//   Space    fold / chip  Esc close pane      r reload
//   n/N      create/child a assign            c comment
//   u        unblock      d archive           l worker log
//   D        dispatch     b new board

type Sh = { stdout: string; stderr: string; code: number }
type Tier = "head" | "filter" | "grid"

// Column scrollbars hidden — the column border + ↑↓ are enough
// signal at kanban card density; the bar steals a col per status.
const NOBAR = { visible: false } as const
const RULE: BorderSides[] = ["bottom"]

const HEAD: Record<Status, string> = {
  triage: "triage", todo: "todo", ready: "ready",
  running: "running", blocked: "blocked", done: "done",
}

// ── Filter chips ────────────────────────────────────────────────────
// Each chip cycles off → include → exclude → off. Per-group
// semantics: a group with no `in` chips passes everything not
// `ex`'d; once any chip is `in`, the group passes ONLY `in` values
// (minus `ex`'d — though in/ex are mutually exclusive per chip, so
// that edge is moot). Same machinery for who/pri/status — status
// `ex` additionally drops the column itself.

type Chip =
  | { kind: "who"; v: string }
  | { kind: "pri"; v: number }
  | { kind: "status"; v: Status }
type Mask = {
  who: Map<string, Tri>; pri: Map<number, Tri>; status: Map<Status, Tri>
}

const EMPTY: Mask = { who: new Map(), pri: new Map(), status: new Map() }

const chipId = (c: Chip) =>
  c.kind === "who" ? `who:${c.v}` : c.kind === "pri" ? `pri:${c.v}` : `st:${c.v}`
const chipLabel = (c: Chip) =>
  c.kind === "who" ? c.v : c.kind === "pri" ? `P${c.v}` : HEAD[c.v]
const triOf = (c: Chip, m: Mask): Tri =>
  c.kind === "who" ? m.who.get(c.v) ?? "off"
  : c.kind === "pri" ? m.pri.get(c.v) ?? "off"
  : m.status.get(c.v) ?? "off"

/** True when `v` survives the group. Absence ⇒ "off". */
function admits<V>(g: Map<V, Tri>, v: V): boolean {
  const t = g.get(v)
  if (t === "ex") return false
  if (t === "in") return true
  for (const s of g.values()) if (s === "in") return false
  return true
}
const pass = (t: Task, m: Mask) =>
  admits(m.who, t.assignee ?? null as unknown as string)
  && admits(m.pri, t.priority)

// ── Card ────────────────────────────────────────────────────────────
// Title + bottom rule. The Ticker is always mounted; `active` gates
// its interval. This avoids the conditional-mount path where the
// inner renderable is swapped while the mouse is over it — OpenTUI's
// last-hovered tracking could miss the stale element's onMouseOut,
// leaving a row marqueeing after the pointer left.

const Card = memo((p: {
  id: string; t: Task; on: boolean; hov: boolean
  onHover: () => void; onPick: () => void
}) => {
  const theme = useTheme().theme
  return (
    <box id={p.id} height={2} flexDirection="row" paddingLeft={1}
         border={RULE} borderStyle="single" borderColor={theme.borderSubtle}
         backgroundColor={p.on ? theme.backgroundElement : undefined}
         onMouseDown={p.onPick}
         onMouseMove={p.onHover}>
      <Ticker active={p.on || p.hov} fg={p.on ? theme.accent : theme.text}>
        {p.t.title}
      </Ticker>
    </box>
  )
})

const Column = memo((p: {
  slug: string; status: Status; tasks: Task[]; on: boolean; sel: number
  onPick: (i: number) => void
}) => {
  const theme = useTheme().theme
  const box = useRef<ScrollBoxRenderable | null>(null)
  // Column-level hover index. Lifting it here (instead of per-card
  // local state) means only ONE card can read hov=true at a time,
  // and the column's onMouseOut reliably clears it when the pointer
  // leaves the column — covering the case where a fast exit skips
  // the old card's own out event.
  const [hov, setHov] = useState(-1)
  const id = (i: number) => `kb-${p.slug}-${p.status}-${i}`
  useEffect(() => {
    if (p.on && p.tasks.length > 0) box.current?.scrollChildIntoView(id(p.sel))
  }, [p.on, p.sel, p.tasks.length])
  const tint = p.status === "blocked" ? theme.warning
    : p.status === "running" ? theme.success
    : p.status === "done" ? theme.textMuted : theme.primary
  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={18}
         border borderColor={p.on ? theme.primary : theme.border}
         onMouseOut={() => setHov(-1)}>
      <box height={1} paddingLeft={1}>
        <text>
          <span fg={tint}><strong>{HEAD[p.status]}</strong></span>
          <span fg={theme.textMuted}>{`  ${p.tasks.length}`}</span>
        </text>
      </box>
      <scrollbox ref={box} scrollY flexGrow={1} verticalScrollbarOptions={NOBAR}>
        <box flexDirection="column" width="100%">
          {p.tasks.map((t, i) => (
            <Card key={t.id} id={id(i)} t={t} on={p.on && i === p.sel}
                  hov={i === hov}
                  onHover={() => { if (hov !== i) setHov(i) }}
                  onPick={() => p.onPick(i)} />
          ))}
        </box>
      </scrollbox>
    </box>
  )
})

const FilterBar = memo((p: {
  chips: Chip[]; mask: Mask; on: boolean; sel: number
  onPick: (i: number) => void
}) => (
  <box height={1} flexDirection="row" flexWrap="no-wrap" overflow="hidden" marginBottom={1}>
    {p.chips.map((c, i) => (
      <FilterChip key={chipId(c)} label={chipLabel(c)}
        state={triOf(c, p.mask)} selected={p.on && i === p.sel}
        gap={i > 0 && p.chips[i - 1].kind !== c.kind ? 3 : 1}
        onMouseDown={() => p.onPick(i)} />
    ))}
  </box>
))

type ColSpec = { status: Status; tasks: Task[] }
type Section = {
  board: Board; cols: ColSpec[]; chips: Chip[]
  total: number; shown: number; running: number; cap: number
}

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
  const [masks, setMasks] = useState<Map<string, Mask>>(() => new Map())
  const [open, setOpen] = useState<Set<string>>(() => {
    const init = currentBoard()
    return new Set(listBoards()
      .filter(b => b.slug === init
        || [...boardOf(b.slug).values()].some(v => v.length > 0))
      .map(b => b.slug))
  })
  const [at, setAt] = useState<string>(currentBoard)
  const [tier, setTier] = useState<Tier>("grid")
  const [col, setCol] = useState(0)
  const [row, setRow] = useState(0)
  const [chip, setChip] = useState(0)
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

  const maskOf = (s: string): Mask => masks.get(s) ?? EMPTY

  const wide = dims.width >= 160
  // Per-section column height cap. 3 = column border(2)+header,
  // 2 per card (title + bottom rule).
  const maxH = Math.max(8, dims.height - 16)
  const sections = useMemo<Section[]>(() => {
    const built = boards.map(b => {
      const d = data.get(b.slug) ?? new Map<Status, Task[]>()
      const flat = STATUSES.flatMap(s => d.get(s) ?? [])
      const total = flat.length
      const who = [...new Set(flat.map(t => t.assignee).filter((v): v is string => !!v))].sort()
      const pri = [...new Set(flat.map(t => t.priority).filter(n => n > 0))].sort((a, z) => z - a)
      const chips: Chip[] = [
        ...who.map(v => ({ kind: "who", v } as const)),
        ...pri.map(v => ({ kind: "pri", v } as const)),
        ...STATUSES.map(v => ({ kind: "status", v } as const)),
      ]
      const m = maskOf(b.slug)
      const cols = STATUSES
        .filter(s => admits(m.status, s))
        .map(s => ({ status: s, tasks: (d.get(s) ?? []).filter(t => pass(t, m)) }))
        .filter(c => wide || c.tasks.length > 0)
      const shown = cols.reduce((a, c) => a + c.tasks.length, 0)
      const tall = cols.reduce((a, c) => Math.max(a, c.tasks.length), 0)
      return {
        board: b, cols, chips, total, shown,
        running: d.get("running")?.length ?? 0,
        cap: Math.min(maxH, Math.max(5, 3 + 2 * tall)),
      }
    })
    // Non-empty boards first; empties sink. Stable partition so Tab
    // order doesn't reshuffle on a transient refresh-to-zero.
    return [...built.filter(s => s.total > 0), ...built.filter(s => s.total === 0)]
  }, [boards, data, masks, wide, maxH])

  const idx = sections.findIndex(s => s.board.slug === at)
  const sec = sections[idx] ?? sections[0]
  const cols = sec?.cols ?? []
  const clampCol = Math.min(col, Math.max(0, cols.length - 1))
  const cur = cols[clampCol]
  const task = tier === "grid"
    ? cur?.tasks[Math.min(row, Math.max(0, (cur?.tasks.length ?? 1) - 1))]
    : undefined

  const grand = sections.reduce((a, s) => a + s.total, 0)
  const running = sections.reduce((a, s) => a + s.running, 0)

  // Detail pane follows the grid cursor while open. Enter still
  // toggles it; once open, ←→↑↓ rehydrate it to whatever is under
  // the cursor so the side pane reads as a live inspector instead
  // of a pinned snapshot. Leaving the grid tier closes it — there's
  // nothing sensible to show for head/filter.
  useEffect(() => {
    if (pane?.kind !== "detail") return
    if (!task) { setPane(null); return }
    if (pane.slug === at && pane.d.id === task.id) return
    const d = detailOf(at, task.id)
    setPane(d ? { kind: "detail", slug: at, d } : null)
  }, [task?.id, at, tier])

  useEffect(() => {
    if (!props.focused || running === 0) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [props.focused, running, load])

  useEffect(() => {
    outer.current?.scrollChildIntoView(`kb-sec-${at}`)
  }, [at, open])

  const sh = useCallback((argv: string, ok?: string) =>
    gw.request<Sh>("shell.exec", { command: `hermes kanban --board ${q(at)} ${argv}` }).then(r => {
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
      if (ok) toast.show({ variant: "success", message: ok })
      load()
      return r.stdout
    }).catch((e: Error) => void toast.show({ variant: "error", message: trunc(e.message, 120) })),
  [gw, toast, load, at])

  // ── Cross-board nav ───────────────────────────────────────────────
  // enterTop/enterBottom land on the first/last reachable tier of
  // the target section so ↑↓ read as one continuous vertical walk.
  // Tab always lands at head (it's the "skip past this board"
  // gesture, not the "continue scrolling" one).

  const enterTop = (s: Section) => {
    setAt(s.board.slug); setTier("head"); setChip(0); setRow(0)
  }
  const enterBottom = (s: Section) => {
    setAt(s.board.slug); setChip(Math.max(0, s.chips.length - 1))
    if (open.has(s.board.slug) && s.shown > 0) {
      const nc = Math.min(col, Math.max(0, s.cols.length - 1))
      setTier("grid"); setCol(nc)
      setRow(Math.max(0, (s.cols[nc]?.tasks.length ?? 1) - 1))
      return
    }
    if (open.has(s.board.slug)) { setTier("filter"); return }
    setTier("head")
  }
  const stepBoard = (d: 1 | -1): Section | null => {
    const n = idx + d
    return n < 0 || n >= sections.length ? null : sections[n]
  }
  const goBoard = useCallback((d: 1 | -1) => {
    const n = (idx + d + sections.length) % sections.length
    const s = sections[n]
    setAt(s.board.slug); setTier("head"); setCol(0); setRow(0); setChip(0)
    setOpen(o => o.has(s.board.slug) ? o : new Set(o).add(s.board.slug))
  }, [idx, sections])

  const flip = useCallback((c: Chip) =>
    setMasks(m => {
      const cur = m.get(at) ?? EMPTY
      const who = new Map(cur.who), pri = new Map(cur.pri), status = new Map(cur.status)
      const g = c.kind === "who" ? who : c.kind === "pri" ? pri : status
      const next = cycle((g as Map<unknown, Tri>).get(c.v) ?? "off")
      next === "off" ? (g as Map<unknown, Tri>).delete(c.v)
        : (g as Map<unknown, Tri>).set(c.v, next)
      const out = new Map(m); out.set(at, { who, pri, status })
      setRow(0)
      return out
    }), [at])

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
               resetKanban(), load(), setAt(v), setTier("head"))
            : Promise.reject(new Error((r.stderr || r.stdout).trim())))
          .catch((e: Error) => toast.show({ variant: "error", message: trunc(e.message, 120) }))
      }),
  [dialog, gw, toast, load])

  // ── Actions ────────────────────────────────────────────────────────

  const live = useRef({ task, at, sec })
  live.current = { task, at, sec }

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
    const ready = live.current.sec?.cols
      .find(c => c.status === "ready")?.tasks.length ?? 0
    if (ready === 0)
      return void toast.show({ variant: "info", message: `No 'ready' tasks on ${live.current.at}` })
    return openConfirm(dialog, {
      title: `Dispatch · ${live.current.at}`,
      body: `${ready} task${ready === 1 ? "" : "s"} in 'ready'. Spawns one worker per task (one pass).`,
      yes: "dispatch",
    }).then(ok => { if (ok) void sh("dispatch --json", `Dispatched (${ready} ready)`) })
  }, [dialog, sh, toast])

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

  const isOpen = open.has(at)

  useKeyboard((key) => {
    if (!props.focused || dialog.open()) return
    if (key.name === "escape" && pane) return setPane(null)
    if (keys.match("list.refresh", key)) return load()
    // Tab = jump. Shell's double-Tab-to-composer fires first (mount
    // order) and swallows the completing tap; singles land here.
    if (key.name === "tab") return goBoard(key.shift ? -1 : 1)
    if (key.name === "space" || key.name === " ") {
      if (tier === "head") return toggle(at)
      if (tier === "filter" && sec?.chips[chip]) return flip(sec.chips[chip])
      return
    }
    if (key.name === "down") {
      if (tier === "head") {
        if (isOpen) return setTier("filter")
        const n = stepBoard(1); return n ? enterTop(n) : undefined
      }
      if (tier === "filter") {
        if (sec && sec.shown > 0) { setTier("grid"); setRow(0); return }
        const n = stepBoard(1); return n ? enterTop(n) : undefined
      }
      if (row < (cur?.tasks.length ?? 1) - 1) return setRow(r => r + 1)
      const n = stepBoard(1); return n ? enterTop(n) : undefined
    }
    if (key.name === "up") {
      if (tier === "head") {
        const p = stepBoard(-1); return p ? enterBottom(p) : undefined
      }
      if (tier === "filter") return setTier("head")
      if (row > 0) return setRow(r => r - 1)
      return setTier("filter")
    }
    if (key.name === "left") {
      if (tier === "filter") return setChip(c => Math.max(0, c - 1))
      if (tier === "grid") return setCol(c => { const n = Math.max(0, c - 1); setRow(0); return n })
      return
    }
    if (key.name === "right") {
      if (tier === "filter") return setChip(c => Math.min((sec?.chips.length ?? 1) - 1, c + 1))
      if (tier === "grid") return setCol(c => { const n = Math.min(cols.length - 1, c + 1); setRow(0); return n })
      return
    }
    if (key.name === "return") {
      if (tier === "head") return toggle(at)
      if (tier === "filter" && sec?.chips[chip]) return flip(sec.chips[chip])
      if (task) return setPane(p => p?.kind === "detail" && p.d.id === task.id
        ? null : (d => d ? { kind: "detail", slug: at, d } : null)(detailOf(at, task.id)))
      return
    }
    const t = live.current.task
    const hit = ACTS.find(a => a.key === key.raw && a.when(t))
    if (hit) return hit.run(t)
  })

  const hint = useMemo(() => {
    const t = task
    const nav = tier === "head" ? "↑↓ nav  Space fold"
      : tier === "filter" ? "←→ chip  Space toggle"
      : "←→↑↓ nav  Enter detail"
    return ["Tab board", nav,
      ...ACTS.filter(a => a.when(t)).map(a => `${a.key} ${a.title.toLowerCase()}`),
      "r reload"].join("  ")
  }, [ACTS, task, tier])

  const onHead = useCallback((s: string) => {
    setAt(s); setTier("head"); toggle(s)
  }, [toggle])
  const onChip = useCallback((s: string, i: number, c: Chip) => {
    setAt(s); setTier("filter"); setChip(i); flip(c)
  }, [flip])
  const onPick = useCallback((s: string, ci: number, ri: number, id: string) => {
    setAt(s); setTier("grid"); setCol(ci); setRow(ri)
    setOpen(o => o.has(s) ? o : new Set(o).add(s))
    const d = detailOf(s, id)
    if (d) setPane({ kind: "detail", slug: s, d })
  }, [])

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
              const secOpen = open.has(s.board.slug)
              const m = maskOf(s.board.slug)
              const filt = m.who.size + m.pri.size + m.status.size
              return (
                <box key={s.board.slug} id={`kb-sec-${s.board.slug}`}
                     flexDirection="column" flexShrink={0} marginBottom={1}>
                  <box height={1} onMouseDown={() => onHead(s.board.slug)}
                       backgroundColor={on && tier === "head" ? theme.backgroundElement : undefined}>
                    <text>
                      <span fg={on ? theme.accent : theme.textMuted}>{secOpen ? "▾ " : "▸ "}</span>
                      <span fg={on ? theme.primary : theme.text}><strong>{s.board.name}</strong></span>
                      <span fg={theme.textMuted}>
                        {s.total === 0 ? "  ·  empty"
                          : `  ·  ${filt ? `${s.shown}/` : ""}${s.total} task${s.total === 1 ? "" : "s"}${s.running ? ` · ${s.running} running` : ""}`}
                      </span>
                    </text>
                  </box>
                  {secOpen ? (
                    s.total === 0 ? (
                      <box height={1} marginLeft={2}>
                        <text fg={theme.textMuted}>
                          no tasks — <span fg={theme.accent}>n</span> to create one here
                        </text>
                      </box>
                    ) : (
                      <>
                        <FilterBar chips={s.chips} mask={m}
                          on={on && tier === "filter"}
                          sel={on ? Math.min(chip, s.chips.length - 1) : -1}
                          onPick={i => onChip(s.board.slug, i, s.chips[i])} />
                        {s.cols.length > 0 ? (
                          <box flexDirection="row" height={s.cap} gap={1}>
                            {s.cols.map((c, ci) => (
                              <Column key={c.status} slug={s.board.slug} status={c.status}
                                      tasks={c.tasks}
                                      on={on && tier === "grid" && ci === clampCol}
                                      sel={on ? row : 0}
                                      onPick={ri => onPick(s.board.slug, ci, ri, c.tasks[ri].id)} />
                            ))}
                          </box>
                        ) : (
                          <box height={1} marginLeft={2}>
                            <text fg={theme.textMuted}>all columns hidden</text>
                          </box>
                        )}
                      </>
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
