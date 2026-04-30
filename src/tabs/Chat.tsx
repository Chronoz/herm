import { memo } from "react"
import { MessageList } from "../components/chat/MessageList"
import { ThoughtCloud } from "../components/chat/ThoughtCloud"
import { useTheme } from "../theme"
import type { Message } from "../types/message"

export const Chat = memo(({
  messages,
  streaming,
  status,
  cloud,
  cloudH,
  pick,
  onResize,
  onPick,
  onClose,
  onRewind,
}: {
  messages: Message[]
  streaming: boolean
  status: string
  cloud: boolean
  cloudH: number
  pick?: Message
  onResize: (h: number) => void
  onPick: (m?: Message) => void
  onClose: () => void
  onRewind?: (m: Message) => void
}) => {
  const theme = useTheme().theme
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      position="relative"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} onRewind={onRewind} onPick={onPick} />
      {cloud ? (
        <box position="absolute" top={0} left={0} right={0} zIndex={1}>
          <ThoughtCloud
            height={cloudH} messages={messages} streaming={streaming} status={status}
            pick={pick} onResize={onResize} onClose={onClose}
          />
        </box>
      ) : null}
    </box>
  )
})
