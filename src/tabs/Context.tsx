/**
 * Context tab — two-level drill-down context window visualizer.
 *
 * Level 0: System & Prompt | Tools | Conversation | Free
 * Level 1: Click a group → grid expands to show children
 * Detail:  Click a leaf → right panel shows content
 *
 * The grid always fills 16×16 = 256 cells.
 * At level 0, cells are proportional to the full context window.
 * At level 1, cells are proportional to the drilled group's total.
 */

import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react"
import type { HermesApiClient } from "../utils/hermes-api-client"
import type { Message } from "../types/message"
import { text as msgText } from "../types/message"
import {
  type HermesHomeSnapshot,
  type SessionRow,
  type ToolInfo,
} from "../utils/hermes-home"
import { snapshot } from "../utils/cache"
import {
  parse,
  build,
  drill,
  cells as buildCells,
  type Segment,
  type Section,
} from "../utils/context-segments"
import { FileLink } from "../components/ui/FileLink"
import { useTheme, type Theme } from "../theme"
import type { RGBA } from "@opentui/core"

// ─── Types ───────────────────────────────────────────────────────────

type Props = {
  description?: string
  client?: HermesApiClient | null
  messages?: Message[]
  sessionStart?: number
  visible?: boolean
}

type Wire = { input: number; output: number; total: number; calls: number }

type TokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// ─── Constants ───────────────────────────────────────────────────────

const CTX: Record<string, number> = {
  "claude-opus-4-6": 1_000_000, "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4.6": 1_000_000, "claude-sonnet-4.6": 1_000_000,
  "claude-opus-4": 200_000, "claude-sonnet-4": 200_000,
  "claude-3.5-sonnet": 200_000, "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000, "claude-3-haiku": 200_000,
  "gpt-4.1": 1_047_576, "gpt-4o": 128_000, "gpt-4": 128_000,
  gemini: 1_048_576, deepseek: 128_000, llama: 131_072, qwen: 131_072,
}
const DEFAULT_CTX = 128_000
const CPT = 4
const COLS = 16
const WARN = 80
const CRIT = 95

// ─── Colors ──────────────────────────────────────────────────────────

const PALETTE: Record<string, (t: Theme) => RGBA> = {
  // Top-level groups
  system: t => t.info,
  tools: t => t.error,
  conversation: t => t.secondary,
  free: t => t.borderSubtle,
  // System children
  soul: t => t.info,
  memory: t => t.warning,
  user: t => t.accent,
  mem0: t => t.warning,
  skills: t => t.primary,
  project: t => t.success,
  meta: t => t.textMuted,
  other: t => t.textMuted,
}

const clr = (id: string, theme: Theme) => (PALETTE[id] ?? PALETTE.other)(theme)

// ─── Utilities ───────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const est = (s: string) => s ? Math.ceil(s.length / CPT) : 0

const bar = (pct: number, w = 20) => {
  const f = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)
  return `[${"█".repeat(f)}${"░".repeat(Math.max(0, w - f))}]`
}

const resolveCtx = (model: string) => {
  const bare = (model.includes("/") ? model.split("/").pop()! : model).toLowerCase()
  if (CTX[bare]) return CTX[bare]
  for (const [k, v] of Object.entries(CTX)) { if (bare.startsWith(k)) return v }
  return DEFAULT_CTX
}

const status = (pct: number, theme: Theme) => {
  if (pct >= CRIT) return { label: "CRITICAL", color: theme.error }
  if (pct >= WARN) return { label: "HIGH", color: theme.error }
  if (pct >= 50) return { label: "MODERATE", color: theme.warning }
  return { label: "HEALTHY", color: theme.success }
}

// ─── Detail Panels ──────────────────────────────────────────────────

/** Generic section detail — shows raw content */
const SectionPanel = memo(({ seg, theme }: { seg: Segment; theme: Theme }) => {
  const sec = seg.section
  if (!sec) return null
  const lines = sec.text.split("\n").filter(l => l.trim())
  const preview = lines.slice(0, 80)
  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong><span fg={clr(seg.id, theme)}>◼</span> {seg.label} — {fmt(seg.tokens)} tokens ({seg.percent.toFixed(1)}%)</strong>
      </text>
      <text>{sec.chars.toLocaleString()} chars · ~{fmt(sec.tokens)} tokens</text>
      {sec.source ? <box flexDirection="row" height={1}><text>Source: </text><FileLink source={sec.source} /></box> : null}
      <text> </text>
      {preview.map((l, i) => <text key={i} fg={theme.text}>{l}</text>)}
      {lines.length > 80 ? <text fg={theme.textMuted}>... {lines.length - 80} more lines</text> : null}
    </scrollbox>
  )
})

