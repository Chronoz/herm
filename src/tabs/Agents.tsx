import { useState, useEffect, useCallback, useRef, memo } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { RGBA } from "@opentui/core"
import { useGateway } from "../app/gateway"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import type {
  ProfileInfo, ProfileListResponse,
  AgentProcess, AgentsListResponse,
} from "../utils/gateway-types"

// Two panes:
//   Profiles (left)  — hermes_cli/profiles.py via profile.* RPCs. Each
//     profile is an isolated HERMES_HOME (config, env, memory, skills).
//     Switching profiles = restarting the gateway under a new HERMES_HOME,
//     which would sever this session — so "switch" is deliberately NOT
//     offered here. Create/delete only.
//   Running (right)  — agents.list RPC: background processes + subagent
//     tasks. Kill via process.stop.

// ─── Shared ──────────────────────────────────────────────────────────

const KV = (props: { label: string; value: string; fg?: RGBA }) => {
  const theme = useTheme().theme
  return (
    <box height={1} flexDirection="row">
      <box width={11} flexShrink={0}><text fg={theme.textMuted}>{props.label}</text></box>
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <text fg={props.fg ?? theme.text}>{props.value}</text>
      </box>
    </box>
  )
}

const dur = (s: number) =>
  s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  : s >= 60 ? `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`
  : `${Math.floor(s)}s`

// ─── Profiles pane ───────────────────────────────────────────────────

const ProfileRow = memo((props: {
  p: ProfileInfo; idx: number; selected: boolean
  onHover: (i: number) => void; onDelete: (i: number) => void
}) => {
  const theme = useTheme().theme
  const { p, idx: i } = props
  const [x, setX] = useState(false)
  return (
    <box flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseOver={() => props.onHover(i)}>
      <box width={2}><text fg={props.selected ? theme.primary : theme.text}>
        {props.selected ? "▸ " : "  "}
      </text></box>
      <box flexGrow={1} minWidth={8} height={1} overflow="hidden">
        <text>
          <span fg={p.is_active ? theme.accent : theme.text}>
            {p.is_active ? <strong>{p.name}</strong> : p.name}
          </span>
          {p.gateway_running ? <span fg={theme.success}>{" ●"}</span> : null}
        </text>
      </box>
      <box width={4} height={1}>
        <text fg={theme.textMuted}>{p.is_active ? " you" : ""}</text>
      </box>
      {p.is_default || p.is_active ? <box width={3} /> : (
        <box width={3}
             onMouseDown={(e) => { e.stopPropagation(); props.onDelete(i) }}
             onMouseOver={() => setX(true)} onMouseOut={() => setX(false)}>
          <text fg={x ? theme.error : theme.textMuted}>{" ✕"}</text>
        </box>
      )}
    </box>
  )
})

const ProfileDetail = memo((props: { p: ProfileInfo }) => {
  const theme = useTheme().theme
  const p = props.p
  return (
    <scrollbox scrollY flexGrow={1}>
      <box flexDirection="column" width="100%">
        <box height={1}><text fg={theme.accent}><strong>{p.name}</strong></text></box>
        <box height={1} />
        <KV label="Path" value={p.path} />
        <KV label="Active" value={p.is_active ? "yes (this session)" : "no"}
            fg={p.is_active ? theme.accent : theme.textMuted} />
        <KV label="Model" value={p.model ?? "—"} />
        <KV label="Provider" value={p.provider ?? "—"} />
        <KV label="Skills" value={String(p.skill_count)} />
        <KV label="Env" value={p.has_env ? "configured" : "—"} />
        <KV label="Gateway" value={p.gateway_running ? "running" : "stopped"}
            fg={p.gateway_running ? theme.success : theme.textMuted} />
        {p.has_alias ? <KV label="Alias" value={`${p.name} (shell)`} /> : null}
        {p.soul_preview ? <>
          <box height={1} />
          <box height={1}><text fg={theme.textMuted}>SOUL.md</text></box>
          <box minHeight={1}>
            <text fg={theme.textMuted} wrapMode="word">{p.soul_preview}</text>
          </box>
        </> : null}
      </box>
    </scrollbox>
  )
})

