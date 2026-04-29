import { useState, useEffect, useCallback, memo, type ReactNode } from "react"
import { useGateway } from "../../app/gateway"
import { AnimatedAvatar } from "../avatar/AnimatedAvatar"
import type { ParsedEikon } from "../avatar/eikon"
import { useTheme } from "../../theme"
import type { AvatarState } from "../avatar/states"
import type { SessionInfo, PluginInfo } from "../../utils/gateway-types"
import type { Usage } from "../../types/message"
import { useGitBranch, rtrunc } from "../../utils/git"
import { Tail } from "../chat/ThoughtCloud"
import { ContextGauge } from "./ContextGauge"

// The pillar body carries a compact identity block + operational sections
// (MCP servers, plugins). Stats/Memory/Recent/Identity wrapper were removed
// — they duplicated dedicated tabs and cluttered the most-visible surface.

type SectionId = "mcp" | "plugins"

const WIDTH = 48
const PAD_L = 12

const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

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

// ─── Main ────────────────────────────────────────────────────────────

export const Sidebar = memo((props: {
  agentState?: AvatarState
  info?: SessionInfo | null
  usage?: Usage
  eikon?: ParsedEikon
  profile?: string
  title?: string
  cloud?: boolean
  pulse?: boolean
  onAvatar?: () => void
}) => {
  const theme = useTheme().theme
  const state = props.agentState ?? "idle"
  const info = props.info

  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set())

  const cwd = info?.cwd ?? process.cwd()
  const branch = useGitBranch(cwd)

  const gw = useGateway()
  useEffect(() => {
    gw.request<{ plugins: PluginInfo[] }>("plugins.list")
      .then(r => setPlugins(r.plugins ?? []))
      .catch(() => setPlugins([]))
  }, [gw])

  const toggle = useCallback((id: SectionId) => {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  return (
    <box width={WIDTH} flexDirection="column">
      {/* Avatar (bust) — also the anchor for the thought-cloud tail */}
      <box position="relative" flexDirection="column" height={24} overflow="hidden"
           onMouseDown={props.onAvatar}>
        <AnimatedAvatar state={state} eikon={props.eikon} />
        {props.cloud ? (
          <box position="absolute" left={0} top={0}>
            <Tail run={!!props.pulse} />
          </box>
        ) : null}
      </box>

      {/* Body (pillar) */}
      <box padding={1} flexDirection="column" flexGrow={1}
           backgroundColor={theme.hermBody} overflow="hidden">

        {/* Flat identity block — Title first (if set), then agent lineage. */}
        {props.title ? <Row label="Title" value={props.title} strong /> : null}
        <Row label="Agent" value="Hermes" strong />
        <Row label="Profile" value={props.profile ?? "default"}
             strong={!!props.profile && props.profile !== "default"} />
        <Row label="Model" value={info?.model ?? "—"} />
        {info?.cwd ? <Row label="cwd" value={info.cwd} /> : null}
        {branch ? <Row label="Branch" value={rtrunc(branch, WIDTH - PAD_L - 4)} /> : null}

        {(info?.mcp_servers?.length ?? 0) > 0 ? (() => {
          const srv = info!.mcp_servers!
          const ok = srv.filter(s => s.connected).length
          return (
            <Section id="mcp" title="MCP"
                     hint={`${ok}/${srv.length} up`}
                     open={open.has("mcp")} onToggle={toggle}>
              {srv.map(s => (
                <box key={s.name} height={1}>
                  <text>
                    <span fg={theme.hermBodyTextMuted}>{"  "}</span>
                    <span fg={s.connected ? theme.hermBodyText : theme.hermBodyTextMuted}>
                      {(s.connected ? "● " : "○ ") + trunc(s.name, 16).padEnd(16)}
                    </span>
                    <span fg={theme.hermBodyTextMuted}>
                      {s.connected ? ` ${s.transport} · ${s.tools}t` : " failed"}
                    </span>
                  </text>
                </box>
              ))}
            </Section>
          )
        })() : null}

        {plugins.length > 0 ? (() => {
          const on = plugins.filter(p => p.enabled).length
          return (
            <Section id="plugins" title="Plugins"
                     hint={`${on}/${plugins.length} on`}
                     open={open.has("plugins")} onToggle={toggle}>
              {plugins.map(p => (
                <box key={p.name} height={1}>
                  <text>
                    <span fg={theme.hermBodyTextMuted}>{"  "}</span>
                    <span fg={p.enabled ? theme.hermBodyText : theme.hermBodyTextMuted}>
                      {(p.enabled ? "● " : "○ ") + trunc(p.name, 16).padEnd(16)}
                    </span>
                    <span fg={theme.hermBodyTextMuted}>{` v${p.version ?? "?"}`}</span>
                  </text>
                </box>
              ))}
            </Section>
          )
        })() : null}

        <box flexGrow={1} />
        <ContextGauge info={info} usage={props.usage} width={WIDTH - 4} />
      </box>
    </box>
  )
})