/** Memory detail with capacity bar + entries */
const MemoryPanel = memo(({ seg, theme, label, chars, limit, pct, entries, source }: {
  seg: Segment; theme: Theme; label: string
  chars: number; limit: number; pct: number; entries: string[]
  source?: { file: string; relative: string; label: string }
}) => (
  <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
    <text>
      <strong><span fg={clr(seg.id, theme)}>◼</span> {seg.label} — {fmt(seg.tokens)} tokens ({seg.percent.toFixed(1)}%)</strong>
    </text>
    <text> </text>
    <box flexDirection="row" height={1}>
      <text><strong>{label}</strong></text>
      {source ? <><text> (</text><FileLink source={source} /><text>)</text></> : null}
    </box>
    <text>{chars.toLocaleString()} / {limit.toLocaleString()} chars ({pct}%)</text>
    <text>{bar(pct, 25)}{pct >= 95 ? " ⚠ near limit" : ""}</text>
    <text> </text>
    <text>{entries.length} entries:</text>
    {entries.map((e, i) => <text key={i} fg={theme.text}>· {e}</text>)}
  </scrollbox>
))

/** Skills detail with category breakdown */
const SkillsPanel = memo(({ seg, theme }: { seg: Segment; theme: Theme }) => {
  const sec = seg.section
  if (!sec) return null
  const cats: Record<string, number> = {}
  for (const line of sec.text.split("\n")) {
    if (line.match(/^\s{2}(\S[\w-]*(?:\/\S+)?):\s/)) {
      const cat = line.match(/^\s{2}(\S[\w-]*(?:\/\S+)?):\s/)![1]
      if (!cats[cat]) cats[cat] = 0
    }
    if (line.match(/^\s{4}- \S+:/)) {
      const last = Object.keys(cats).pop()
      if (last) cats[last]++
    }
  }
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((s, [, n]) => s + n, 0)

  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong><span fg={clr("skills", theme)}>◼</span> Skills Catalog — {fmt(seg.tokens)} tokens ({seg.percent.toFixed(1)}%)</strong>
      </text>
      {sec.source ? <box flexDirection="row" height={1}><text>Source: </text><FileLink source={sec.source} /></box> : null}
      <text> </text>
      <text>{total} skills in {sorted.length} categories · {sec.chars.toLocaleString()} chars</text>
      <text fg={theme.textMuted}>Largest context section — skill names + descriptions injected every turn.</text>
      <text> </text>
      {sorted.map(([cat, n]) => <text key={cat} fg={theme.text}>· {cat} ({n})</text>)}
    </scrollbox>
  )
})

/** Tools detail */
const ToolsPanel = memo(({ seg, theme, tools }: {
  seg: Segment; theme: Theme; tools: ReadonlyArray<ToolInfo>
}) => {
  const sorted = [...tools].sort((a, b) =>
    (b.descriptionLength + b.paramsLength) - (a.descriptionLength + a.paramsLength),
  )
  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong><span fg={clr("tools", theme)}>◼</span> Tool Schemas — {fmt(seg.tokens)} tokens ({seg.percent.toFixed(1)}%)</strong>
      </text>
      <text> </text>
      <text>{tools.length} tools — JSON schemas sent with every API call.</text>
      <text> </text>
      {sorted.map(t => (
        <text key={t.name} fg={theme.text}>
          · {t.name} ({fmt(Math.ceil((t.descriptionLength + t.paramsLength) / CPT))} tok)
        </text>
      ))}
    </scrollbox>
  )
})

/** Conversation detail */
const ConvPanel = memo(({ seg, theme, messages, output }: {
  seg: Segment; theme: Theme; messages: Message[]; output: number
}) => {
  const user = messages.filter(m => m.role === "user")
  const asst = messages.filter(m => m.role === "assistant")
  const non = messages.filter(m => m.role !== "system")
  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong><span fg={clr("conversation", theme)}>◼</span> Conversation — {fmt(seg.tokens)} tokens ({seg.percent.toFixed(1)}%)</strong>
      </text>
      <text> </text>
      <text>User: {user.length} msgs (~{fmt(est(user.map(m => msgText(m)).join("")))} tok)</text>
      <text>Agent: {asst.length} msgs (~{fmt(est(asst.map(m => msgText(m)).join("")))} tok)</text>
      {output > 0 ? <text>Output generated: {fmt(output)} tokens</text> : null}
      <text> </text>
      {non.length > 0 ? (
        <>
          <text fg={theme.info}>Messages:</text>
          <text> </text>
          {non.map((m, i) => (
            <text key={i}>
              <span fg={m.role === "user" ? theme.info : theme.success}>
                {m.role === "user" ? "▸ You" : "◂ Agent"}
              </span>{" "}({fmt(est(msgText(m)))}) {msgText(m).replace(/\n/g, " ")}
            </text>
          ))}
        </>
      ) : <text fg={theme.warning}>No messages yet</text>}
    </scrollbox>
  )
})

