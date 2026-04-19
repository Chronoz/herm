import { memo } from "react"
import { MessageList } from "../components/chat/MessageList"
import { useTheme } from "../theme"
import type { Message } from "../types/message"

export const Chat = memo(({
  messages,
  streaming,
  onRewind,
}: {
  messages: Message[]
  streaming: boolean
  onRewind?: (m: Message) => void
}) => {
  const theme = useTheme().theme
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} onRewind={onRewind} />
    </box>
  )
})
