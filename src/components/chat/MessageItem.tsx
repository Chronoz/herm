import type { Message, TextPart } from "../../types/message"
import { ToolCallItem } from "./ToolCallItem"
import { useTheme } from "../../theme"
import type { SyntaxStyle } from "@opentui/core"

// Re-export for backward compat
export type { Message }

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`
}

function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function stamp(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export const MessageItem = ({ message, streaming }: { message: Message; streaming: boolean }) => {
  const { theme } = useTheme()

  if (message.role === "system") return <SystemMessage message={message} />
  if (message.role === "user") return <UserMessage message={message} />
  return <AssistantMessage message={message} streaming={streaming} />
}

const SystemMessage = ({ message }: { message: Message }) => {
  const { theme } = useTheme()
  const content = message.parts.filter((p): p is TextPart => p.type === "text").map(p => p.content).join("")

  return (
    <box paddingLeft={1} paddingY={0} marginBottom={1}>
      <text>
        <span fg={theme.textMuted}>{'─'.repeat(3)} </span>
        <span fg={theme.textMuted}>{content}</span>
        <span fg={theme.textMuted}> {'─'.repeat(3)}</span>
      </text>
    </box>
  )
}

const UserMessage = ({ message }: { message: Message }) => {
  const { theme } = useTheme()
  const content = message.parts.filter((p): p is TextPart => p.type === "text").map(p => p.content).join("")

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Header */}
      <box height={1} flexDirection="row" paddingLeft={1}>
        <text>
          <span fg={theme.primary}>▌</span>
          <span fg={theme.primary}> You</span>
          {message.timestamp ? <span fg={theme.textMuted}> {stamp(message.timestamp)}</span> : null}
        </text>
      </box>
      {/* Content */}
      <box paddingLeft={3}>
        <text fg={theme.text}>{content}</text>
      </box>
    </box>
  )
}

const AssistantMessage = ({ message, streaming }: { message: Message; streaming: boolean }) => {
  const { theme, syntaxStyle } = useTheme()
  const parts = message.parts
  const textContent = parts.filter((p): p is TextPart => p.type === "text").map(p => p.content).join("")
  const toolParts = parts.filter(p => p.type === "tool")
  const isStreaming = streaming && parts.some(p => p.type === "text" && p.streaming)

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Header */}
      <box height={1} flexDirection="row" paddingLeft={1}>
        <text>
          <span fg={theme.secondary}>▌</span>
          <span fg={theme.secondary}> Hermes</span>
          {message.model ? <span fg={theme.textMuted}> · {message.model}</span> : null}
          {message.timestamp ? <span fg={theme.textMuted}> {stamp(message.timestamp)}</span> : null}
        </text>
      </box>

      {/* Tool calls */}
      {toolParts.map((p, i) =>
        p.type === "tool" ? <ToolCallItem key={p.id || i} tool={p} /> : null
      )}

      {/* Text content — markdown rendering */}
      {textContent ? (
        <box paddingLeft={3}>
          <markdown
            content={textContent}
            syntaxStyle={syntaxStyle}
            streaming={isStreaming}
          />
        </box>
      ) : null}

      {/* Footer — metadata after completion */}
      {!isStreaming && (message.duration || message.usage) ? (
        <box height={1} paddingLeft={3} marginTop={0}>
          <text>
            <span fg={theme.textMuted}>▣ </span>
            {message.duration ? <span fg={theme.textMuted}>{duration(message.duration)}</span> : null}
            {message.usage ? (
              <span fg={theme.textMuted}>
                {message.duration ? " · " : ""}
                {tokens(message.usage.input)}→{tokens(message.usage.output)}
              </span>
            ) : null}
          </text>
        </box>
      ) : null}

      {/* Error */}
      {message.error ? (
        <box paddingLeft={3} marginTop={0}>
          <text>
            <span fg={theme.error}>✗ {message.error}</span>
          </text>
        </box>
      ) : null}
    </box>
  )
}
