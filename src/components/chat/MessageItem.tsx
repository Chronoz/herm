import { memo, useState } from "react"
import type { Message, Part, TextPart, ThinkingPart } from "../../types/message"
import { ToolCallItem } from "./ToolCallItem"
import { useTheme } from "../../theme"

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
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function extract(msg: Message): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.content)
    .join("")
}

export const MessageItem = memo(({ message, streaming }: { message: Message; streaming: boolean }) => {
  if (message.role === "system") return <SystemMessage message={message} />
  if (message.role === "user") return <UserMessage message={message} />
  return <AssistantMessage message={message} streaming={streaming} />
})

const SystemMessage = memo(({ message }: { message: Message }) => {
  const theme = useTheme().theme
  return (
    <box paddingLeft={1} height={1}>
      <text>
        <span fg={theme.borderSubtle}>── </span>
        <span fg={theme.textMuted}>{extract(message)}</span>
      </text>
    </box>
  )
})

const UserMessage = memo(({ message }: { message: Message }) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      backgroundColor={hover ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <box height={1} flexDirection="row" paddingLeft={1}>
        <text>
          <span fg={theme.primary}>▌ You</span>
          {message.timestamp ? <span fg={theme.textMuted}> {stamp(message.timestamp)}</span> : null}
        </text>
      </box>
      <box paddingLeft={3}>
        <text fg={theme.text}>{extract(message)}</text>
      </box>
    </box>
  )
})

const Thinking = memo(({ part }: { part: ThinkingPart }) => {
  const theme = useTheme().theme
  const [open, setOpen] = useState(false)
  const body = open ? part.content : part.content.slice(0, 80).replace(/\n/g, " ")
  return (
    <box paddingLeft={2} marginTop={1} border={["left"]} borderColor={theme.borderSubtle}
         onMouseDown={() => setOpen(o => !o)}>
      <text fg={theme.textMuted}>💭 {body}{!open && part.content.length > 80 ? "…" : ""}</text>
    </box>
  )
})

const AssistantMessage = memo(({ message, streaming }: { message: Message; streaming: boolean }) => {
  const ctx = useTheme()
  const theme = ctx.theme
  const hasError = !!message.error
  const border = hasError ? theme.error : theme.secondary

  const part = (p: Part, i: number) => {
    if (p.type === "thinking") return <Thinking key={`t-${i}`} part={p} />
    if (p.type === "tool") return <ToolCallItem key={p.id || `tool-${i}`} tool={p} />
    if (!p.content) return null
    return (
      <box key={`x-${i}`} paddingLeft={3}>
        <markdown content={p.content} syntaxStyle={ctx.syntaxStyle} streaming={streaming && p.streaming} />
      </box>
    )
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <box height={1} flexDirection="row" paddingLeft={1}>
        <text>
          <span fg={border}>▌ Hermes</span>
          {message.model ? <span fg={theme.textMuted}> · {message.model}</span> : null}
          {message.timestamp ? <span fg={theme.textMuted}> {stamp(message.timestamp)}</span> : null}
        </text>
      </box>

      {message.parts.map(part)}

      {!streaming && (message.duration || message.usage || hasError) ? (
        <box height={1} paddingLeft={3}>
          <text>
            {hasError ? (
              <span fg={theme.error}>✗ {message.error}</span>
            ) : (
              <>
                <span fg={theme.textMuted}>▣ </span>
                {message.duration ? <span fg={theme.textMuted}>{duration(message.duration)}</span> : null}
                {message.usage ? (
                  <span fg={theme.textMuted}>
                    {message.duration ? " · " : ""}
                    {tokens(message.usage.input)}→{tokens(message.usage.output)}
                  </span>
                ) : null}
              </>
            )}
          </text>
        </box>
      ) : null}
    </box>
  )
})