const CreateProfile = (props: {
  existing: string[]
  onSubmit: (name: string, cloneFrom: string | null) => void
  onCancel: () => void
}) => {
  const theme = useTheme().theme
  const [name, setName] = useState("")
  const [cloneIdx, setCloneIdx] = useState(0)
  const options = ["(fresh)", ...props.existing]
  const valid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name) && !props.existing.includes(name)

  useKeyboard((key) => {
    if (key.name === "escape") return props.onCancel()
    if (key.name === "return") {
      if (!valid) return
      return props.onSubmit(name, cloneIdx === 0 ? null : options[cloneIdx])
    }
    if (key.name === "up") return setCloneIdx(i => Math.max(0, i - 1))
    if (key.name === "down") return setCloneIdx(i => Math.min(options.length - 1, i + 1))
    if (key.name === "backspace") return setName(n => n.slice(0, -1))
    if (key.raw && key.raw.length === 1 && /[a-z0-9_-]/.test(key.raw))
      return setName(n => n + key.raw)
  })

  return (
    <box flexDirection="column" width={54}>
      <box height={1}><text fg={theme.primary}><strong>New Profile</strong></text></box>
      <box height={1} />
      <box height={1} flexDirection="row">
        <box width={11}><text fg={theme.textMuted}>Name</text></box>
        <text>
          <span fg={valid || !name ? theme.text : theme.error}>{name}</span>
          <span fg={theme.accent}>█</span>
        </text>
      </box>
      <box height={1}><text fg={theme.textMuted}>  a-z 0-9 _ -  ·  lowercase</text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Clone from  (↑↓)</text></box>
      {options.map((o, i) => (
        <box key={o} height={1}>
          <text fg={i === cloneIdx ? theme.accent : theme.text}>
            {i === cloneIdx ? "▸ " : "  "}{o}
          </text>
        </box>
      ))}
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {valid ? "Enter create  ·  Esc cancel" : name ? "invalid name" : "type a name"}
      </text></box>
    </box>
  )
}

const ConfirmDeleteProfile = (props: { name: string; onConfirm: () => void; onCancel: () => void }) => {
  const theme = useTheme().theme
  useKeyboard((key) => {
    if (key.name === "y") props.onConfirm()
    if (key.name === "n" || key.name === "escape") props.onCancel()
  })
  return (
    <box flexDirection="column" width={54}>
      <box height={1}><text fg={theme.warning}><strong>Delete Profile?</strong></text></box>
      <box height={1} />
      <box minHeight={1}><text wrapMode="word" fg={theme.text}>
        {`'${props.name}' — config, env, memory, skills, and sessions will be removed. This cannot be undone.`}
      </text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>[y] delete   [n] cancel</text></box>
    </box>
  )
}

// ─── Running pane ────────────────────────────────────────────────────

const ProcRow = memo((props: {
  proc: AgentProcess; idx: number; selected: boolean
  onHover: (i: number) => void; onKill: (i: number) => void
}) => {
  const theme = useTheme().theme
  const { proc: p, idx: i } = props
  const [x, setX] = useState(false)
  const st =
    p.status === "running" ? theme.success
    : p.status === "error" ? theme.error
    : theme.textMuted
  return (
    <box flexDirection="row" height={1}
         backgroundColor={props.selected ? theme.backgroundElement : undefined}
         onMouseOver={() => props.onHover(i)}>
      <box width={2}><text fg={props.selected ? theme.primary : theme.text}>
        {props.selected ? "▸ " : "  "}
      </text></box>
      <box width={10} height={1} overflow="hidden">
        <text fg={theme.textMuted}>{p.session_id}</text>
      </box>
      <box flexGrow={1} minWidth={8} height={1} overflow="hidden">
        <text fg={theme.text}>{p.command}</text>
      </box>
      <box width={9} height={1}><text fg={st}>{p.status}</text></box>
      <box width={8} height={1} flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{dur(p.uptime)}</text>
      </box>
      <box width={3}
           onMouseDown={(e) => { e.stopPropagation(); props.onKill(i) }}
           onMouseOver={() => setX(true)} onMouseOut={() => setX(false)}>
        <text fg={x ? theme.error : theme.textMuted}>{" ✕"}</text>
      </box>
    </box>
  )
})

// ─── Main ────────────────────────────────────────────────────────────

type Pane = "profiles" | "running"
type Props = { focused?: boolean }