/** Free space detail */
const FreePanel = memo(({ seg, theme, ctxLen, home }: {
  seg: Segment; theme: Theme; ctxLen: number; home: HermesHomeSnapshot | null
}) => {
  const used = ctxLen - seg.tokens
  const comp = home?.config?.compression
  const threshold = Math.round(ctxLen * (comp?.threshold ?? 0.5))
  const pct = threshold > 0 ? Math.min(100, Math.round((used / threshold) * 100)) : 0
  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text><strong><span fg={clr("free", theme)}>◻</span> Free Space — {fmt(seg.tokens)} tokens</strong></text>
      <text> </text>
      <text>Context window: {fmt(ctxLen)}</text>
      <text>Used: {fmt(used)} ({Math.round((used / ctxLen) * 100)}%)</text>
      <text>Available: {fmt(seg.tokens)} ({seg.percent.toFixed(1)}%)</text>
      <text> </text>
      {comp ? (
        <>
          <text><strong>Compression</strong></text>
          <text>{comp.enabled ? "✓ Enabled" : "✗ Disabled"} · threshold {Math.round(comp.threshold * 100)}% ({fmt(threshold)})</text>
          <text>{bar(pct)} {pct}%</text>
          <text>Protect last {comp.protect_last_n} messages · target ratio {Math.round(comp.target_ratio * 100)}%</text>
          {comp.summary_model ? <text>Summary model: {comp.summary_model}</text> : null}
        </>
      ) : null}
    </scrollbox>
  )
})

// ─── Main Component ──────────────────────────────────────────────────

