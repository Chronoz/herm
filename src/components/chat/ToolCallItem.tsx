import { memo, useState, useEffect } from "react"
import type { ToolPart } from "../../types/message"
import { useTheme } from "../../theme"

const ICON: Record<string, string> = {
  terminal: "⚡",
  read_file: "📄",
  write_file: "✏️",
  search_files: "🔍",
  patch: "🩹",
  browser_navigate: "🌐",
  browser_click: "🖱️",
  browser_snapshot: "📸",
  browser_vision: "👁️",
  browser_type: "⌨️",
  vision_analyze: "👁️",
  delegate_task: "🤖",
  execute_code: "🐍",
  image_generate: "🎨",
  skill_view: "📚",
  skill_manage: "📝",
  skills_list: "📚",
  memory: "🧠",
  todo: "✅",
  clarify: "❓",
  session_search: "🔎",
  cronjob: "⏰",
  text_to_speech: "🔊",
}

function icon(name: string): string {
  return ICON[name] || "⚙️"
}

function label(name: string): string {
  return name.replace(/_/g, " ")
}

// Extract a meaningful one-line summary from tool args
function summary(name: string, raw: string): string {
  if (!raw) return ""
  try {
    const p = JSON.parse(raw)
    switch (name) {
      case "terminal": return p.command || ""
      case "read_file": return p.path || ""
      case "write_file": return p.path || ""
      case "patch": return p.path || p.mode || ""
      case "search_files": return `${p.pattern || ""}${p.path ? ` in ${p.path}` : ""}`
      case "browser_navigate": return p.url || ""
      case "browser_click": return p.ref || ""
      case "browser_type": return `${p.ref || ""} → ${(p.text || "").slice(0, 30)}`
      case "delegate_task": return (p.goal || "").slice(0, 80)
      case "execute_code": return `${(p.code || "").split("\n")[0].slice(0, 60)}`
      case "image_generate": return (p.prompt || "").slice(0, 60)
      case "memory": return `${p.action || ""} ${p.target || ""}`
      case "todo": return p.todos ? `${p.todos.length} items` : "view"
      case "skill_view": return p.name || ""
      case "skill_manage": return `${p.action || ""} ${p.name || ""}`
      case "cronjob": return `${p.action || ""} ${p.name || ""}`
      default: {
        // Generic: show first string arg
        const first = Object.values(p).find(v => typeof v === "string" && (v as string).length > 0) as string | undefined
        return first ? first.slice(0, 60) : ""
      }
    }
  } catch {
    return ""
  }
}

export const ToolCallItem = memo(({ tool }: { tool: ToolPart }) => {
  const { theme, syntaxStyle } = useTheme()
  const [expanded, setExpanded] = useState(false)

  const running = tool.status === "running"
  const failed = tool.status === "error"
  const color = failed ? theme.error : running ? theme.warning : theme.success
  const sum = summary(tool.name, tool.args) || tool.preview || ""
  const spin = running ? "◌ " : failed ? "✗ " : "✓ "
  const arrow = expanded ? "▾" : "▸"

  const [elapsed, setElapsed] = useState(() =>
    running && tool.startedAt ? Math.floor((Date.now() - tool.startedAt) / 1000) : 0
  )
  useEffect(() => {
    if (!running || !tool.startedAt) return
    const tid = setInterval(() => setElapsed(Math.floor((Date.now() - tool.startedAt!) / 1000)), 1000)
    return () => clearInterval(tid)
  }, [running, tool.startedAt])

  const time = running && tool.startedAt && elapsed > 0
    ? ` ${elapsed}s`
    : tool.status === "done" && tool.duration && tool.duration > 1000
      ? ` ${(tool.duration / 1000).toFixed(1)}s`
      : ""

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      marginBottom={0}
    >
      <box height={1} flexDirection="row" onMouseDown={() => setExpanded(e => !e)}>
        <text>
          <span fg={color}>{spin}</span>
          <span fg={theme.textMuted}>{icon(tool.name)} </span>
          <span fg={theme.text}>{label(tool.name)}</span>
          {sum ? <span fg={theme.textMuted}> — {sum.length > 70 ? sum.slice(0, 70) + "…" : sum}</span> : null}
          {time ? <span fg={theme.textMuted}>{time}</span> : null}
          {tool.args ? <span fg={theme.borderSubtle}> {arrow}</span> : null}
        </text>
      </box>
      {expanded && tool.args && (
        <box paddingLeft={4} paddingTop={0} marginBottom={1}>
          <code content={tool.args} filetype="json" syntaxStyle={syntaxStyle} />
        </box>
      )}
    </box>
  )
})
