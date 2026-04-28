import { useState, useMemo, memo } from "react"
import type { MemoryProviderInfo, MemoryFileInfo } from "../utils/hermes-home"
import { useHome } from "../home"
import { useTheme, type Theme } from "../theme"
import { useListKeys } from "../keys"
import { useDialog } from "../ui/dialog"
import { TabShell } from "../ui/shell"
import { KVBlock } from "../ui/kv"

// ─── Helpers ──────────────────────────────────────────────────────────

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

export const Memory = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const [sel, setSel] = useState(0)

  const config = useHome("config")
  const memory = useHome("memory")
  const userProfile = useHome("userProfile")
  const found = useHome("memoryProviders")

  const cfg = config?.memory
  const active = cfg?.provider || ""

  const providers = useMemo(
    () => ALL.map(name =>
      found?.find(p => p.name === name)
        ?? { name, active: name === "builtin" || name === active, config: {} },
    ),
    [found, active],
  )

  const cur = providers[sel]
  const on = !!cur && (cur.name === "builtin" || cur.name === active)

  const keys = useListKeys({
    active: !!props.focused && dialog.stack.length === 0,
    count: providers.length, setSel,
  })

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell title="Memory Providers" hint={`${keys.print("list.up")}${keys.print("list.down")} select`} grow={1}>
        <scrollbox scrollY flexGrow={1}>
          {providers.map((p, i) => {
            const pOn = p.name === "builtin" || p.name === active
            const has = Object.keys(p.config).length > 0
            const dot = pOn ? "●" : has ? "◐" : "○"
            const fg = pOn ? theme.success : has ? theme.warning : theme.textMuted
            const tag = pOn ? "active" : has ? "configured" : ""
            return (
              <box
                key={p.name}
                height={1}
                backgroundColor={i === sel ? theme.backgroundElement : undefined}
                onMouseDown={() => setSel(i)}
                onMouseMove={() => setSel(i)}
              >
                <text>
                  <span fg={fg}>{dot} </span>
                  <span fg={i === sel ? theme.accent : theme.text}>{p.name}</span>
                  {tag ? <span fg={fg}> ({tag})</span> : null}
                </text>
              </box>
            )
          })}
        </scrollbox>
      </TabShell>

      <TabShell
        title={cur?.name ?? "Provider"}
        hint={on ? "● active" : "○ inactive"}
        grow={2}
      >
        {cur ? (
          <ProviderDetail provider={cur} active={active} cfg={cfg} memory={memory} userProfile={userProfile} />
        ) : (
          <text fg={theme.textMuted}>Select a provider</text>
        )}
      </TabShell>
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

const ProviderDetail = memo((props: {
  provider: MemoryProviderInfo
  active: string
  cfg: MemoryCfg | undefined
  memory: MemoryFileInfo | null | undefined
  userProfile: MemoryFileInfo | null | undefined
}) => {
  const theme = useTheme().theme
  const p = props.provider
  const on = p.name === "builtin" || p.name === props.active

  return (
    <scrollbox scrollY flexGrow={1}>
      <box flexDirection="column">
        <box minHeight={1}>
          <text wrapMode="word" fg={theme.textMuted}>{DESC[p.name] || "Memory provider"}</text>
        </box>
        <box height={1} />

        {p.name === "builtin" ? (
          <box flexDirection="column">
            {props.cfg ? (
              <>
                <KVBlock rows={[
                  ["Notes", props.cfg.memory_enabled ? "enabled" : "disabled",
                    props.cfg.memory_enabled ? theme.success : theme.error],
                  ["Profile", props.cfg.user_profile_enabled ? "enabled" : "disabled",
                    props.cfg.user_profile_enabled ? theme.success : theme.error],
                ]} />
                <box height={1} />
              </>
            ) : null}
            <CapacityBar title="Notes (MEMORY.md)" info={props.memory ?? null} />
            <box height={1} />
            <CapacityBar title="Profile (USER.md)" info={props.userProfile ?? null} />
          </box>
        ) : null}

        {p.name !== "builtin" && on && props.cfg ? (
          <>
            <box height={1}><text fg={theme.accent}><strong>Agent Settings</strong></text></box>
            <KVBlock rows={[
              ["Nudge", `every ${props.cfg.nudge_interval} turns`],
              ["Flush", `after ${props.cfg.flush_min_turns} turns`],
            ]} />
            <box height={1} />
          </>
        ) : null}

        {Object.keys(p.config).length > 0 ? (
          <>
            <box height={1}><text fg={theme.accent}><strong>Local Configuration</strong></text></box>
            <KVBlock rows={Object.entries(p.config).map(([k, v]) => [k, String(v)] as [string, string])} />
          </>
        ) : p.name !== "builtin" ? (
          <box height={1} marginTop={1}>
            <text fg={theme.textMuted}>No local config found. Run `hermes memory setup` to configure.</text>
          </box>
        ) : null}
      </box>
    </scrollbox>
  )
})

// ─── Capacity Bar ─────────────────────────────────────────────────────

const CapacityBar = memo((props: { title: string; info: MemoryFileInfo | null }) => {
  const theme = useTheme().theme
  if (!props.info) {
    return <box height={1}><text fg={theme.textMuted}>{props.title}: unavailable</text></box>
  }
  const color = usageColor(props.info.usagePercent, theme)
  return (
    <box flexDirection="column">
      <box height={1}>
        <text>
          <span fg={theme.text}>{props.title}</span>
          <span fg={theme.textMuted}> · {props.info.entryCount} entries</span>
        </text>
      </box>
      <box height={1}>
        <text>
          <span fg={color}>{bar(props.info.usagePercent, 20)}</span>
          <span fg={theme.textMuted}> {props.info.charCount}/{props.info.charLimit} ({props.info.usagePercent}%)</span>
        </text>
      </box>
    </box>
  )
})
