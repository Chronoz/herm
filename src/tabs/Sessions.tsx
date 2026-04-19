import { useState, useEffect, useCallback, useRef, memo } from "react"
import { useKeyboard } from "@opentui/react"
import type { RGBA } from "@opentui/core"
import { queryRecentSessions, type SessionRow } from "../utils/hermes-home"
import type {
  SessionListItem, SessionListResponse,
  SessionSearchHit, SessionSearchResponse, SessionDeleteResponse,
} from "../utils/gateway-types"
import { useGateway } from "../app/gateway"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { invalidate } from "../utils/cache"

// All reads/writes go through the gateway (session.list / .search /
// .delete) so the tab is correct under profiles and remote gateways.
// Rows are enriched best-effort from state.db for token/cost/model
// detail the list RPC doesn't expose; absence is non-fatal.

type Row = SessionListItem & { detail?: SessionRow }

// ─── Formatting ──────────────────────────────────────────────────────

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n)

const cost = (c: number | null | undefined): string =>
  c == null ? "—" : `$${c.toFixed(2)}`

const badge = (src: string): string => ({
  cli: "CLI", tui: "TUI", api_server: "API", discord: "Discord",
  telegram: "Telegram", slack: "Slack", whatsapp: "WhatsApp", signal: "Signal",
} as Record<string, string>)[src] ?? src

const stamp = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

const when = (ts: number): string =>
  `${new Date(ts * 1000).toLocaleDateString()} ${new Date(ts * 1000).toLocaleTimeString()}`

