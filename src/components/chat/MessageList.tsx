import { memo, useMemo, type RefObject } from "react"
import { MessageItem, type PromptWire } from "./MessageItem"
import { TypingIndicator } from "./TypingIndicator"
import { useTheme } from "../../theme"
import type { Message } from "../../types/message"
import type { ScrollBoxRenderable } from "@opentui/core"

type Props = {
  messages: Message[]
  streaming: boolean
  prompt?: PromptWire
  onRewind?: (m: Message) => void
  onPick?: (m: Message) => void
  highlightId?: string
  scrollRef?: RefObject<ScrollBoxRenderable | null>
}

export const MessageList = memo(({ messages, streaming, prompt, onRewind, onPick, highlightId, scrollRef }: Props) => {
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

  if (messages.length === 0) return <box flexGrow={1} />

  const last = messages[messages.length - 1]
  const lastStreaming = streaming && last?.role === "assistant"

  return (
    <scrollbox
      ref={scrollRef}
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
            prompt={prompt}
            onRewind={onRewind}
            onPick={onPick}
            highlighted={msg.id === highlightId}
          />
        ))}
        {streaming && last?.role !== "assistant" && <TypingIndicator />}
      </box>
    </scrollbox>
  )
})
