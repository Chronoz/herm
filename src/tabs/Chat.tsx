import { MessageList } from "../components/chat/MessageList"
import { useTheme } from "../theme"
import type { Message } from "../types/message"

export const Chat = ({
  messages,
  streaming,
}: {
  messages: Message[]
  streaming: boolean
}) => {
  const { theme } = useTheme()
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} />
    </box>
  )
}
