import { MessageItem } from "./MessageItem"
import { TypingIndicator } from "./TypingIndicator"
import { useTheme } from "../../theme"
import type { Message } from "../../types/message"

export const MessageList = ({ messages, streaming }: { messages: Message[]; streaming: boolean }) => {
  const { theme } = useTheme()

  if (messages.length === 0) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center">
          <text fg={theme.primary}>Herm</text>
          <text fg={theme.textMuted}>Type a message to start a conversation.</text>
        </box>
      </box>
    )
  }

  // Determine which message is currently streaming
  const last = messages[messages.length - 1]
  const lastIsStreaming = streaming && last?.role === "assistant"

  return (
    <scrollbox flexGrow={1} scrollY stickyScroll>
      <box flexDirection="column">
        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            message={msg}
            streaming={lastIsStreaming && i === messages.length - 1}
          />
        ))}
        {streaming && last?.role !== "assistant" && <TypingIndicator />}
      </box>
    </scrollbox>
  )
}