const span = (start: number, end: number | null): string => {
  if (!end) return "ongoing"
  const s = end - start
  if (s < 0) return "—"
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

const ago = (ts: number): string => {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const trunc = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…"

// ─── Detail Panel ────────────────────────────────────────────────────

const Detail = memo((props: { row: Row }) => {
  const theme = useTheme().theme
  const r = props.row
  const d = r.detail

  const lines: Array<[string, string]> = [
    ["ID", r.id],
    ["Source", badge(r.source ?? "")],
    ["Started", when(r.started_at)],
    ["Messages", String(r.message_count)],
  ]
  if (d) {
    lines.push(
      ["Model", d.model ?? "—"],
      ["Ended", d.ended_at ? when(d.ended_at) : "ongoing"],
      ["Duration", span(d.started_at, d.ended_at)],
      ["Tool Calls", String(d.tool_call_count)],
      ["Input", `${fmt(d.input_tokens)} tok`],
      ["Output", `${fmt(d.output_tokens)} tok`],
      ["Cache", `${fmt(d.cache_read_tokens)} r / ${fmt(d.cache_write_tokens)} w`],
      ["Reasoning", `${fmt(d.reasoning_tokens)} tok`],
      ["Cost", cost(d.estimated_cost_usd)],
    )
    if (d.end_reason) lines.push(["End Reason", d.end_reason])
    if (d.parent_session_id) lines.push(["Parent", d.parent_session_id])
  }

  return (
    <box flexDirection="column" padding={1} border borderColor={theme.border}
         backgroundColor={theme.backgroundPanel} width="40%">
      <text><span fg={theme.primary}><strong>Session Detail</strong></span></text>
      <text> </text>
      <text><span fg={theme.accent}><strong>{r.title || "Untitled"}</strong></span></text>
      {r.preview && r.preview !== r.title ? (
        <text wrapMode="word"><span fg={theme.textMuted}>{trunc(r.preview, 80)}</span></text>
      ) : null}
      <text> </text>
      {lines.map(([k, v]) => (
        <text key={k}>
          <span fg={theme.textMuted}>{k.padEnd(13)}</span>
          <span fg={theme.text}>{` ${v}`}</span>
        </text>
      ))}
      {!d ? (
        <>
          <text> </text>
          <text fg={theme.textMuted}>(no local detail — state.db mismatch)</text>
        </>
      ) : null}
    </box>
  )
})

// ─── Search Detail Panel ─────────────────────────────────────────────

const SearchDetail = memo((props: { result: SessionSearchHit }) => {
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
    <box flexDirection="column" padding={1} border borderColor={theme.border}
         backgroundColor={theme.backgroundPanel} width="40%">
      <text><span fg={theme.primary}><strong>Search Match</strong></span></text>
      <text> </text>
      <text><span fg={theme.accent}><strong>{r.title ?? "Untitled"}</strong></span></text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Source".padEnd(13)}</span>
        <span fg={theme.info}>{` ${badge(r.source)}`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Model".padEnd(13)}</span>
        <span fg={theme.text}>{` ${r.model ?? "—"}`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Time".padEnd(13)}</span>
        <span fg={theme.text}>{` ${when(r.started_at)}`}</span>
      </text>
      <text> </text>
      <text><span fg={theme.textMuted}>Snippet:</span></text>
      <text wrapMode="word">
        {parts.map((p, i) => p.hi
          ? <span key={i} fg={theme.accent}><strong>{p.text}</strong></span>
          : <span key={i} fg={theme.text}>{p.text}</span>
        )}
      </text>
    </box>
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

type ColProps = { w?: number; grow?: boolean; fg: RGBA; bold?: boolean; children: string }
const Col = (p: ColProps) => (
  <box width={p.w} flexGrow={p.grow ? 1 : 0} flexShrink={p.grow ? 1 : 0}
       minWidth={p.grow ? 8 : p.w} height={1} overflow="hidden">
    <text>{p.bold
      ? <span fg={p.fg}><strong>{p.children}</strong></span>
      : <span fg={p.fg}>{p.children}</span>}</text>
  </box>
)

const Item = memo((props: {
  row: Row; selected: boolean
  onActivate: () => void; onHover: () => void; onDelete: () => void
}) => {
  const theme = useTheme().theme
  const r = props.row
  const [x, setX] = useState(false)

  return (
    <box flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseDown={props.onActivate} onMouseOver={props.onHover}>
      <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
      <Col grow fg={props.selected ? theme.accent : theme.text} bold={props.selected}>
        {r.title || "Untitled"}
      </Col>
      <Col w={9} fg={theme.info}>{badge(r.source ?? "")}</Col>
      <Col w={7} fg={theme.textMuted}>{stamp(r.started_at)}</Col>
      <Col w={10} fg={theme.textMuted}>{`${String(r.message_count).padStart(4)} msgs`}</Col>
      {r.detail ? (
        <>
          <Col w={11} fg={theme.textMuted}>{`${String(r.detail.tool_call_count).padStart(4)} tools`}</Col>
          <Col w={9} fg={theme.success}>{cost(r.detail.estimated_cost_usd).padStart(8)}</Col>
        </>
      ) : null}
      <box width={3}
           onMouseDown={(e) => { e.stopPropagation(); props.onDelete() }}
           onMouseOver={() => setX(true)} onMouseOut={() => setX(false)}>
        <text><span fg={x ? theme.error : theme.textMuted}>{" ✕"}</span></text>
      </box>
    </box>
  )
})

const SearchItem = memo((props: {
  result: SessionSearchHit; selected: boolean
  onActivate: () => void; onHover: () => void
}) => {
  const theme = useTheme().theme
  const r = props.result
  return (
    <box flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseDown={props.onActivate} onMouseOver={props.onHover}>
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

type Props = { focused?: boolean; onSwitch?: (sid: string) => void }

export const Sessions = memo((props: Props) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()

  const [rows, setRows] = useState<Row[]>([])
  const [warn, setWarn] = useState("")
  const [sel, setSel] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SessionSearchHit[]>([])
  const seq = useRef(0)

  const load = useCallback(async () => {
    const [rpc, fs] = await Promise.allSettled([
      gw.request<SessionListResponse>("session.list", { limit: 50 }),
      Promise.resolve().then(() => queryRecentSessions(100)),
    ])
    const local = fs.status === "fulfilled"
      ? new Map(fs.value.map(r => [r.id, r]))
      : new Map<string, SessionRow>()

    if (rpc.status === "fulfilled" && rpc.value.sessions?.length) {
      setWarn("")
      setRows(rpc.value.sessions.map(s => ({ ...s, detail: local.get(s.id) })))
      return
    }
    // RPC failed or empty — fall back to filesystem, but flag it.
    if (fs.status === "fulfilled" && fs.value.length) {
      setWarn(rpc.status === "rejected"
        ? `gateway session.list failed (${(rpc.reason as Error).message}) — listing state.db directly; rows may not resume`
        : "")
      setRows(fs.value.map(d => ({
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

  // Search via gateway RPC. The old filesystem implementation debounced
  // with setTimeout because a sync sqlite query on every keystroke blocked
  // the render thread. RPC is async — fire per keystroke and drop any
  // response whose seq no longer matches (out-of-order or superseded).
  useEffect(() => {
    const id = ++seq.current
    if (!searching || !query.trim()) { setResults([]); return }
    gw.request<SessionSearchResponse>("session.search", { query, limit: 30 })
      .then(r => {
        if (seq.current !== id) return
        setResults(r.results ?? [])
        setSel(0)
      })
      .catch(() => { if (seq.current === id) setResults([]) })
  }, [gw, query, searching])

  const activate = useCallback(() => {
    const id = searching ? results[sel]?.session_id : rows[sel]?.id
    if (id && props.onSwitch) props.onSwitch(id)
  }, [rows, results, sel, props.onSwitch, searching])

  const confirmDelete = useCallback((r: Row) => {
    dialog.replace(
      <ConfirmDelete
        title={r.title || "Untitled"}
        onConfirm={() => {
          dialog.clear()
          gw.request<SessionDeleteResponse>("session.delete", { session_id: r.id })
            .then(res => {
              if (!res.deleted) throw new Error("not found")
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
  }, [gw, dialog, toast, load, rows.length])

  const count = searching ? results.length : rows.length

  useKeyboard((key) => {
    if (!props.focused) return
    if (!searching && key.raw === "/") {
      setSearching(true); setQuery(""); setResults([]); setSel(0)
      return
    }
    if (searching) {
      if (key.name === "escape") { setSearching(false); setQuery(""); setResults([]); setSel(0); return }
      if (key.name === "backspace") return setQuery(p => p.slice(0, -1))
      if (key.name === "return") return activate()
      if (key.name === "up") return setSel(p => Math.max(0, p - 1))
      if (key.name === "down") return setSel(p => Math.min(count - 1, p + 1))
      if (key.raw && key.raw.length === 1 && key.raw >= " ") return setQuery(p => p + key.raw)
      return
    }
    if (key.name === "up") return setSel(p => Math.max(0, p - 1))
    if (key.name === "down") return setSel(p => Math.min(count - 1, p + 1))
    if (key.name === "return") return activate()
    if (key.name === "r") return void load()
    if (key.raw === "d" || key.name === "delete") {
      const r = rows[sel]
      if (r) confirmDelete(r)
    }
  })

  const empty = searching ? results.length === 0 && query.length > 0 : rows.length === 0

  return (
    <box flexDirection="row" flexGrow={1}>
      <box flexDirection="column" flexGrow={1} minWidth={0}
           border borderColor={theme.border}
           backgroundColor={theme.backgroundPanel} padding={1}>
        <box height={1} flexDirection="row" overflow="hidden">
          <box flexShrink={0}>
            <text><span fg={theme.primary}><strong>
              {searching ? `Search Results (${results.length})` : `Sessions (${rows.length})`}
            </strong></span></text>
          </box>
          <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
            <text fg={theme.textMuted}>
              {searching
                ? "  ↑↓ navigate  Enter/click switch  Esc cancel"
                : "  ↑↓ navigate  Enter/click switch  / search  d delete  r refresh"}
            </text>
          </box>
        </box>

        {warn ? <text fg={theme.warning}>⚠ {warn}</text> : null}

        {searching ? (
          <box>
            <text>
              <span fg={theme.accent}>{"/ "}</span>
              <span fg={theme.text}>{query}</span>
              <span fg={theme.accent}>{"█"}</span>
            </text>
          </box>
        ) : null}

        <text> </text>

        {empty ? (
          <box flexGrow={1} padding={2}>
            <text fg={theme.textMuted}>
              {searching ? "No matching sessions found" : "No sessions found"}
            </text>
          </box>
        ) : (
          <scrollbox scrollY>
            {searching
              ? results.map((r, i) => (
                  <SearchItem key={r.session_id} result={r} selected={i === sel}
                    onActivate={() => { setSel(i); props.onSwitch?.(r.session_id) }}
                    onHover={() => setSel(i)} />
                ))
              : rows.map((r, i) => (
                  <Item key={r.id} row={r} selected={i === sel}
                    onActivate={() => { setSel(i); props.onSwitch?.(r.id) }}
                    onHover={() => setSel(i)}
                    onDelete={() => confirmDelete(r)} />
                ))}
          </scrollbox>
        )}
      </box>

      {searching && results[sel]
        ? <SearchDetail result={results[sel]} />
        : !searching && rows[sel]
          ? <Detail row={rows[sel]} />
          : null}
    </box>
  )
})
