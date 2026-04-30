import { useState, useEffect, useCallback, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeys, handleListKey } from "../keys"
import {
  queryRecentSessions, searchSessions, deleteSession, renameSession, querySubagents, queryLineage,
  type SessionRow, type SessionHit,
} from "../utils/hermes-home"
import type {
  SessionListItem, SessionListResponse,
} from "../utils/gateway-types"
import { useGateway } from "../app/gateway"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { KV, KVBlock } from "../ui/kv"
import { Col, Hdr, Marquee } from "../ui/table"
import { openConfirm } from "../dialogs/confirm"
import { openTextPrompt } from "../dialogs/text-prompt"
import { fmt, cost, trunc, ago, when, span } from "../ui/fmt"
import { home } from "../home"

// List comes from the gateway (session.list) so rows are resumable
// under profiles/remote gateways; detail is enriched best-effort from
// state.db. Search/delete go direct to state.db — stock tui_gateway
// has no session.search/.delete RPC (UPSTREAM.md).

type Row = SessionListItem & { detail?: SessionRow }

// ─── Formatting ──────────────────────────────────────────────────────

const badge = (src: string): string => ({
  cli: "CLI", tui: "TUI", api_server: "API", discord: "Discord",
  telegram: "Telegram", slack: "Slack", whatsapp: "WhatsApp", signal: "Signal",
} as Record<string, string>)[src] ?? src

