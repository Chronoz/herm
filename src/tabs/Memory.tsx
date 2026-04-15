import { useState, useEffect, useCallback, memo } from "react"
import {
  readMemoryProviders,
  type HermesHomeSnapshot,
  type MemoryProviderInfo,
  type MemoryFileInfo,
} from "../utils/hermes-home"
import { snapshot } from "../utils/cache"
import { useTheme, type Theme } from "../theme"

// ─── Helpers ──────────────────────────────────────────────────────────

const REFRESH = 15_000

function usageColor(pct: number, theme: Theme): string {
  if (pct >= 95) return theme.error.toString()
  if (pct >= 80) return theme.warning.toString()
  return theme.success.toString()
}

function bar(pct: number, w: number): string {
  const filled = Math.round((pct / 100) * w)
  return "█".repeat(filled) + "░".repeat(w - filled)
}

const DESC: Record<string, string> = {
  builtin: "File-based §-delimited entries (MEMORY.md + USER.md). Always active.",
  mem0: "Server-side LLM fact extraction with semantic search and reranking.",
  honcho: "AI-native cross-session user modeling with dialectic Q&A.",
  hindsight: "Knowledge graph with entity resolution and multi-strategy retrieval.",
  holographic: "Local SQLite fact store with FTS5, trust scoring, HRR retrieval.",
  openviking: "Session-managed memory with tiered retrieval.",
  retaindb: "Cloud memory API with hybrid search and 7 memory types.",
  byterover: "Persistent knowledge tree via brv CLI.",
  supermemory: "Semantic long-term memory with profile recall and session ingest.",
}

const ALL = ["builtin", "mem0", "honcho", "hindsight", "holographic", "openviking", "retaindb", "byterover", "supermemory"]

// ─── Component ────────────────────────────────────────────────────────

export const Memory = memo(({ visible = true }: { visible?: boolean }) => {
  const { theme } = useTheme()
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null)
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([])
  const [selected, setSelected] = useState(0)

  const refresh = useCallback(async () => {
    const snap = await snapshot()
    setHome(snap)
    const active = snap.config?.memory?.provider || ""
    const found = await readMemoryProviders(active)
    const merged: MemoryProviderInfo[] = ALL.map(name => {
      const existing = found.find(p => p.name === name)
      if (existing) return existing
      return { name, active: name === "builtin" || name === active, config: {} }
    })
    setProviders(merged)
  }, [])

  useEffect(() => {
    if (!visible) return
    refresh()
    const id = setInterval(refresh, REFRESH)
    return () => clearInterval(id)
  }, [refresh, visible])

  const cfg = home?.config?.memory
  const current = providers[selected]
  const active = cfg?.provider || ""

  return (
    <box flexGrow={1} flexDirection="row" gap={1} padding={1}>
      {/* Left: Provider list */}
      <box
        flexDirection="column"
        width={40}
        backgroundColor={theme.backgroundPanel}
        border
        borderColor={theme.borderSubtle}
        padding={1}
      >
        <box height={1}>
          <text fg={theme.primary}>
            <strong>Memory Providers</strong>
          </text>
        </box>
        <box height={1} />
        <scrollbox scrollY flexGrow={1}>
          {providers.map((p, i) => {
            const sel = i === selected
            const on = p.name === "builtin" || p.name === active
            const has = Object.keys(p.config).length > 0
            const dot = on ? "●" : has ? "◐" : "○"
            const color = on ? theme.success : has ? theme.warning : theme.textMuted
            const tag = on ? "active" : has ? "configured" : ""
            return (
              <box
                key={p.name}
                height={1}
                backgroundColor={sel ? theme.backgroundElement : undefined}
                onMouseDown={() => setSelected(i)}
                onMouseOver={() => setSelected(i)}
              >
                <text>
                  <span fg={color}>{dot} </span>
                  <span fg={sel ? theme.accent : theme.text}>{p.name}</span>
                  {tag ? <span fg={color}> ({tag})</span> : null}
                </text>
              </box>
            )
          })}
        </scrollbox>
      </box>

      {/* Right: Selected provider detail */}
      <box
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.backgroundPanel}
        border
        borderColor={theme.borderSubtle}
        padding={1}
      >
        {current ? (
          <ProviderDetail
            provider={current}
            active={active}
            cfg={cfg}
            home={home}
            theme={theme}
          />
        ) : (
          <text fg={theme.textMuted}>Select a provider</text>
        )}
      </box>
    </box>
  )
})

// ─── Provider Detail ──────────────────────────────────────────────────

type MemoryCfg = {
  memory_enabled: boolean
  user_profile_enabled: boolean
  memory_char_limit: number
  user_char_limit: number
  provider: string
  nudge_interval: number
  flush_min_turns: number
}