export const Context = memo(({ client, messages = [], visible = true }: Props) => {
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null)
  const [wire, setWire] = useState<Wire>({ input: 0, output: 0, total: 0, calls: 0 })
  const wireRef = useRef(wire)
  const { theme } = useTheme()
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [drilled, setDrilled] = useState<string | null>(null)
  const [sidx, setSidx] = useState(0)

  const refresh = useCallback(async () => {
    try { setHome(await snapshot()) } catch { /* partial */ }
  }, [])

  useEffect(() => {
    if (!visible) return
    refresh()
    const iv = setInterval(refresh, 10_000)
    return () => clearInterval(iv)
  }, [refresh, visible])

  useEffect(() => {
    if (!client) return
    const onDone = (data: { reason: string; usage?: TokenUsage }) => {
      if (!data.usage) return
      const next: Wire = {
        input: wireRef.current.input + data.usage.prompt_tokens,
        output: wireRef.current.output + data.usage.completion_tokens,
        total: wireRef.current.total + data.usage.total_tokens,
        calls: wireRef.current.calls + 1,
      }
      wireRef.current = next
      setWire(next)
    }
    client.on("done", onDone)
    return () => { client.removeListener("done", onDone) }
  }, [client])

  // Derived
  const sessions = home?.recentSessions ?? []
  const session: SessionRow | undefined = sessions[sidx]
  const model = session?.model ?? home?.config?.model?.default ?? "unknown"
  const ctxLen = resolveCtx(model)

  const live = session
    ? Object.values(home?.liveSessions ?? {}).find(ls => ls.session_id === session.id)
    : undefined

  const lastPrompt = live?.last_prompt_tokens ?? 0
  const fill = wire.calls > 0 ? wire.input : lastPrompt > 0 ? lastPrompt : (session?.input_tokens ?? 0)
  const cumulative = wire.calls === 0 && lastPrompt === 0 && (session?.input_tokens ?? 0) > 0
  const output = wire.calls > 0 ? wire.output : (session?.output_tokens ?? 0)
  const pct = ctxLen > 0 ? Math.round((fill / ctxLen) * 100) : 0
  const st = status(pct, theme)
  const gateway = home?.gateway?.platforms?.api_server?.state === "connected"

  // Parse + build
  const sections = useMemo(() => parse(home?.systemPrompt?.text ?? ""), [home?.systemPrompt?.text])
  const convTok = useMemo(() => est(messages.filter(m => m.role !== "system").map(m => msgText(m)).join("")), [messages])

  const top = useMemo(() => build({
    contextLength: ctxLen,
    inputTokens: fill,
    sections,
    conversationTokens: convTok,
    tools: home?.toolsInfo?.tools ?? [],
  }), [ctxLen, fill, sections, convTok, home?.toolsInfo?.tools])

  // Current view: top-level or drilled
  const drilledGroup = drilled ? top.find(s => s.id === drilled) : null
  const view = drilledGroup ? drill(drilledGroup) : top
  const grid = useMemo(
    () => buildCells(view, drilledGroup ? drilledGroup.children?.[0]?.id ?? "other" : "free"),
    [view, drilledGroup],
  )

  // Helpers
  const findSeg = (id: string) => {
    if (drilledGroup) return view.find(s => s.id === id)
    return top.find(s => s.id === id)
  }

  const memEntries = useMemo(() => (home?.memory?.content ?? "").split("§").map(s => s.trim()).filter(Boolean), [home?.memory?.content])
  const userEntries = useMemo(() => (home?.userProfile?.content ?? "").split("§").map(s => s.trim()).filter(Boolean), [home?.userProfile?.content])

  // Click handler
  const click = (id: string) => {
    // Already drilled — clicking selects detail or deselects
    if (drilled) {
      setSelected(selected === id ? null : id)
      return
    }
    // Top level — if group with children, drill in
    const seg = top.find(s => s.id === id)
    if (seg?.children && seg.children.length > 0) {
      setDrilled(id)
      setSelected(null)
      return
    }
    // Leaf at top level — toggle detail
    setSelected(selected === id ? null : id)
  }

  const back = () => {
    setDrilled(null)
    setSelected(null)
  }

  // Detail panel router
  const detail = () => {
    if (!selected) return null
    const seg = findSeg(selected)
    if (!seg) return null

    if (selected === "memory" && home?.memory) {
      return <MemoryPanel seg={seg} theme={theme} label="Agent Notes" chars={home.memory.charCount} limit={home.memory.charLimit} pct={home.memory.usagePercent} entries={memEntries} source={home.memory.source} />
    }
    if (selected === "user" && home?.userProfile) {
      return <MemoryPanel seg={seg} theme={theme} label="User Profile" chars={home.userProfile.charCount} limit={home.userProfile.charLimit} pct={home.userProfile.usagePercent} entries={userEntries} source={home.userProfile.source} />
    }
    if (selected === "skills") return <SkillsPanel seg={seg} theme={theme} />
    if (selected === "tools" && home?.toolsInfo) return <ToolsPanel seg={seg} theme={theme} tools={home.toolsInfo.tools} />
    if (selected === "conversation") return <ConvPanel seg={seg} theme={theme} messages={messages} output={output} />
    if (selected === "free") return <FreePanel seg={seg} theme={theme} ctxLen={ctxLen} home={home} />
    return <SectionPanel seg={seg} theme={theme} />
  }

  // Breakdown panel
  const breakdown = () => (
    <box borderStyle="single" padding={1} marginBottom={1}>
      <text>
        <strong>Breakdown</strong>
        {drilledGroup ? (
          <span fg={theme.info}> · {drilledGroup.label} ({fmt(drilledGroup.tokens)} tok)</span>
        ) : (
          <span fg={theme.info}> (click group to expand)</span>
        )}
      </text>
      {view.filter(s => s.tokens > 0).map(s => (
        <text key={s.id}>
          <span fg={clr(s.id, theme)}>{s.id === "free" ? "◻" : "◼"}</span>{" "}
          {s.label} — {fmt(s.tokens)} ({s.percent.toFixed(1)}%)
          {s.children ? <span fg={theme.textMuted}> ▸</span> : null}
        </text>
      ))}
      {output > 0 && !drilled ? (
        <text><span fg={theme.success}>◼</span> Output — {fmt(output)} tokens</text>
      ) : null}
    </box>
  )

  // Session panel
  const sessionPanel = () => (
    <box borderStyle="single" padding={1}>
      <text><strong>Session</strong><span fg={theme.textMuted}> ({sidx + 1}/{sessions.length || 1})</span></text>
      {session ? (
        <>
          <text>{session.model?.split("/").pop() ?? "?"} · {session.sessionSource} · {session.message_count} msgs · {session.tool_call_count} tools</text>
          <text>Total in: {fmt(session.input_tokens)} · out: {fmt(session.output_tokens)} · cache: {fmt(session.cache_read_tokens)}</text>
          {live ? <text>Context fill: {fmt(live.last_prompt_tokens)}</text> : null}
          {session.estimated_cost_usd != null ? <text>Cost: ${session.estimated_cost_usd.toFixed(2)}</text> : null}
        </>
      ) : null}
      <text>
        <span fg={st.color}>{st.label}</span>{" · "}
        <span fg={gateway ? theme.success : theme.error}>{gateway ? "●" : "○"} gateway</span>
        {" · "}Skills: {home?.skills?.length ?? "?"}
      </text>
      {sessions.length > 1 ? (
        <box flexDirection="row" height={1} marginTop={1}>
          <box onMouseDown={() => setSidx(Math.max(0, sidx - 1))}>
            <text fg={sidx > 0 ? theme.info : theme.textMuted}>◀ prev</text>
          </box>
          <text>  </text>
          <box onMouseDown={() => setSidx(Math.min(sessions.length - 1, sidx + 1))}>
            <text fg={sidx < sessions.length - 1 ? theme.info : theme.textMuted}>next ▶</text>
          </box>
        </box>
      ) : null}
    </box>
  )

  // Overview (no detail selected)
  const overview = () => (
    <>
      {breakdown()}
      {home?.memory && home?.userProfile ? (
        <box borderStyle="single" padding={1} marginBottom={1}>
          <text><strong>Memory</strong></text>
          <text>Notes: {home.memory.charCount.toLocaleString()} / {home.memory.charLimit.toLocaleString()} ({home.memory.usagePercent}%){home.memory.usagePercent >= 95 ? " ⚠" : ""}</text>
          <text>Profile: {home.userProfile.charCount.toLocaleString()} / {home.userProfile.charLimit.toLocaleString()} ({home.userProfile.usagePercent}%){home.userProfile.usagePercent >= 95 ? " ⚠" : ""}</text>
        </box>
      ) : null}
      {sessionPanel()}
    </>
  )



  return (
    <box flexGrow={1} flexDirection="column" padding={1}>
      {/* Header + breadcrumb */}
      <box marginBottom={1}>
        <text>
          <strong>Context Window</strong>
          <span> {fmt(fill)} / {fmt(ctxLen)} ({pct}%)</span>
          {drilled ? (
            <>
              <span fg={theme.textMuted}> · </span>
              <span fg={theme.info}>{drilledGroup?.label}</span>
              {selected ? <span fg={theme.textMuted}> · {findSeg(selected)?.label}</span> : null}
            </>
          ) : null}
          {!drilled && !selected && wire.calls === 0 && fill === 0 ? <span fg={theme.warning}> [no data]</span> : null}
          {!drilled && !selected && cumulative ? <span fg={theme.warning}> [cumulative — not current fill]</span> : null}
          {!drilled && !selected && wire.calls === 0 && !cumulative && fill > 0 ? <span fg={theme.info}> [live session]</span> : null}
        </text>
      </box>

      {/* Grid + right panel */}
      <box flexDirection="row">
        <box flexDirection="column" marginRight={2} flexShrink={0}>
          {/* Back button when drilled */}
          {drilled ? (
            <box height={1} marginBottom={1} onMouseDown={back}>
              <text fg={theme.info}>◀ Back to overview</text>
            </box>
          ) : null}
          <box borderStyle="single" paddingTop={1} paddingX={2}>
            {[...Array(COLS)].map((_, row) => (
              <box key={row} flexDirection="row" height={1}>
                {[...Array(COLS)].map((_, col) => {
                  const cell = grid[row * COLS + col]
                  const hl = hovered === cell.id || selected === cell.id
                  return (
                    <box
                      height={1} width={2} key={col}
                      backgroundColor={hl ? clr(cell.id, theme) : undefined}
                      onMouseOver={() => setHovered(cell.id)}
                      onMouseOut={() => setHovered(null)}
                      onMouseDown={() => click(cell.id)}
                    >
                      <text fg={clr(cell.id, theme)}>
                        {cell.id === "free" ? "◻" : "◼"}
                      </text>
                    </box>
                  )
                })}
              </box>
            ))}
          </box>
        </box>

        <box flexDirection="column" flexGrow={1}>
          {selected ? detail() : overview()}
        </box>
      </box>
    </box>
  )
})
