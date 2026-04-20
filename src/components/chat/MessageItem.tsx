import { memo, useState } from "react"
import type { RGBA } from "@opentui/core"
import type { Message, Part, TextPart, ThinkingPart } from "../../types/message"
import { Tool } from "./tool"
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

function extract(msg: Message): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.content)
    .join("")
}

/** Two-column gutter: a themed vertical bar runs the full height of the body. */
const Gutter = memo(({ color, glyph = "│", children }: {
  color: RGBA
  glyph?: string
  children: React.ReactNode
}) => (
  <box flexDirection="row">
    <box
      width={2}
      flexShrink={0}
      border={["left"]}
      borderColor={color}
      customBorderChars={{
        topLeft: glyph, bottomLeft: glyph, vertical: glyph,
        topRight: "", bottomRight: "", horizontal: "",
        topT: "", bottomT: "", leftT: "", rightT: "", cross: "",
      }}
    />
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      {children}
    </box>
  </box>
))

export const MessageItem = memo(({ message, streaming, onRewind }: {
  message: Message
  streaming: boolean
  onRewind?: (m: Message) => void
}) => {
  if (message.role === "system") return <SystemMessage message={message} />
  if (message.role === "user") return <UserMessage message={message} onRewind={onRewind} />
  return <AssistantMessage message={message} streaming={streaming} />
})

const SystemMessage = memo(({ message }: { message: Message }) => {
  const theme = useTheme().theme
  return (
    <box marginBottom={1}>
      <Gutter color={theme.textMuted} glyph="·">
        <box minHeight={1}>
          <text fg={theme.textMuted} wrapMode="word">{extract(message)}</text>
        </box>
      </Gutter>
    </box>
  )
})

const UserMessage = memo(({ message, onRewind }: { message: Message; onRewind?: (m: Message) => void }) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      backgroundColor={hover ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onRewind ? () => onRewind(message) : undefined}
    >
      <box height={1} flexDirection="row">
        <box flexGrow={1}>
          <text><span fg={theme.accent}>▸ you</span></text>
        </box>
        {hover && onRewind ? (
          <box><text fg={theme.textMuted}>click to rewind ↶</text></box>
        ) : null}
      </box>
      <box paddingLeft={2}>
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
    <box onMouseDown={() => setOpen(o => !o)}>
      <text fg={theme.textMuted}>💭 {body}{!open && part.content.length > 80 ? "…" : ""}</text>
    </box>
  )
})

const AssistantMessage = memo(({ message, streaming }: { message: Message; streaming: boolean }) => {
  const ctx = useTheme()
  const theme = ctx.theme
  const err = !!message.error

  const header = [
    message.model ?? "assistant",
    message.usage ? `${tokens(message.usage.input)}→${tokens(message.usage.output)} tok` : null,
    message.duration ? duration(message.duration) : null,
  ].filter(Boolean).join(" · ")

  const part = (p: Part, i: number) => {
    if (p.type === "thinking") return <Thinking key={`t-${i}`} part={p} />
    if (p.type === "tool") return <Tool key={p.id || `tool-${i}`} tool={p} />
    if (!p.content) return null
    // Fenced code blocks inside assistant markdown are rendered by
    // OpenTUI's MarkdownRenderable → CodeRenderable, which uses the
    // process-global TreeSitterClient singleton for syntax highlighting
    // and the theme's SyntaxStyle for token colors. No per-block wiring
    // needed here.
    // TODO: override renderNode for `code` tokens to wrap them in a
    // backgroundElement box with a top-right language label once
    // OpenTUI exposes a React-safe renderNode hook.
    return (
      <box key={`x-${i}`}>
        <markdown
          content={p.content}
          fg={theme.markdownText}
          syntaxStyle={ctx.syntaxStyle}
          streaming={streaming && p.streaming}
        />
      </box>
    )
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <Gutter color={err ? theme.error : theme.primary}>
        <box height={1}>
          <text fg={theme.textMuted}>{header}</text>
        </box>
        {message.parts.map(part)}
        {err ? (
          <box height={1}>
            <text fg={theme.error}>✗ {message.error}</text>
          </box>
        ) : null}
      </Gutter>
    </box>
  )
})
