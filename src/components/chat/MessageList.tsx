import { memo, useMemo, useState } from "react"
import { MessageItem } from "./MessageItem"
import { TypingIndicator } from "./TypingIndicator"
import { useTheme } from "../../theme"
import { randomTip, splitTip } from "../../utils/tips"
import type { Message } from "../../types/message"

type Props = {
  messages: Message[]
  streaming: boolean
  onRewind?: (m: Message) => void
  onPick?: (m: Message) => void
}

export const MessageList = memo(({ messages, streaming, onRewind, onPick }: Props) => {
  const theme = useTheme().theme

  const style = useMemo(() => ({
    viewportOptions: { backgroundColor: theme.background },
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: theme.borderSubtle,
        backgroundColor: theme.background,
      },
    },
  }), [theme])

  if (messages.length === 0) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center" gap={1}>
          <text>
            <span fg={theme.primary}>╭─────────────────────────╮</span>
          </text>
          <text>
            <span fg={theme.primary}>│       </span>
            <span fg={theme.accent}>H E R M</span>
            <span fg={theme.primary}>            │</span>
          </text>
          <text>
            <span fg={theme.primary}>╰─────────────────────────╯</span>
          </text>
          <text fg={theme.textMuted}> </text>
          <text fg={theme.textMuted}>Terminal interface for Hermes</text>
          <text fg={theme.textMuted}>Type a message below to begin.</text>
          <text fg={theme.textMuted}> </text>
          <text>
            <span fg={theme.textMuted}>  Enter  </span>
            <span fg={theme.borderSubtle}>Send message</span>
          </text>
          <text>
            <span fg={theme.textMuted}>  Esc×2  </span>
            <span fg={theme.borderSubtle}>Interrupt generation</span>
          </text>
          <text>
            <span fg={theme.textMuted}>  Ctrl+Y </span>
            <span fg={theme.borderSubtle}>Copy last response</span>
          </text>
          <text>
            <span fg={theme.textMuted}>  ↑ / ↓  </span>
            <span fg={theme.borderSubtle}>Prompt history</span>
          </text>
          <Tip />
        </box>
      </box>
    )
  }

  const last = messages[messages.length - 1]
  const lastStreaming = streaming && last?.role === "assistant"

  return (
    <scrollbox
      flexGrow={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
      style={style}
    >
      <box flexDirection="column" paddingBottom={1}>
        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            message={msg}
            streaming={lastStreaming && i === messages.length - 1}
            onRewind={onRewind}
            onPick={onPick}
          />
        ))}
        {streaming && last?.role !== "assistant" && <TypingIndicator />}
      </box>
    </scrollbox>
  )
})

// One random Hermes CLI tip; click to cycle. Width-capped so it
// doesn't blow out the centered empty-state column.
const Tip = memo(() => {
  const theme = useTheme().theme
  const [tip, setTip] = useState(() => randomTip())
  return (
    <box flexDirection="column" alignItems="center" maxWidth={64} marginTop={1}
         onMouseDown={() => setTip(t => randomTip(t))}>
      <text fg={theme.borderSubtle}>─── tip ───</text>
      <text wrapMode="word">
        {splitTip(tip).map((p, i) =>
          <span key={i} fg={p.hl ? theme.accent : theme.textMuted}>{p.t}</span>,
        )}
      </text>
    </box>
  )
})