// Today → 24h HH:MM; otherwise short date.
const stamp = (ts: number): string => {
  const d = new Date(ts * 1000)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// ─── Detail Panel ────────────────────────────────────────────────────
//
// Data provenance:
//   RPC (session.list): id, title, preview (first user msg), source,
//                       started_at, message_count
//   state.db enrich:    model, last_active, ended_at, end_reason,
//                       tokens, cost, tool_call_count, lastMessage
//
// `ended_at` is NULL for ~80% of rows — hermes-agent only sets it on
// clean CLI exit / compression / explicit reset, never on process
// kill or abandoned TUI connects. So we derive Duration and "Last
// active" from MAX(messages.timestamp) instead, which is always
// accurate, and only show the ended_at/end_reason pair when it's
// actually populated.

const Detail = memo((props: {
  row: Row
  onSwitch?: (sid: string) => void
  lineage?: (sid: string) => import("../utils/hermes-home").LineageInfo
}) => {
  const theme = useTheme().theme
  const r = props.row
  const d = r.detail
  const lastActive = d?.last_active ?? d?.ended_at ?? null
  const subCount = d?.subagent_count ?? 0
  // Lineage is pulled fresh on row change — query is in-process and
  // sub-ms. Cached by row.id so the lookup doesn't fire on every render.
  const [info, setInfo] = useState<import("../utils/hermes-home").LineageInfo>({})
  useEffect(() => {
    const fn = props.lineage ?? queryLineage
    setInfo(fn(r.id))
  }, [r.id, props.lineage])
  const hasLineage = info.continuesFrom || info.compressedTo || subCount > 0
  const go = (sid: string) => () => props.onSwitch?.(sid)

  return (
    <TabShell title="Session Detail" hint="" grow={2}>
      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          <box minHeight={1}>
            <text wrapMode="word"><span fg={theme.accent}><strong>{r.title || "Untitled"}</strong></span></text>
          </box>
          <box height={1} />
          <KVBlock rows={[
            ["ID", r.id],
            ["Source", badge(r.source ?? "")],
            ["Model", d?.model ?? "—"],
            ["Started", when(r.started_at)],
            ["Last active", lastActive ? `${when(lastActive)}  (${ago(lastActive)})` : "—"],
            ["Duration", lastActive ? span(r.started_at, lastActive) : "—"],
            ["Ended", d?.ended_at ? `${when(d.ended_at)}  ·  ${d.end_reason ?? "—"}` : undefined],
          ]} />
          <box height={1} />
          <KVBlock rows={[
            ["Messages", String(r.message_count)],
            ["Tool calls", d ? String(d.tool_call_count) : undefined],
            ["Input", d ? `${fmt(d.input_tokens)} tok` : undefined],
            ["Output", d ? `${fmt(d.output_tokens)} tok` : undefined],
            ["Cache", d ? `${fmt(d.cache_read_tokens)} r / ${fmt(d.cache_write_tokens)} w` : undefined],
            ["Reasoning", d ? `${fmt(d.reasoning_tokens)} tok` : undefined],
            ["Cost", d ? cost(d.estimated_cost_usd) : undefined, theme.success],
          ]} />
          {hasLineage ? <>
            <box height={1} />
            <box minHeight={1}><text fg={theme.textMuted}>Lineage</text></box>
            {info.continuesFrom ? (
              <box height={1} onMouseDown={go(info.continuesFrom.id)}>
                <text>
                  <span fg={theme.textMuted}>{"  ← continues from  "}</span>
                  <span fg={theme.accent}>{info.continuesFrom.title || info.continuesFrom.id}</span>
                </text>
              </box>
            ) : null}
            {info.compressedTo ? (
              <box height={1} onMouseDown={go(info.compressedTo.id)}>
                <text>
                  <span fg={theme.textMuted}>{"  → compressed to  "}</span>
                  <span fg={theme.accent}>{info.compressedTo.title || info.compressedTo.id}</span>
                </text>
              </box>
            ) : null}
            {subCount > 0 ? (
              <box height={1}>
                <text>
                  <span fg={theme.textMuted}>{"  ⎇ spawned "}</span>
                  <span fg={theme.text}>{String(subCount)}</span>
                  <span fg={theme.textMuted}>{` subagent${subCount === 1 ? "" : "s"}`}</span>
                </text>
              </box>
            ) : null}
          </> : null}
          <box height={1} />
          <KV label="First msg" value={r.preview || "—"} fg={theme.textMuted} wrap />
          <KV label="Last msg" value={d?.lastMessage || "—"} fg={theme.textMuted} wrap />
          {!d ? <>
            <box height={1} />
            <box height={1}><text fg={theme.textMuted}>(no local detail — state.db mismatch)</text></box>
          </> : null}
        </box>
      </scrollbox>
    </TabShell>
  )
})

// ─── Search Detail Panel ─────────────────────────────────────────────

const SearchDetail = memo((props: { result: SessionHit }) => {
  const theme = useTheme().theme
  const r = props.result

  // Render snippet with >>> <<< markers as highlights.
  const parts: Array<{ text: string; hi: boolean }> = []
  let rest = r.snippet
  while (rest.length) {
    const start = rest.indexOf(">>>")
    if (start < 0) { parts.push({ text: rest, hi: false }); break }
    if (start > 0) parts.push({ text: rest.slice(0, start), hi: false })
    const end = rest.indexOf("<<<", start + 3)
    if (end < 0) { parts.push({ text: rest.slice(start + 3), hi: true }); break }
    parts.push({ text: rest.slice(start + 3, end), hi: true })
    rest = rest.slice(end + 3)
  }

  return (
    <TabShell title="Search Match" hint="" grow={2}>
      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          <box minHeight={1}>
            <text wrapMode="word"><span fg={theme.accent}><strong>{r.title ?? "Untitled"}</strong></span></text>
          </box>
          <box height={1} />
          <KVBlock rows={[
            ["Source", badge(r.source)],
            ["Model", r.model ?? "—"],
            ["Time", when(r.started_at)],
          ]} />
          <box height={1} />
          <box height={1}><text fg={theme.textMuted}>Snippet</text></box>
          <box minHeight={1}>
            <text wrapMode="word">
              {parts.map((p, i) => p.hi
                ? <span key={i} fg={theme.accent}><strong>{p.text}</strong></span>
                : <span key={i} fg={theme.text}>{p.text}</span>
              )}
            </text>
          </box>
        </box>
      </scrollbox>
    </TabShell>
  )
})
// ─── Rows ────────────────────────────────────────────────────────────
// Col/Hdr live in ui/table; header pads by VBAR_W so its grow column
// matches body rows inside the forced-visible v-bar scrollbox.

const HeaderRow = memo(() => {
  const theme = useTheme().theme
  const fg = theme.textMuted
  return (
    <Hdr>
      <Col w={2} fg={fg}>{"  "}</Col>
      <Col grow fg={fg} bold>Title</Col>
      <Col w={9} fg={fg} bold>Source</Col>
      <Col w={8} fg={fg} bold>Start</Col>
      <Col w={10} fg={fg} bold right>Active</Col>
      <Col w={7} fg={fg} bold right>Msgs</Col>
      <box width={3} />
    </Hdr>
  )
})

// Row callbacks take the index so the *functions* are stable across
// renders — otherwise every row gets a fresh closure every parent
// render and memo() never bails (O(N) React work per keystroke).
type RowCbs = {
  onActivate: (i: number) => void
  onHover: (i: number) => void
  onDelete: (i: number) => void
}

const Item = memo((props: {
  id: string; row: Row; idx: number; selected: boolean; indent?: boolean
} & RowCbs) => {
  const theme = useTheme().theme
  const { row: r, idx: i } = props
  const [x, setX] = useState(false)
  const active = r.detail?.last_active ?? r.detail?.ended_at ?? null
  // Parent rows get "▸ "/"  " leaders; child rows get "└─" as the tree
  // marker instead. Selected children still show the accent highlight via
  // backgroundColor + text color below — no arrow needed, indent is the
  // only visual signal for hierarchy.
  const leader = props.indent
    ? (props.selected ? "└─" : "└─")
    : (props.selected ? "▸ " : "  ")

  return (
    <box id={props.id} flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseDown={() => props.onActivate(i)} onMouseMove={() => props.onHover(i)}>
      <Col w={2} fg={props.selected
        ? theme.primary
        : (props.indent ? theme.textMuted : theme.text)}>{leader}</Col>
      <Marquee grow active={props.selected}
               fg={props.selected ? theme.accent : (props.indent ? theme.textMuted : theme.text)}
               bold={props.selected}>
        {r.title || "Untitled"}
      </Marquee>
      <Col w={9} fg={theme.info}>{badge(r.source ?? "")}</Col>
      <Col w={8} fg={theme.textMuted}>{stamp(r.started_at)}</Col>
      <Col w={10} fg={theme.textMuted} right>{active ? ago(active) : "—"}</Col>
      <Col w={7} fg={theme.textMuted} right>{String(r.message_count)}</Col>
      <box width={3}
           onMouseDown={(e) => { e.stopPropagation(); props.onDelete(i) }}
           onMouseOver={() => setX(true)} onMouseOut={() => setX(false)}>
        <text><span fg={x ? theme.error : theme.textMuted}>{props.indent ? "" : " ✕"}</span></text>
      </box>
    </box>
  )
})

const SearchHeaderRow = memo(() => {
  const theme = useTheme().theme
  const fg = theme.textMuted
  return (
    <Hdr>
      <Col w={2} fg={fg}>{"  "}</Col>
      <Col grow fg={fg} bold>Title</Col>
      <Col w={9} fg={fg} bold>Source</Col>
      <Col w={10} fg={fg} bold>When</Col>
      <Col w={20} fg={fg} bold>Model</Col>
    </Hdr>
  )
})

const SearchItem = memo((props: {
  id: string; result: SessionHit; idx: number; selected: boolean
  onActivate: (i: number) => void; onHover: (i: number) => void
}) => {
  const theme = useTheme().theme
  const { result: r, idx: i } = props
  return (
    <box id={props.id} flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseDown={() => props.onActivate(i)} onMouseMove={() => props.onHover(i)}>
      <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
      <Col grow fg={props.selected ? theme.accent : theme.text} bold={props.selected}>
        {r.title ?? "Untitled"}
      </Col>
      <Col w={9} fg={theme.info}>{badge(r.source)}</Col>
      <Col w={10} fg={theme.textMuted}>{ago(r.started_at)}</Col>
      <Col w={20} fg={theme.textMuted}>{r.model ?? "—"}</Col>
    </box>
  )
})

// ─── Main ────────────────────────────────────────────────────────────

// Data-layer ops are injectable so tests don't fight analytics.test
// for the shared sandbox state.db. Defaults are the real functions.
type IO = {
  list: typeof queryRecentSessions
  search: typeof searchSessions
  remove: typeof deleteSession
  rename: typeof renameSession
  subagents: typeof querySubagents
  lineage: typeof queryLineage
}

type Props = { focused?: boolean; currentId?: string; onSwitch?: (sid: string) => void; io?: Partial<IO> }

export const Sessions = memo((props: Props) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()
  const dims = useTerminalDimensions()

  const io: IO = {
    list: props.io?.list ?? queryRecentSessions,
    search: props.io?.search ?? searchSessions,
    remove: props.io?.remove ?? deleteSession,
    rename: props.io?.rename ?? renameSession,
    subagents: props.io?.subagents ?? querySubagents,
    lineage: props.io?.lineage ?? queryLineage,
  }

  const [rows, setRows] = useState<Row[]>([])
  const [warn, setWarn] = useState("")
  // Selection is tracked as (index in the CURRENT visible sequence) so
  // all the existing keyboard/hover/activate callbacks still work off a
  // simple number. Expansion below computes visible rows from rows +
  // expandedId, and we invariant-clamp sel into range whenever visible
  // changes (new data loaded, expansion toggled, etc.).
  const [sel, setSel] = useState(0)
  // Which parent row's children are currently expanded. null = none.
  // Explicit state instead of deriving from sel means arrow-past-the-
  // last-child reliably collapses and lands on the next parent row.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SessionHit[]>([])
  // Cache of parent_id → children. Loaded lazily when a parent row
  // with subagent_count > 0 becomes focused. Cleared on reload.
  const [kids, setKids] = useState<Map<string, Row[]>>(new Map())
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vscroll = useRef<ScrollBoxRenderable | null>(null)

  // Flat visible sequence = parent rows with the expanded parent's
  // children inlined immediately after it. parentIdx points back into
  // rows[] so callbacks can find the owning parent.
  const visible: Array<{ row: Row; indent: boolean; parentIdx: number }> = []
  for (let i = 0; i < rows.length; i++) {
    const parent = rows[i]
    visible.push({ row: parent, indent: false, parentIdx: i })
    if (parent.id === expandedId) {
      const cs = kids.get(parent.id)
      if (cs) for (const c of cs) visible.push({ row: c, indent: true, parentIdx: i })
    }
  }

  // Latest-value refs so the stable row callbacks below don't close
  // over stale arrays (and therefore don't need to be in their deps,
  // which would defeat the memo).
  const live = useRef({ rows, visible, results, searching, onSwitch: props.onSwitch, currentId: props.currentId })
  live.current = { rows, visible, results, searching, onSwitch: props.onSwitch, currentId: props.currentId }

  const LIMIT = 2000

  const load = useCallback(async () => {
    const [rpc, fs] = await Promise.allSettled([
      gw.request<SessionListResponse>("session.list", { limit: LIMIT }),
      Promise.resolve().then(() => io.list(LIMIT)),
    ])
    const local = fs.status === "fulfilled"
      ? new Map(fs.value.map(r => [r.id, r]))
      : new Map<string, SessionRow>()

    if (rpc.status === "fulfilled" && rpc.value.sessions?.length) {
      setWarn("")
      // Stock session.list doesn't drop 0-msg stubs — every abandoned
      // connect leaves one, and they're never useful to resume.
      setRows(rpc.value.sessions
        .filter(s => (s.message_count ?? 0) > 0)
        .map(s => ({ ...s, detail: local.get(s.id) })))
      return
    }
    // RPC failed or empty — fall back to filesystem, but flag it.
    if (fs.status === "fulfilled" && fs.value.length) {
      setWarn(rpc.status === "rejected"
        ? `gateway session.list failed (${(rpc.reason as Error).message}) — listing state.db directly; rows may not resume`
        : "")
      setRows(fs.value
        .filter(d => d.message_count > 0)
        .map(d => ({
        id: d.id, title: d.title ?? "", preview: d.lastMessage ?? "",
        message_count: d.message_count, started_at: d.started_at,
        source: d.sessionSource, detail: d,
      })))
      return
    }
    setRows([])
    setKids(new Map())
    setExpandedId(null)
    setWarn(rpc.status === "rejected" ? (rpc.reason as Error).message : "")
  }, [gw])

  useEffect(() => { load() }, [load])

  // Auto-expand/collapse based on selection. When sel targets a parent
  // row with subagent_count > 0, expand it. When sel targets a parent
  // row with 0 subagents or a different parent's child, collapse any
  // prior expansion. When sel is on a child row (indent=true), the
  // current expandedId stays — we're inside that parent's subtree.
  useEffect(() => {
    if (searching) return
    const v = visible[sel]
    if (!v) return
    if (v.indent) return // sel is on a child → keep current expansion
    const count = v.row.detail?.subagent_count ?? 0
    const shouldExpand = count > 0 ? v.row.id : null
    if (shouldExpand !== expandedId) setExpandedId(shouldExpand)
  }, [sel, searching, visible, expandedId])

  // Clamp sel whenever visible's length changes (load, expansion toggle,
  // delete). Prevents sel from pointing past the end after rows shrink.
  useEffect(() => {
    if (sel > 0 && sel >= visible.length && visible.length > 0) {
      setSel(visible.length - 1)
    }
  }, [visible.length, sel])

  // Lazy-load children for the currently selected parent (or for the
  // parent whose child we're currently on). Cached in kids — re-focus
  // doesn't re-hit the DB.
  useEffect(() => {
    if (searching) return
    const v = visible[sel]
    if (!v) return
    const parent = rows[v.parentIdx]
    if (!parent) return
    const count = parent.detail?.subagent_count ?? 0
    if (count <= 0 || kids.has(parent.id)) return
    const pid = parent.id
    const children = io.subagents(pid).map(d => ({
      id: d.id, title: d.title ?? "", preview: d.lastMessage ?? "",
      message_count: d.message_count, started_at: d.started_at,
      source: d.sessionSource, detail: d,
    }))
    setKids(prev => {
      const next = new Map(prev)
      next.set(pid, children)
      return next
    })
  }, [sel, rows, searching, kids, visible])

  // Search is a synchronous FTS5 query on state.db, so debounce —
  // running it on every keystroke blocks the render thread. The
  // cleanup clears the pending timer, which also drops superseded
  // queries for free (only the most recent query value ever runs).
  useEffect(() => {
    if (!searching || !query.trim()) { setResults([]); return }
    debounce.current = setTimeout(() => {
      setResults(io.search(query, 30))
      setSel(0)
    }, 150)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, searching])

  // ── Stable row callbacks (identity never changes) ────────────────
  // Hover-to-select is onMouseMove, not onMouseOver — the latter fires
  // when scrollChildIntoView moves rows under a stationary cursor and
  // would snap sel back during ↓-repeat (the "stutter"). Mouse motion
  // events only arrive on real pointer movement.
  const rowHover = useCallback((i: number) => setSel(i), [])
  // Switching sessions reset()s the current chat; confirm unless it's
  // a no-op (same id) or there's nothing to switch to.
  const rowActivate = useCallback((i: number) => {
    setSel(i)
    const l = live.current
    const hit = l.searching ? l.results[i] : l.visible[i]?.row
    const id = l.searching ? (hit as SessionHit | undefined)?.session_id : (hit as Row | undefined)?.id
    if (!id || !l.onSwitch) return
    if (id === l.currentId) return l.onSwitch(id)
    const title = (hit as { title?: string } | undefined)?.title || "Untitled"
    const n = l.searching ? undefined : (hit as Row).message_count
    void openConfirm(dialog, {
      title: "Load session?",
      body: `${trunc(title, 60)}${n != null ? `  ·  ${n} msg${n === 1 ? "" : "s"}` : ""}\n\nCurrent chat will be replaced.`,
      yes: "load",
    }).then(ok => { if (ok) l.onSwitch?.(id) })
  }, [dialog])
  // Delete on a child row is a no-op (only parents can be deleted from
  // the list). The ✕ glyph is hidden for indented rows anyway; this
  // guard covers the keyboard shortcut path.
  const rowDelete = useCallback((i: number) => {
    const v = live.current.visible[i]
    if (v && !v.indent) confirmDeleteRef.current(v.row)
  }, [])

  const activate = useCallback(() => rowActivate(sel), [rowActivate, sel])

  const confirmDeleteRef = useRef<(r: Row) => void>(() => {})
  const confirmDelete = useCallback((r: Row) => {
    openConfirm(dialog, {
      title: "Delete Session?",
      body: trunc(r.title || "Untitled", 46),
      yes: "Delete",
      danger: true,
    }).then(ok => {
      if (!ok) return
      try {
        if (!io.remove(r.id)) throw new Error("not found")
        home.invalidate("recentSessions")
        toast.show({ variant: "success", message: "Session deleted" })
        setSel(prev => Math.max(0, Math.min(prev, rows.length - 2)))
        void load()
      } catch (e) {
        toast.show({ variant: "error", message: `Delete failed: ${(e as Error).message}` })
      }
    })
  }, [dialog, toast, load, rows.length])
  confirmDeleteRef.current = confirmDelete

  const rename = useCallback(async () => {
    const v = live.current.visible[sel]
    // Rename only operates on parent rows — subagent children don't
    // have stable titles (usually a single-line delegate prompt) and
    // the ✕ affordance is already hidden for them.
    if (!v || v.indent) return
    const r = v.row
    const title = await openTextPrompt(dialog, {
      title: `Rename: ${trunc(r.title || "Untitled", 42)}`, label: "Title", initial: r.title || "",
    })
    if (title === null) return
    Promise.resolve()
      .then(() => {
        if (!io.rename(r.id, title)) throw new Error("not found")
        home.invalidate("recentSessions")
        // Patch in place so the row updates without a full RPC reload
        // (session.list is the slow path). reload still happens next r.
        setRows(prev => prev.map(row => row.id === r.id ? { ...row, title } : row))
        toast.show({ variant: "success", message: "Renamed" })
      })
      .catch((e: Error) =>
        toast.show({ variant: "error", message: `Rename failed: ${e.message}` }))
  }, [dialog, toast, sel])

  const count = searching ? results.length : visible.length
  // Stable ids — include row.id + indent flag so a row moving between
  // indices (because a sibling expanded above it) doesn't collide with
  // the previous occupant. OpenTUI's reconciler keys on this; reused
  // ids after a layout shift log "Anchor is the same as the node X
  // being inserted, skipping insertBefore" and drop rows.
  const rowId = (i: number) => {
    if (searching) return `sess-s-${results[i]?.session_id ?? i}`
    const v = visible[i]
    return v ? `sess-${v.indent ? "c" : "p"}-${v.row.id}` : `sess-empty-${i}`
  }

  const keys = useKeys()
  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (searching) {
      if (key.name === "escape") { setSearching(false); setQuery(""); setResults([]); setSel(0); return }
      if (key.name === "backspace") return setQuery(p => p.slice(0, -1))
      if (key.name === "return") return activate()
      if (key.name === "up") return setSel(p => Math.max(0, p - 1))
      if (key.name === "down") return setSel(p => Math.min(count - 1, p + 1))
      if (key.raw && key.raw.length === 1 && key.raw >= " ") return setQuery(p => p + key.raw)
      return
    }
    const matched = handleListKey(keys, key, {
      count, setSel,
      page: Math.max(1, (vscroll.current?.viewport.height ?? 10) - 1),
      scrollTo: n => vscroll.current?.scrollChildIntoView(rowId(n)),
      onActivate: activate,
      onRefresh: () => { void load(); toast.show({ variant: "info", message: "Reloaded", duration: 1000 }) },
      onDelete: () => {
        const v = visible[sel]
        if (v && !v.indent) confirmDelete(v.row)
      },
      onSearch: () => { setSearching(true); setQuery(""); setResults([]); setSel(0) },
    })
    if (matched) return
    if (keys.match("sessions.rename", key)) return void rename()
  })

  const empty = searching ? results.length === 0 && query.length > 0 : rows.length === 0
  // Sidebar yields at <140 on non-Chat tabs (app.tsx), so detail can
  // stay mounted down to the shell's own floor.
  const showDetailPanel = dims.width >= 120

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={searching ? `Search Results (${results.length})` : `Sessions (${rows.length})`}
        hint={searching
          ? "↑↓ navigate  Enter/click switch  Esc cancel"
          : `↑↓ navigate  ${keys.print("list.activate")}/click switch  ${keys.print("list.search")} search  ${keys.print("sessions.rename")} rename  ${keys.print("list.delete")} delete  ${keys.print("list.refresh")} refresh`}
        error={warn || null}
        grow={3}
      >
        {searching ? (
          <box height={1} marginBottom={1}>
            <text>
              <span fg={theme.accent}>/ </span>
              <span fg={theme.text}>{query}</span>
              <span fg={theme.accent}>█</span>
            </text>
          </box>
        ) : null}

        {empty ? (
          // key prevents OpenTUI reconciler reusing this <box> for the
          // table wrapper below — it doesn't unset padding when the new
          // vnode omits it, so padding={2} would leak into the table.
          <box key="empty" flexGrow={1} padding={2}>
            <text fg={theme.textMuted}>
              {searching ? "No matching sessions found" : "No sessions found"}
            </text>
          </box>
        ) : (
          <box key="table" flexDirection="column" flexGrow={1} minWidth={0}>
            {searching ? <SearchHeaderRow /> : <HeaderRow />}
            <box height={1} />
            <scrollbox ref={vscroll} scrollY viewportCulling flexGrow={1}
                       verticalScrollbarOptions={{ visible: true }}>
              {searching
                ? results.map((r, i) => (
                    <SearchItem key={r.session_id} id={rowId(i)} idx={i}
                      result={r} selected={i === sel}
                      onActivate={rowActivate} onHover={rowHover} />
                  ))
                : visible.map((v, i) => (
                    <Item key={`${v.row.id}-${v.indent ? "c" : "p"}`} id={rowId(i)} idx={i}
                      row={v.row} selected={i === sel} indent={v.indent}
                      onActivate={rowActivate} onHover={rowHover} onDelete={rowDelete} />
                  ))}
            </scrollbox>
          </box>
        )}
      </TabShell>

      {showDetailPanel && searching && results[sel]
        ? <SearchDetail result={results[sel]} />
        : showDetailPanel && !searching && visible[sel]?.row
          ? <Detail row={visible[sel].row}
                    lineage={io.lineage}
                    onSwitch={(sid) => {
                      // Lineage-click switches target a SPECIFIC session
                      // (the predecessor or successor), not the projected
                      // tip. Onion-confirm to match the list click flow.
                      if (!props.onSwitch) return
                      if (sid === props.currentId) return props.onSwitch(sid)
                      void openConfirm(dialog, {
                        title: "Load session?",
                        body: `Switch to ${trunc(sid, 24)}?\n\nCurrent chat will be replaced.`,
                        yes: "load",
                      }).then(ok => { if (ok) props.onSwitch?.(sid) })
                    }} />
          : null}
    </box>
  )
})
