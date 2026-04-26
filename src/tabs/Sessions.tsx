import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { RGBA } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  queryRecentSessions, searchSessions, deleteSession,
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
import { KVBlock } from "../ui/kv"
import { openConfirm } from "../dialogs/confirm"
import { fmt, cost, trunc, ago, when, span } from "../ui/fmt"
import { invalidate } from "../utils/cache"

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

const stamp = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

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

const Detail = memo((props: { row: Row }) => {
  const theme = useTheme().theme
  const r = props.row
  const d = r.detail
  const lastActive = d?.last_active ?? d?.ended_at ?? null

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
            ["Parent", d?.parent_session_id || undefined],
          ]} />
          <box height={1} />
          <KVBlock rows={[
            ["First msg", r.preview || "—", theme.textMuted],
            ["Last msg", d?.lastMessage || "—", theme.textMuted],
          ]} />
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

// ─── Confirm Delete ──────────────────────────────────────────────────

const ConfirmDelete = (props: { title: string; onConfirm: () => void; onCancel: () => void }) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState<"y" | "n" | null>(null)

  useKeyboard((key) => {
    if (key.name === "y") props.onConfirm()
    if (key.name === "n" || key.name === "escape") props.onCancel()
  })

  return (
    <box flexDirection="column" width={50}>
      <text><span fg={theme.warning}><strong>Delete Session?</strong></span></text>
      <text> </text>
      <text wrapMode="word"><span fg={theme.text}>{trunc(props.title, 46)}</span></text>
      <text> </text>
      <box flexDirection="row" gap={2}>
        <box onMouseDown={props.onConfirm} onMouseOver={() => setHover("y")} onMouseOut={() => setHover(null)}>
          <text>
            <span fg={hover === "y" ? theme.error : theme.textMuted}>{hover === "y" ? "▸ " : "  "}</span>
            <span fg={hover === "y" ? theme.error : theme.text}>[y] Delete</span>
          </text>
        </box>
        <box onMouseDown={props.onCancel} onMouseOver={() => setHover("n")} onMouseOut={() => setHover(null)}>
          <text>
            <span fg={hover === "n" ? theme.accent : theme.textMuted}>{hover === "n" ? "▸ " : "  "}</span>
            <span fg={hover === "n" ? theme.accent : theme.text}>[n] Cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}

// ─── Rows ────────────────────────────────────────────────────────────
//
// Columns are flex boxes, not padded strings — the title column takes
// all remaining width (grows on wide terminals, truncates via overflow
// on narrow ones) while meta columns hold fixed width. height={1}
// forces single-line truncation instead of wrap.
//
// Header and body rows share the same Col structure so they stay
// aligned under resize. The body scrolls vertically; horizontal
// scroll is deliberately not nested — OpenTUI's inner vbar becomes
// part of the scrolled content and both leaks 1px width (phantom
// h-bar) and scrolls off-screen with the table. The width cascade
// (sidebar hides <120, detail panel <140) gives the list enough room
// that the title column only hits its minWidth at ~80 terminal cols.

type ColProps = { w?: number; grow?: boolean; fg: RGBA; bold?: boolean; right?: boolean; children: string }
const Col = (p: ColProps) => (
  <box width={p.w} flexGrow={p.grow ? 1 : 0} flexShrink={p.grow ? 1 : 0}
       minWidth={p.grow ? 12 : p.w} height={1} overflow="hidden"
       flexDirection="row" justifyContent={p.right ? "flex-end" : "flex-start"}>
    <text>{p.bold
      ? <span fg={p.fg}><strong>{p.children}</strong></span>
      : <span fg={p.fg}>{p.children}</span>}</text>
  </box>
)

// Body scrollbox forces its vbar visible so it always reserves VBAR_W;
// header pads by the same so both flex containers have identical
// available width and the grow column (Title) lands on the same x.
// (Auto-hide would make the gutter conditional, which can only be
// detected post-layout — not worth the re-render feedback loop.)
const VBAR_W = 1

