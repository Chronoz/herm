import { useState, useEffect, useCallback } from "react"
import {
  readHermesHome,
  readMemoryProviders,
  type HermesHomeSnapshot,
  type MemoryProviderInfo,
} from "../utils/hermes-home"
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
  builtin: "File-based §-delimited entries (MEMORY.md + USER.md)",
  mem0: "Server-side LLM fact extraction with semantic search and reranking",
  honcho: "AI-native cross-session user modeling with dialectic Q&A",
  hindsight: "Knowledge graph with entity resolution and multi-strategy retrieval",
  holographic: "Local SQLite fact store with FTS5, trust scoring, HRR retrieval",
  openviking: "Session-managed memory with tiered retrieval",
  retaindb: "Cloud memory API with hybrid search and 7 memory types",
  byterover: "Persistent knowledge tree via brv CLI",
  supermemory: "Semantic long-term memory with profile recall and session ingest",
}

// ─── Component ────────────────────────────────────────────────────────

export const Memory = () => {
  const { theme } = useTheme()
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null)
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([])
  const [selected, setSelected] = useState(0)

  const refresh = useCallback(async () => {
    const snap = await readHermesHome()
    setHome(snap)
    const active = snap.config?.memory?.provider || ""
    const prov = await readMemoryProviders(active)
    setProviders(prov)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH)
    return () => clearInterval(id)
  }, [refresh])

  const cfg = home?.config?.memory
  const current = providers[selected]

  return (
    <box flexGrow={1} flexDirection="row" gap={1} padding={1}>
      {/* Left: Provider list + built-in memory stats */}
      <box flexDirection="column" width="40%" gap={1}>
        {/* Memory config summary */}
        {cfg ? (
          <box
            flexDirection="column"
            backgroundColor={theme.backgroundPanel}
            border
            borderColor={theme.borderSubtle}
            padding={1}
          >
            <text fg={theme.primary}>
              <strong>Memory Config</strong>
            </text>
            <text fg={theme.text}>
              Active provider: <span fg={theme.accent}>{cfg.provider || "builtin (file-only)"}</span>
            </text>
            <text fg={theme.textMuted}>
              Notes: {cfg.memory_enabled ? "enabled" : "disabled"} · Profile: {cfg.user_profile_enabled ? "enabled" : "disabled"}
            </text>
            <text fg={theme.textMuted}>
              Nudge every {cfg.nudge_interval} turns · Flush after {cfg.flush_min_turns} turns
            </text>
          </box>
        ) : null}

        {/* Built-in capacity bars */}
        <CapacityBox title="Notes (MEMORY.md)" info={home?.memory ?? null} theme={theme} />
        <CapacityBox title="Profile (USER.md)" info={home?.userProfile ?? null} theme={theme} />

        {/* Provider list */}
        <box
          flexDirection="column"
          flexGrow={1}
          backgroundColor={theme.backgroundPanel}
          border
          borderColor={theme.borderSubtle}
          padding={1}
        >
          <text fg={theme.primary}>
            <strong>Providers</strong>
          </text>
          <text> </text>
          <scrollbox scrollY flexGrow={1}>
            {providers.map((p, i) => {
              const sel = i === selected
              const dot = p.active ? "●" : "○"
              const color = p.active ? theme.success : theme.textMuted
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
                    {p.active ? <span fg={theme.success}> (active)</span> : null}
                  </text>
                </box>
              )
            })}
          </scrollbox>
        </box>
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
          <>
            <text fg={theme.primary}>
              <strong>{current.name}</strong>
              {current.active ? <span fg={theme.success}> ● active</span> : <span fg={theme.textMuted}> ○ inactive</span>}
            </text>
            <text> </text>
            <text fg={theme.textMuted}>{DESC[current.name] || "Memory provider"}</text>
            <text> </text>

            {/* Config entries */}
            {Object.keys(current.config).length > 0 ? (
              <>
                <text fg={theme.accent}>
                  <strong>Configuration</strong>
                </text>
                <text> </text>
                <scrollbox scrollY flexGrow={1}>
                  {Object.entries(current.config).map(([k, v]) => (
                    <box key={k} height={1} flexDirection="row">
                      <text>
                        <span fg={theme.textMuted}>{k}: </span>
                        <span fg={theme.text}>{String(v)}</span>
                      </text>
                    </box>
                  ))}
                </scrollbox>
              </>
            ) : (
              <text fg={theme.textMuted}>
                {current.name === "builtin"
                  ? "Built-in provider uses MEMORY.md and USER.md files. No additional config."
                  : "No local configuration found."}
              </text>
            )}
          </>
        ) : (
          <text fg={theme.textMuted}>Select a provider to view details</text>
        )}
      </box>
    </box>
  )
}

// ─── Capacity Bar ─────────────────────────────────────────────────────

type CapacityProps = {
  title: string
  info: { charCount: number; charLimit: number; usagePercent: number; entryCount: number } | null
  theme: Theme
}

const CapacityBox = ({ title, info, theme }: CapacityProps) => {
  if (!info) {
    return (
      <box backgroundColor={theme.backgroundPanel} border borderColor={theme.borderSubtle} padding={1}>
        <text fg={theme.textMuted}>{title}: unavailable</text>
      </box>
    )
  }

  const color = usageColor(info.usagePercent, theme)

  return (
    <box backgroundColor={theme.backgroundPanel} border borderColor={theme.borderSubtle} paddingX={1}>
      <text>
        <span fg={theme.text}>{title}</span>
        <span fg={theme.textMuted}> {info.entryCount} entries</span>
      </text>
      <text>
        <span fg={color}>{bar(info.usagePercent, 20)}</span>
        <span fg={theme.textMuted}> {info.charCount}/{info.charLimit} ({info.usagePercent}%)</span>
      </text>
    </box>
  )
}
