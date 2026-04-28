import { memo, useMemo, useRef, useState } from "react"
import type { RGBA, MouseEvent } from "@opentui/core"
import type { Message, Part, TextPart } from "../../types/message"
import { ErrorBlock } from "./ErrorBlock"
import { MediaChip, splitContent } from "./MediaChip"
import { CodeBlock } from "./CodeBlock"
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

const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

// OpenTUI has no onClick; synthesize one from down→up at the same cell
// so text-selection drags don't fire it.
function useClick(fn?: () => void) {
  const at = useRef<{ x: number; y: number } | null>(null)
  return {
    onMouseDown: (e: MouseEvent) => { at.current = { x: e.x, y: e.y } },
    onMouseUp: (e: MouseEvent) => {
      const a = at.current
      at.current = null
      if (fn && a && a.x === e.x && a.y === e.y) fn()
    },
  }
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

export const MessageItem = memo(({ message, streaming, onRewind, onPick }: {
  message: Message
  streaming: boolean
  onRewind?: (m: Message) => void
  onPick?: (m: Message) => void
}) => {
  if (message.role === "system") return <SystemMessage message={message} />
  if (message.role === "user") return <UserMessage message={message} onRewind={onRewind} />
  return <AssistantMessage message={message} streaming={streaming} onPick={onPick} />
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
  const click = useClick(onRewind && (() => onRewind(message)))
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      backgroundColor={hover ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      {...click}
    >
      <box height={1} flexDirection="row">
        <box flexGrow={1}>
          <text><span fg={theme.accent}>▸ you</span></text>
        </box>
        {hover && onRewind ? (
          <box><text fg={theme.textMuted}>actions ⋯</text></box>
        ) : null}
      </box>
      <box paddingLeft={2}>
        <text fg={theme.text}>{extract(message)}</text>
      </box>
    </box>
  )
})

const AssistantMessage = memo(({ message, streaming, onPick }: {
  message: Message; streaming: boolean; onPick?: (m: Message) => void
}) => {
  const ctx = useTheme()
  const theme = ctx.theme
  const [hover, setHover] = useState(false)
  const click = useClick(onPick && (() => onPick(message)))
  const err = !!message.error
  const trail = message.parts.filter(p => p.type !== "text")

  // Split once per parts identity so hover (which re-renders this
  // component) doesn't re-scan text. parts identity changes per
  // streaming delta and stabilizes on completion.
  const segs = useMemo(
    () => message.parts.map(p => p.type === "text" && p.content ? splitContent(p.content) : null),
    [message.parts],
  )

  const header = [
    message.model ?? "assistant",
    message.usage ? `${tokens(message.usage.input)}→${tokens(message.usage.output)} tok` : null,
    message.duration ? duration(message.duration) : null,
  ].filter(Boolean).join(" · ")

  const part = (p: Part, i: number) => {
    const seg = segs[i]
    if (!seg) return null
    const k = (p as TextPart).key ?? i
    const last = streaming && (p as TextPart).streaming
    return seg.map((s, j) => {
      const tail = last && j === seg.length - 1
      if ("media" in s) return (
        <box key={`${k}-m${j}`} marginTop={1}><MediaChip path={s.media} /></box>
      )
      if ("code" in s) return (
        <CodeBlock key={`${k}-c${j}`} code={s.code} lang={s.lang} streaming={tail} />
      )
      return (
        <box key={`${k}-${j}`}>
          <markdown content={s.md} fg={theme.markdownText}
            syntaxStyle={ctx.syntaxStyle} streaming={tail} />
        </box>
      )
    })
  }

  return (
    <box flexDirection="column" marginBottom={1}
         backgroundColor={hover ? theme.backgroundElement : undefined}
         onMouseOver={() => setHover(true)}
         onMouseOut={() => setHover(false)}
         {...click}>
      <Gutter color={err ? theme.error : theme.primary}>
        <box height={1} flexDirection="row">
          <box flexGrow={1}><text fg={theme.textMuted}>{header}</text></box>
          {trail.length ? (
            <box><text fg={theme.textMuted}>
              {trunc(trail.map(p => p.type === "tool" ? p.name : "💭").join(" · "), 40)}
            </text></box>
          ) : null}
        </box>
        {message.parts.map(part)}
        {err ? <ErrorBlock text={message.error!} /> : null}
      </Gutter>
    </box>
  )
})