const HeaderRow = memo((props: { detail: boolean }) => {
  const theme = useTheme().theme
  const fg = theme.textMuted
  return (
    <box flexDirection="row" height={1} paddingRight={VBAR_W}>
      <Col w={2} fg={fg}>{"  "}</Col>
      <Col grow fg={fg} bold>Title</Col>
      <Col w={9} fg={fg} bold>Source</Col>
      <Col w={7} fg={fg} bold>Start</Col>
      <Col w={7} fg={fg} bold right>Msgs</Col>
      {props.detail ? <>
        <Col w={7} fg={fg} bold right>Tools</Col>
        <Col w={9} fg={fg} bold right>Cost</Col>
      </> : null}
      <box width={3} />
    </box>
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
  id: string; row: Row; idx: number; selected: boolean; detail: boolean
} & RowCbs) => {
  const theme = useTheme().theme
  const { row: r, idx: i } = props
  const [x, setX] = useState(false)

  return (
    <box id={props.id} flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseDown={() => props.onActivate(i)} onMouseOver={() => props.onHover(i)}>
      <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
      <Col grow fg={props.selected ? theme.accent : theme.text} bold={props.selected}>
        {r.title || "Untitled"}
      </Col>
      <Col w={9} fg={theme.info}>{badge(r.source ?? "")}</Col>
      <Col w={7} fg={theme.textMuted}>{stamp(r.started_at)}</Col>
      <Col w={7} fg={theme.textMuted} right>{String(r.message_count)}</Col>
      {props.detail ? <>
        <Col w={7} fg={theme.textMuted} right>{r.detail ? String(r.detail.tool_call_count) : "—"}</Col>
        <Col w={9} fg={theme.success} right>{r.detail ? cost(r.detail.estimated_cost_usd) : "—"}</Col>
      </> : null}
      <box width={3}
           onMouseDown={(e) => { e.stopPropagation(); props.onDelete(i) }}
           onMouseOver={() => setX(true)} onMouseOut={() => setX(false)}>
        <text><span fg={x ? theme.error : theme.textMuted}>{" ✕"}</span></text>
      </box>
    </box>
  )
})

