import { MessageItem } from "./MessageItem"
import { TypingIndicator } from "./TypingIndicator"
import { useTheme } from "../../theme"
import type { Message } from "../../types/message"

export const MessageList = ({ messages, streaming }: { messages: Message[]; streaming: boolean }) => {
  const { theme } = useTheme()

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
          <text fg={theme.textMuted}>Terminal interface for Hermes Agent</text>
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
      style={{
        viewportOptions: { backgroundColor: theme.background },
        scrollbarOptions: {
          trackOptions: {
            foregroundColor: theme.borderSubtle,
            backgroundColor: theme.background,
          },
        },
      }}
    >
      <box flexDirection="column" paddingBottom={1}>
        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            message={msg}
            streaming={lastStreaming && i === messages.length - 1}
          />
        ))}
        {streaming && last?.role !== "assistant" && <TypingIndicator />}
      </box>
    </scrollbox>
  )
}
