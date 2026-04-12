import { useState } from "react"
import type { ToolPart } from "../../types/message"
import { useTheme } from "../../theme"
import { SyntaxStyle } from "@opentui/core"

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
  vision_analyze: "👁️",
  delegate_task: "🤖",
  execute_code: "🐍",
  image_generate: "🎨",
  skill_view: "📚",
  skill_manage: "📝",
  memory: "🧠",
  todo: "✅",
}

function icon(name: string): string {
  return ICON[name] || "⚙️"
}

function label(name: string): string {
  return name.replace(/_/g, " ")
}

export const ToolCallItem = ({ tool }: { tool: ToolPart }) => {
  const { theme, syntaxStyle } = useTheme()
  const [expanded, setExpanded] = useState(false)

  const running = tool.status === "running"
  const failed = tool.status === "error"
  const color = failed ? theme.error : running ? theme.warning : theme.success

  // Parse args for display
  let summary = ""
  try {
    const parsed = JSON.parse(tool.args)
    // Show the most relevant arg for common tools
    if (parsed.command) summary = parsed.command
    else if (parsed.path) summary = parsed.path
    else if (parsed.url) summary = parsed.url
    else if (parsed.pattern) summary = parsed.pattern
    else if (parsed.goal) summary = parsed.goal?.slice(0, 60) + (parsed.goal?.length > 60 ? "..." : "")
    else if (parsed.prompt) summary = parsed.prompt?.slice(0, 60) + (parsed.prompt?.length > 60 ? "..." : "")
    else if (parsed.text) summary = parsed.text?.slice(0, 60) + (parsed.text?.length > 60 ? "..." : "")
  } catch {
    // not valid json
  }

  const spinner = running ? "◌ " : failed ? "✗ " : "✓ "

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      marginBottom={0}
      onMouseDown={() => setExpanded(e => !e)}
    >
      <box height={1} flexDirection="row">
        <text>
          <span fg={color}>{spinner}</span>
          <span fg={theme.textMuted}>{icon(tool.name)} </span>
          <span fg={theme.text}>{label(tool.name)}</span>
          {summary ? <span fg={theme.textMuted}> — {summary}</span> : null}
        </text>
      </box>
      {expanded && tool.args && (
        <box paddingLeft={4} paddingTop={0} marginBottom={1}>
          <code content={tool.args} filetype="json" syntaxStyle={syntaxStyle} />
        </box>
      )}
    </box>
  )
}
