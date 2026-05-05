import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { RGBA, type ScrollBoxRenderable } from "@opentui/core"
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
// owns the state machine (recompute_ready, link-cycle guard,
// task_events, notify subs) and herm can't drift.
//
// Focus model — one cursor, three tiers per board:
//   head    the ▾/▸ line            Space folds the board
//   filter  chip bar                ←→ chip, Space toggles
//   grid    columns × rows          ←→ col, ↑↓ row
// Tab/Shift+Tab walk boards (head of next/prev). ↑↓ step between
// tiers when at an edge; Space is context-sensitive.
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

const HEAD: Record<Status, string> = {
  triage: "triage", todo: "todo", ready: "ready",
  running: "running", blocked: "blocked", done: "done",
}

// ── Filter chips ────────────────────────────────────────────────────
// A chip is either an assignee name present on the board or a
// priority bucket. Active chips OR within a group and AND between
// groups: {builder, reviewer} ∩ {P3}. A group with zero active chips
// passes everything (the common case).

type Chip = { kind: "who"; v: string } | { kind: "pri"; v: number }
type Mask = { who: Set<string>; pri: Set<number> }

const chipId = (c: Chip) => c.kind === "who" ? `who:${c.v}` : `pri:${c.v}`
const chipLabel = (c: Chip) => c.kind === "who" ? c.v : `P${c.v}`
const pass = (t: Task, m: Mask) =>
  (m.who.size === 0 || (t.assignee != null && m.who.has(t.assignee)))
  && (m.pri.size === 0 || m.pri.has(t.priority))

/** Halfway between two theme tokens — used for the zebra stripe so
 *  odd rows sit visibly between `backgroundPanel` (even) and
 *  `backgroundElement` (selection) on every theme, light or dark. */
const mix = (a: RGBA, b: RGBA, t: number) =>
  RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)

// ── Card ────────────────────────────────────────────────────────────
// One-line: title only, zebra-striped. The selected/hovered card
// marquees via <Ticker> when the title overflows; inactive cards
// truncate with wrapMode="none" (no `…` so the marquee and static
// row show the same leading text).

const Card = memo((p: {
  id: string; t: Task; on: boolean; odd: boolean; stripe: RGBA
  onPick: () => void; onHover: () => void
}) => {
  const theme = useTheme().theme
  const [hov, setHov] = useState(false)
  const fg = p.on ? theme.accent : theme.text
  const bg = p.on ? theme.backgroundElement : p.odd ? p.stripe : undefined
  return (
    <box id={p.id} height={1} flexDirection="row" paddingLeft={1}
         backgroundColor={bg}
         onMouseDown={p.onPick}
         onMouseMove={() => { if (!hov) { setHov(true); p.onHover() } }}
         onMouseOut={() => setHov(false)}>
      {p.on || hov
        ? <Ticker active fg={fg}>{p.t.title}</Ticker>
        : <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
            <text wrapMode="none" fg={fg}>{p.t.title}</text>
          </box>}
    </box>
  )
})

const Column = memo((p: {
  slug: string; status: Status; tasks: Task[]; on: boolean; sel: number
  stripe: RGBA; onPick: (i: number) => void; onHover: (i: number) => void
}) => {
  const theme = useTheme().theme
  const box = useRef<ScrollBoxRenderable | null>(null)
  const id = (i: number) => `kb-${p.slug}-${p.status}-${i}`
  // Keep the selected card in view. Fires on ↑↓ and when ←→ moves
  // focus onto this column (p.on flips true) so a column previously
  // scrolled away snaps to row 0.
  useEffect(() => {
    if (p.on && p.tasks.length > 0) box.current?.scrollChildIntoView(id(p.sel))
  }, [p.on, p.sel, p.tasks.length])
  const tint = p.status === "blocked" ? theme.warning
    : p.status === "running" ? theme.success
    : p.status === "done" ? theme.textMuted : theme.primary
  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={18}
         border borderColor={p.on ? theme.primary : theme.border}>
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
                  odd={i % 2 === 1} stripe={p.stripe}
                  onPick={() => p.onPick(i)} onHover={() => p.onHover(i)} />
          ))}
        </box>
      </scrollbox>
    </box>
  )
})