type DetailProps = {
  provider: MemoryProviderInfo
  active: string
  cfg: MemoryCfg | undefined
  home: HermesHomeSnapshot | null
  theme: Theme
}

const ProviderDetail = ({ provider, active, cfg, home, theme }: DetailProps) => {
  const on = provider.name === "builtin" || provider.name === active

  return (
    <scrollbox scrollY flexGrow={1}>
      <box flexDirection="column">
        {/* Header */}
        <box height={1}>
          <text>
            <span fg={theme.primary}><strong>{provider.name}</strong></span>
            {on
              ? <span fg={theme.success}> ● active</span>
              : <span fg={theme.textMuted}> ○ inactive</span>}
          </text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={theme.textMuted}>{DESC[provider.name] || "Memory provider"}</text>
        </box>
        <box height={1} />

        {/* Builtin-specific: capacity bars */}
        {provider.name === "builtin" ? (
          <BuiltinDetail cfg={cfg} home={home} theme={theme} />
        ) : null}

        {/* External provider config from local files */}
        {provider.name !== "builtin" && on && cfg ? (
          <ExternalActiveDetail cfg={cfg} theme={theme} />
        ) : null}

        {/* Config entries from JSON */}
        {Object.keys(provider.config).length > 0 ? (
          <ConfigSection config={provider.config} theme={theme} />
        ) : provider.name !== "builtin" ? (
          <box height={1} marginTop={1}>
            <text fg={theme.textMuted}>No local config found. Run `hermes memory setup` to configure.</text>
          </box>
        ) : null}
      </box>
    </scrollbox>
  )
}

// ─── Builtin Detail ───────────────────────────────────────────────────

type BuiltinProps = {
  cfg: MemoryCfg | undefined
  home: HermesHomeSnapshot | null
  theme: Theme
}

const BuiltinDetail = ({ cfg, home, theme }: BuiltinProps) => (
  <box flexDirection="column">
    {cfg ? (
      <>
        <box height={1}>
          <text>
            <span fg={theme.textMuted}>Notes: </span>
            <span fg={cfg.memory_enabled ? theme.success : theme.error}>{cfg.memory_enabled ? "enabled" : "disabled"}</span>
            <span fg={theme.textMuted}> · Profile: </span>
            <span fg={cfg.user_profile_enabled ? theme.success : theme.error}>{cfg.user_profile_enabled ? "enabled" : "disabled"}</span>
          </text>
        </box>
        <box height={1} />
      </>
    ) : null}
    <CapacityBar title="Notes (MEMORY.md)" info={home?.memory ?? null} theme={theme} />
    <box height={1} />
    <CapacityBar title="Profile (USER.md)" info={home?.userProfile ?? null} theme={theme} />
  </box>
)

// ─── External Active Detail ───────────────────────────────────────────

const ExternalActiveDetail = ({ cfg, theme }: { cfg: MemoryCfg; theme: Theme }) => (
  <box flexDirection="column" marginBottom={1}>
    <box height={1}>
      <text fg={theme.accent}><strong>Agent Settings</strong></text>
    </box>
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>Nudge interval: </span>
        <span fg={theme.text}>every {cfg.nudge_interval} turns</span>
      </text>
    </box>
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>Flush threshold: </span>
        <span fg={theme.text}>after {cfg.flush_min_turns} turns</span>
      </text>
    </box>
    <box height={1} />
  </box>
)

// ─── Config Section ───────────────────────────────────────────────────

const ConfigSection = ({ config, theme }: { config: Record<string, string | number | boolean>; theme: Theme }) => (
  <box flexDirection="column">
    <box height={1}>
      <text fg={theme.accent}><strong>Local Configuration</strong></text>
    </box>
    <box height={1} />
    {Object.entries(config).map(([k, v]) => (
      <box key={k} height={1}>
        <text>
          <span fg={theme.textMuted}>{k}: </span>
          <span fg={theme.text}>{String(v)}</span>
        </text>
      </box>
    ))}
  </box>
)

// ─── Capacity Bar ─────────────────────────────────────────────────────

type CapacityProps = {
  title: string
  info: MemoryFileInfo | null
  theme: Theme
}

const CapacityBar = ({ title, info, theme }: CapacityProps) => {
  if (!info) {
    return (
      <box height={1}>
        <text fg={theme.textMuted}>{title}: unavailable</text>
      </box>
    )
  }

  const color = usageColor(info.usagePercent, theme)

  return (
    <box flexDirection="column">
      <box height={1}>
        <text>
          <span fg={theme.text}>{title}</span>
          <span fg={theme.textMuted}> · {info.entryCount} entries</span>
        </text>
      </box>
      <box height={1}>
        <text>
          <span fg={color}>{bar(info.usagePercent, 20)}</span>
          <span fg={theme.textMuted}> {info.charCount}/{info.charLimit} ({info.usagePercent}%)</span>
        </text>
      </box>
    </box>
  )
}