export const Agents = memo((props: Props) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()

  const [pane, setPane] = useState<Pane>("profiles")
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [procs, setProcs] = useState<AgentProcess[]>([])
  const [pSel, setPSel] = useState(0)
  const [rSel, setRSel] = useState(0)
  const [err, setErr] = useState("")

  const live = useRef({ profiles, procs })
  live.current = { profiles, procs }

  const load = useCallback(() => {
    gw.request<ProfileListResponse>("profile.list")
      .then(r => { setProfiles(r.profiles); setErr("") })
      .catch((e: Error) => setErr(`profile.list: ${e.message}`))
    gw.request<AgentsListResponse>("agents.list")
      .then(r => setProcs(r.processes ?? []))
      .catch(() => {})
  }, [gw])

  useEffect(load, [load])

  // ── Stable callbacks ──────────────────────────────────────────────
  const pHover = useCallback((i: number) => setPSel(i), [])
  const rHover = useCallback((i: number) => setRSel(i), [])

  const pDelete = useCallback((i: number) => {
    const p = live.current.profiles[i]
    if (!p || p.is_default || p.is_active) return
    dialog.replace(
      <ConfirmDeleteProfile name={p.name}
        onConfirm={() => {
          dialog.clear()
          gw.request("profile.delete", { name: p.name })
            .then(() => { toast.show({ variant: "success", message: `Deleted '${p.name}'` }); load() })
            .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
        }}
        onCancel={() => dialog.clear()}
      />,
    )
  }, [gw, dialog, toast, load])

  const rKill = useCallback((i: number) => {
    const p = live.current.procs[i]
    if (!p) return
    gw.request("process.stop", { session_id: p.session_id })
      .then(() => { toast.show({ variant: "success", message: `Stopped ${p.session_id}` }); load() })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, toast, load])

  const create = useCallback(() => {
    dialog.replace(
      <CreateProfile
        existing={live.current.profiles.map(p => p.name)}
        onSubmit={(name, cloneFrom) => {
          dialog.clear()
          gw.request("profile.create", { name, clone_from: cloneFrom, clone_config: !!cloneFrom })
            .then(() => { toast.show({ variant: "success", message: `Created '${name}'` }); load() })
            .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
        }}
        onCancel={() => dialog.clear()}
      />,
    )
  }, [gw, dialog, toast, load])

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return
    if (key.name === "tab") return setPane(p => p === "profiles" ? "running" : "profiles")
    if (key.raw === "r") return load()
    if (pane === "profiles") {
      if (key.name === "up") return setPSel(s => Math.max(0, s - 1))
      if (key.name === "down") return setPSel(s => Math.min(profiles.length - 1, s + 1))
      if (key.raw === "n") return create()
      if (key.raw === "d" || key.name === "delete") return pDelete(pSel)
    } else {
      if (key.name === "up") return setRSel(s => Math.max(0, s - 1))
      if (key.name === "down") return setRSel(s => Math.min(procs.length - 1, s + 1))
      if (key.raw === "k" || key.name === "delete") return rKill(rSel)
    }
  })

  const selected = profiles[pSel]
  const dims = useTerminalDimensions()
  const wide = dims.width >= 130
  const showProfiles = wide || pane === "profiles"
  const showRunning = wide || pane === "running"

  return (
    <box flexDirection="row" flexGrow={1}>
      {/* ── Profiles ── */}
      {showProfiles ? (
      <box flexDirection="column" flexGrow={3} flexBasis={0} minWidth={0}
           border borderColor={pane === "profiles" ? theme.primary : theme.border}
           backgroundColor={theme.backgroundPanel} padding={1}>
        <box height={1} flexDirection="row" overflow="hidden">
          <box flexShrink={0}>
            <text fg={theme.primary}><strong>{`Profiles (${profiles.length})`}</strong></text>
          </box>
          <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
            <text fg={theme.textMuted}>
              {`  ↑↓ nav  n new  d delete  r refresh  Tab ${wide ? "→" : "↔"} running`}
            </text>
          </box>
        </box>
        {err ? <box height={1}><text fg={theme.error}>{`⚠ ${err}`}</text></box> : null}
        <box height={1} />
        <box flexDirection="row" flexGrow={1} minWidth={0}>
          <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={14}>
            <scrollbox scrollY flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
              {profiles.map((p, i) => (
                <ProfileRow key={p.name} p={p} idx={i} selected={i === pSel}
                  onHover={pHover} onDelete={pDelete} />
              ))}
            </scrollbox>
          </box>
          <box width={2} />
          <box flexDirection="column" flexGrow={2} flexBasis={0} minWidth={0}>
            {selected ? <ProfileDetail p={selected} />
              : <box height={1}><text fg={theme.textMuted}>No profiles</text></box>}
          </box>
        </box>
      </box>
      ) : null}

      {/* ── Running ── */}
      {showRunning ? (
      <box flexDirection="column" flexGrow={2} flexBasis={0} minWidth={0}
           border borderColor={pane === "running" ? theme.primary : theme.border}
           backgroundColor={theme.backgroundPanel} padding={1}>
        <box height={1} flexDirection="row" overflow="hidden">
          <box flexShrink={0}>
            <text fg={theme.primary}><strong>{`Running (${procs.length})`}</strong></text>
          </box>
          <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
            <text fg={theme.textMuted}>
              {`  ↑↓ nav  k kill  r refresh  Tab ${wide ? "→" : "↔"} profiles`}
            </text>
          </box>
        </box>
        <box height={1} />
        {procs.length === 0 ? (
          <box key="empty" flexGrow={1}>
            <text fg={theme.textMuted}>No background processes or subagents</text>
          </box>
        ) : (
          <scrollbox key="list" scrollY flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
            {procs.map((p, i) => (
              <ProcRow key={p.session_id} proc={p} idx={i} selected={i === rSel}
                onHover={rHover} onKill={rKill} />
            ))}
          </scrollbox>
        )}
      </box>
      ) : null}
    </box>
  )
})