const FilterBar = memo((p: {
  chips: Chip[]; mask: Mask; on: boolean; sel: number
  onPick: (i: number) => void
}) => {
  const theme = useTheme().theme
  return (
    <box height={1} flexDirection="row" flexWrap="no-wrap" overflow="hidden"
         marginBottom={p.chips.length > 0 ? 1 : 0}>
      {p.chips.map((c, i) => {
        const on = c.kind === "who" ? p.mask.who.has(c.v) : p.mask.pri.has(c.v)
        const cur = p.on && i === p.sel
        return (
          <box key={chipId(c)} height={1} flexShrink={0} marginRight={1}
               paddingLeft={1} paddingRight={1}
               backgroundColor={on ? theme.accent : cur ? theme.backgroundElement : undefined}
               onMouseDown={() => p.onPick(i)}>
            <text fg={on ? theme.background : cur ? theme.accent : theme.textMuted}>
              {chipLabel(c)}
            </text>
          </box>
        )
      })}
    </box>
  )
})

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

  const stripe = useMemo(
    () => mix(theme.backgroundPanel, theme.backgroundElement, 0.5),
    [theme])

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

  const maskOf = (s: string): Mask =>
    masks.get(s) ?? { who: new Set(), pri: new Set() }

  const wide = dims.width >= 160
  // Per-section column height cap. 3 = column border(2)+header. A
  // single open board can fill the tab; with several open, the outer
  // scrollbox handles overflow.
  const maxH = Math.max(8, dims.height - 16)
  const sections = useMemo<Section[]>(() => {
    const built = boards.map(b => {
      const d = data.get(b.slug) ?? new Map<Status, Task[]>()
      const flat = STATUSES.flatMap(s => d.get(s) ?? [])
      const total = flat.length
      // Chips: only assignees actually present on this board; only
      // priority buckets actually present. An empty chip row hides.
      const who = [...new Set(flat.map(t => t.assignee).filter((a): a is string => !!a))].sort()
      const pri = [...new Set(flat.map(t => t.priority).filter(n => n > 0))].sort((a, z) => z - a)
      const chips: Chip[] = [
        ...who.map(v => ({ kind: "who", v } as const)),
        ...pri.map(v => ({ kind: "pri", v } as const)),
      ]
      const m = maskOf(b.slug)
      const masked = STATUSES.map(s => ({ status: s, tasks: (d.get(s) ?? []).filter(t => pass(t, m)) }))
      const shown = masked.reduce((a, c) => a + c.tasks.length, 0)
      const cols = wide || shown === 0 ? masked : masked.filter(c => c.tasks.length > 0)
      const tall = masked.reduce((a, c) => Math.max(a, c.tasks.length), 0)
      return {
        board: b, cols, chips, total, shown,
        running: d.get("running")?.length ?? 0,
        cap: Math.min(maxH, Math.max(5, 3 + tall)),
      }
    })
    // Non-empty boards first, then empties; each group keeps the
    // listBoards() order (default → alpha). Stable partition so
    // Tab order doesn't reshuffle when a board transiently empties
    // during a refresh — only changes on a real total flip.
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

  useEffect(() => {
    if (!props.focused || running === 0) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [props.focused, running, load])

  useEffect(() => {
    outer.current?.scrollChildIntoView(`kb-sec-${at}`)
  }, [at, open])

  // `shell.exec → hermes kanban --board <at> <verb>`. --board pins
  // every write to the section the cursor is on.
  const sh = useCallback((argv: string, ok?: string) =>
    gw.request<Sh>("shell.exec", { command: `hermes kanban --board ${q(at)} ${argv}` }).then(r => {
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
      if (ok) toast.show({ variant: "success", message: ok })
      load()
      return r.stdout
    }).catch((e: Error) => void toast.show({ variant: "error", message: trunc(e.message, 120) })),
  [gw, toast, load, at])

  // Tab/Shift+Tab land on the *head* of the target board and expand
  // it. Landing on the head (not the grid) means the first ↓ after a
  // Tab descends into filter → grid — a 2D path that reads as "step
  // into this board" rather than teleporting to an arbitrary cell.
  const goBoard = useCallback((d: 1 | -1) => {
    const n = (idx + d + sections.length) % sections.length
    const s = sections[n].board.slug
    setAt(s); setTier("head"); setCol(0); setRow(0); setChip(0)
    setOpen(o => o.has(s) ? o : new Set(o).add(s))
  }, [idx, sections])

  const flip = useCallback((c: Chip) =>
    setMasks(m => {
      const cur = m.get(at) ?? { who: new Set<string>(), pri: new Set<number>() }
      const who = new Set(cur.who), pri = new Set(cur.pri)
      if (c.kind === "who") who.has(c.v) ? who.delete(c.v) : who.add(c.v)
      else pri.has(c.v) ? pri.delete(c.v) : pri.add(c.v)
      const next = new Map(m)
      next.set(at, { who, pri })
      setRow(0)
      return next
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

  // ↑↓ tier walk. `down` from head skips filter when there are no
  // chips; `down` past the last row does nothing (the next board is
  // Tab's job, not ↓'s — keeps column scroll and board nav on
  // separate muscles).
  const hasChips = (sec?.chips.length ?? 0) > 0
  const upTier = () => {
    if (tier === "grid") return row > 0 ? setRow(r => r - 1)
      : setTier(hasChips ? "filter" : "head")
    if (tier === "filter") return setTier("head")
  }
  const downTier = () => {
    if (tier === "head") return setTier(hasChips ? "filter" : "grid")
    if (tier === "filter") { setTier("grid"); setRow(0); return }
    return setRow(r => Math.min((cur?.tasks.length ?? 1) - 1, r + 1))
  }

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (key.name === "escape" && pane) return setPane(null)
    if (keys.match("list.refresh", key)) return load()
    // Shell's double-Tab-to-composer sees both taps first (global
    // listeners, mount order). We only get singles that weren't the
    // second tap of a pair — exactly the ones that should walk
    // boards. No stopPropagation: shell needs to observe the tap to
    // arm its window.
    if (key.name === "tab") return goBoard(key.shift ? -1 : 1)
    if (key.name === "space" || key.name === " ") {
      if (tier === "head") return toggle(at)
      if (tier === "filter" && sec?.chips[chip]) return flip(sec.chips[chip])
      return
    }
    if (key.name === "up") return upTier()
    if (key.name === "down") return downTier()
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
    const nav = tier === "head" ? "Space fold"
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
  const onHover = useCallback((s: string, ci: number, ri: number) => {
    setAt(s); setTier("grid"); setCol(ci); setRow(ri)
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
              const isOpen = open.has(s.board.slug)
              const m = maskOf(s.board.slug)
              const filt = m.who.size + m.pri.size
              return (
                <box key={s.board.slug} id={`kb-sec-${s.board.slug}`}
                     flexDirection="column" flexShrink={0} marginBottom={1}>
                  <box height={1} onMouseDown={() => onHead(s.board.slug)}
                       backgroundColor={on && tier === "head" ? theme.backgroundElement : undefined}>
                    <text>
                      <span fg={on ? theme.accent : theme.textMuted}>{isOpen ? "▾ " : "▸ "}</span>
                      <span fg={on ? theme.primary : theme.text}><strong>{s.board.name}</strong></span>
                      <span fg={theme.textMuted}>
                        {s.total === 0 ? "  ·  empty"
                          : `  ·  ${filt ? `${s.shown}/` : ""}${s.total} task${s.total === 1 ? "" : "s"}${s.running ? ` · ${s.running} running` : ""}`}
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
                      <>
                        {s.chips.length > 0 ? (
                          <FilterBar chips={s.chips} mask={m}
                            on={on && tier === "filter"}
                            sel={on ? Math.min(chip, s.chips.length - 1) : -1}
                            onPick={i => onChip(s.board.slug, i, s.chips[i])} />
                        ) : null}
                        <box flexDirection="row" height={s.cap} gap={1}>
                          {s.cols.map((c, ci) => (
                            <Column key={c.status} slug={s.board.slug} status={c.status}
                                    tasks={c.tasks} stripe={stripe}
                                    on={on && tier === "grid" && ci === clampCol}
                                    sel={on ? row : 0}
                                    onHover={ri => onHover(s.board.slug, ci, ri)}
                                    onPick={ri => onPick(s.board.slug, ci, ri, c.tasks[ri].id)} />
                          ))}
                        </box>
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