const SearchHeaderRow = memo(() => {
  const theme = useTheme().theme
  const fg = theme.textMuted
  return (
    <box flexDirection="row" height={1} paddingRight={VBAR_W}>
      <Col w={2} fg={fg}>{"  "}</Col>
      <Col grow fg={fg} bold>Title</Col>
      <Col w={9} fg={fg} bold>Source</Col>
      <Col w={10} fg={fg} bold>When</Col>
      <Col w={20} fg={fg} bold>Model</Col>
    </box>
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
         onMouseDown={() => props.onActivate(i)} onMouseOver={() => props.onHover(i)}>
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
  }

  const [rows, setRows] = useState<Row[]>([])
  const [warn, setWarn] = useState("")
  const [sel, setSel] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SessionHit[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vscroll = useRef<ScrollBoxRenderable | null>(null)

  // Latest-value refs so the stable row callbacks below don't close
  // over stale arrays (and therefore don't need to be in their deps,
  // which would defeat the memo).
  const live = useRef({ rows, results, searching, onSwitch: props.onSwitch, currentId: props.currentId })
  live.current = { rows, results, searching, onSwitch: props.onSwitch, currentId: props.currentId }

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
    setWarn(rpc.status === "rejected" ? (rpc.reason as Error).message : "")
  }, [gw])

  useEffect(() => { load() }, [load])

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
  const rowHover = useCallback((i: number) => setSel(i), [])
  // Switching sessions reset()s the current chat; confirm unless it's
  // a no-op (same id) or there's nothing to switch to.
  const rowActivate = useCallback((i: number) => {
    setSel(i)
    const l = live.current
    const hit = l.searching ? l.results[i] : l.rows[i]
    const id = l.searching ? (hit as SessionHit | undefined)?.session_id : (hit as Row | undefined)?.id
    if (!id || !l.onSwitch) return
    if (id === l.currentId) return l.onSwitch(id)
    const title = hit?.title || "Untitled"
    const n = l.searching ? undefined : (hit as Row).message_count
    void openConfirm(dialog, {
      title: "Load session?",
      body: `${trunc(title, 60)}${n != null ? `  ·  ${n} msg${n === 1 ? "" : "s"}` : ""}\n\nCurrent chat will be replaced.`,
      yes: "load",
    }).then(ok => { if (ok) l.onSwitch?.(id) })
  }, [dialog])
  const rowDelete = useCallback((i: number) => {
    const r = live.current.rows[i]
    if (r) confirmDeleteRef.current(r)
  }, [])

  const activate = useCallback(() => rowActivate(sel), [rowActivate, sel])

  const confirmDeleteRef = useRef<(r: Row) => void>(() => {})
  const confirmDelete = useCallback((r: Row) => {
    dialog.replace(
      <ConfirmDelete
        title={r.title || "Untitled"}
        onConfirm={() => {
          dialog.clear()
          Promise.resolve()
            .then(() => {
              if (!io.remove(r.id)) throw new Error("not found")
              invalidate()
              toast.show({ variant: "success", message: "Session deleted" })
              setSel(prev => Math.max(0, Math.min(prev, rows.length - 2)))
              return load()
            })
            .catch((e: Error) =>
              toast.show({ variant: "error", message: `Delete failed: ${e.message}` }))
        }}
        onCancel={() => dialog.clear()}
      />,
    )
  }, [dialog, toast, load, rows.length])
  confirmDeleteRef.current = confirmDelete

  const count = searching ? results.length : rows.length
  const rowId = (i: number) => `sess-row-${i}`

  const move = useCallback((next: (p: number) => number) => {
    setSel(p => {
      const n = Math.max(0, Math.min(count - 1, next(p)))
      vscroll.current?.scrollChildIntoView(rowId(n))
      return n
    })
  }, [count])

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (!searching && key.raw === "/") {
      setSearching(true); setQuery(""); setResults([]); setSel(0)
      return
    }
    if (searching) {
      if (key.name === "escape") { setSearching(false); setQuery(""); setResults([]); setSel(0); return }
      if (key.name === "backspace") return setQuery(p => p.slice(0, -1))
      if (key.name === "return") return activate()
      if (key.name === "up") return move(p => p - 1)
      if (key.name === "down") return move(p => p + 1)
      if (key.raw && key.raw.length === 1 && key.raw >= " ") return setQuery(p => p + key.raw)
      return
    }
    if (key.name === "up") return move(p => p - 1)
    if (key.name === "down") return move(p => p + 1)
    if (key.name === "pageup") return move(p => p - Math.max(1, (vscroll.current?.viewport.height ?? 10) - 1))
    if (key.name === "pagedown") return move(p => p + Math.max(1, (vscroll.current?.viewport.height ?? 10) - 1))
    if (key.name === "home") return move(() => 0)
    if (key.name === "end") return move(() => count - 1)
    if (key.name === "return") return activate()
    if (key.name === "r") return void load()
    if (key.raw === "d" || key.name === "delete") {
      const r = rows[sel]
      if (r) confirmDelete(r)
    }
  })

  const empty = searching ? results.length === 0 && query.length > 0 : rows.length === 0
  const hasDetail = useMemo(() => rows.some(r => r.detail), [rows])
  const showDetailPanel = dims.width >= 140

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={searching ? `Search Results (${results.length})` : `Sessions (${rows.length})`}
        hint={searching
          ? "↑↓ navigate  Enter/click switch  Esc cancel"
          : "↑↓ navigate  Enter/click switch  / search  d delete  r refresh"}
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
            {searching ? <SearchHeaderRow /> : <HeaderRow detail={hasDetail} />}
            <box height={1} />
            <scrollbox ref={vscroll} scrollY viewportCulling flexGrow={1}
                       verticalScrollbarOptions={{ visible: true }}>
              {searching
                ? results.map((r, i) => (
                    <SearchItem key={r.session_id} id={rowId(i)} idx={i}
                      result={r} selected={i === sel}
                      onActivate={rowActivate} onHover={rowHover} />
                  ))
                : rows.map((r, i) => (
                    <Item key={r.id} id={rowId(i)} idx={i}
                      row={r} selected={i === sel} detail={hasDetail}
                      onActivate={rowActivate} onHover={rowHover} onDelete={rowDelete} />
                  ))}
            </scrollbox>
          </box>
        )}
      </TabShell>

      {showDetailPanel && searching && results[sel]
        ? <SearchDetail result={results[sel]} />
        : showDetailPanel && !searching && rows[sel]
          ? <Detail row={rows[sel]} />
          : null}
    </box>
  )
})
