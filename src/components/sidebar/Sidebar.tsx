import { useState, useEffect, useCallback, memo, type ReactNode } from "react"
import { AnimatedAvatar } from "../avatar/AnimatedAvatar"
import { useTheme } from "../../theme"
import type { AvatarState } from "../avatar/states"
import type { SessionInfo } from "../../utils/gateway-types"
import type { HermesHomeSnapshot, MemoryFileInfo } from "../../utils/hermes-home"
import { snapshot } from "../../utils/cache"

// The pillar body carries what used to be the Overview tab, broken into
// collapsible sections. Identity uses live `SessionInfo` from the gateway
// (model/cwd/tool+skill counts); everything else reads the cached
// ~/.hermes snapshot. Snapshot is re-read on section toggle — no
// polling timer.

type SectionId = "identity" | "stats" | "memory" | "recent" | "warnings"

const WIDTH = 48
const PAD_L = 12

const num = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
  : String(n)

const money = (usd: number) => usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`

const ago = (t: number) => {
  const s = Math.floor(Date.now() / 1000 - t)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const bar = (pct: number, w: number) => {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)
  return "▓".repeat(n) + "░".repeat(w - n)
}

const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

const countToolsets = (d?: Record<string, string[]>) =>
  d ? Object.values(d).reduce((n, a) => n + a.length, 0) : 0

// ─── Primitives (pillar-colored) ─────────────────────────────────────

const Section = memo((props: {
  id: SectionId; title: string; hint?: string
  open: boolean; onToggle: (id: SectionId) => void
  children: ReactNode
}) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  return (
    <box flexDirection="column" marginBottom={props.open ? 1 : 0}>
      <box height={1}
           onMouseDown={() => props.onToggle(props.id)}
           onMouseOver={() => setHover(true)}
           onMouseOut={() => setHover(false)}>
        <text>
          <span fg={hover ? theme.hermBodyText : theme.hermBodyTextMuted}>
            {props.open ? "▾ " : "▸ "}
          </span>
          <span fg={theme.hermBodyText}><strong>{props.title}</strong></span>
          {props.hint ? <span fg={theme.hermBodyTextMuted}>{`  ${props.hint}`}</span> : null}
        </text>
      </box>
      {props.open ? <box flexDirection="column">{props.children}</box> : null}
    </box>
  )
})

const Row = (props: { label: string; value: string; strong?: boolean }) => {
  const theme = useTheme().theme
  return (
    <box height={1}>
      <text>
        <span fg={theme.hermBodyTextMuted}>{`  ${props.label.padEnd(PAD_L)}`}</span>
        {props.strong
          ? <span fg={theme.hermBodyText}><strong>{trunc(props.value, WIDTH - PAD_L - 4)}</strong></span>
          : <span fg={theme.hermBodyText}>{trunc(props.value, WIDTH - PAD_L - 4)}</span>}
      </text>
    </box>
  )
}

const Gauge = (props: { label: string; info: MemoryFileInfo }) => {
  const theme = useTheme().theme
  const m = props.info
  return (
    <>
      <Row label={props.label} value={`${m.entryCount} · ${num(m.charCount)}/${num(m.charLimit)}`} />
      <box height={1}>
        <text>
          <span fg={theme.hermBodyTextMuted}>{"  " + " ".repeat(PAD_L)}</span>
          <span fg={theme.hermBodyText}>{bar(m.usagePercent, 18)}</span>
          <span fg={theme.hermBodyTextMuted}>{` ${m.usagePercent}%`}</span>
        </text>
      </box>
    </>
  )
}

// ─── Main ────────────────────────────────────────────────────────────

export const Sidebar = memo((props: {
  agentState?: AvatarState
  info?: SessionInfo | null
}) => {
  const theme = useTheme().theme
  const state = props.agentState ?? "idle"
  const info = props.info

  const [snap, setSnap] = useState<HermesHomeSnapshot | null>(null)
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(["identity"]))

  const load = useCallback(() => { snapshot().then(setSnap).catch(() => {}) }, [])
  useEffect(load, [load])

  const toggle = useCallback((id: SectionId) => {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    load()
  }, [load])

  const sessions = snap?.recentSessions ?? []
  const totals = sessions.reduce(
    (a, r) => {
      a.msgs += r.message_count
      a.tools += r.tool_call_count
      a.tok += r.input_tokens + r.output_tokens
      a.cost += r.estimated_cost_usd ?? 0
      return a
    },
    { msgs: 0, tools: 0, tok: 0, cost: 0 },
  )
  const errs = snap?.errors ?? []

  return (
    <box width={WIDTH} flexDirection="column">
      {/* Avatar (bust) */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar state={state} />
      </box>

      {/* Body (pillar) */}
      <box padding={1} flexDirection="column" flexGrow={1}
           backgroundColor={theme.hermBody} overflow="hidden">

        <Section id="identity" title="Identity" open={open.has("identity")} onToggle={toggle}>
          <Row label="Agent" value="Hermes" strong />
          <Row label="Model" value={info?.model ?? snap?.config?.model.default ?? "—"} />
          <Row label="Provider" value={snap?.config?.model.provider ?? "—"} />
          {info?.cwd ? <Row label="cwd" value={info.cwd} /> : null}
          <Row label="Tools" value={String(countToolsets(info?.tools))} />
          <Row label="Skills" value={String(countToolsets(info?.skills) || (snap?.skills.length ?? 0))} />
        </Section>

        <Section id="stats" title="Stats"
                 hint={snap ? `${sessions.length} sessions` : undefined}
                 open={open.has("stats")} onToggle={toggle}>
          <Row label="Sessions" value={String(sessions.length)} />
          <Row label="Messages" value={num(totals.msgs)} />
          <Row label="Tool calls" value={num(totals.tools)} />
          <Row label="Tokens" value={num(totals.tok)} />
          <Row label="Est. cost" value={money(totals.cost)} />
        </Section>

        <Section id="memory" title="Memory"
                 hint={snap?.memory ? `${snap.memory.usagePercent}%` : undefined}
                 open={open.has("memory")} onToggle={toggle}>
          {snap?.memory ? <Gauge label="Notes" info={snap.memory} /> : <Row label="Notes" value="—" />}
          {snap?.userProfile ? <Gauge label="Profile" info={snap.userProfile} /> : <Row label="Profile" value="—" />}
        </Section>

        <Section id="recent" title="Recent"
                 hint={sessions[0] ? ago(sessions[0].started_at) : undefined}
                 open={open.has("recent")} onToggle={toggle}>
          {sessions.length === 0
            ? <Row label="" value="No sessions" />
            : sessions.slice(0, 5).map(s => (
                <box key={s.id} height={1}>
                  <text>
                    <span fg={theme.hermBodyTextMuted}>{"  • "}</span>
                    <span fg={theme.hermBodyText}>{trunc(s.title ?? s.id.slice(0, 8), 28).padEnd(28)}</span>
                    <span fg={theme.hermBodyTextMuted}>{` ${ago(s.started_at).padStart(4)}`}</span>
                  </text>
                </box>
              ))}
        </Section>

        {errs.length > 0 ? (
          <Section id="warnings" title="Warnings" hint={String(errs.length)}
                   open={open.has("warnings")} onToggle={toggle}>
            {errs.map((e, i) => (
              <box key={i} minHeight={1}>
                <text fg={theme.hermBodyText} wrapMode="word">{`  ⚠ ${e}`}</text>
              </box>
            ))}
          </Section>
        ) : null}

        <box flexGrow={1} />
        <box height={1} alignItems="center">
          <text fg={theme.hermBodyTextMuted}>{state}</text>
        </box>
      </box>
    </box>
  )
})
