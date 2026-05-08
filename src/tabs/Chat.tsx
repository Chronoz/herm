import { memo } from "react"
import { MessageList } from "../components/chat/MessageList"
import type { PromptWire } from "../components/chat/MessageItem"
import { ThoughtCloud } from "../components/chat/ThoughtCloud"
import { useTheme } from "../theme"
import type { Message } from "../types/message"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { RefObject } from "react"

export const Chat = memo(({
  messages,
  streaming,
  prompt,
  cloud,
  cloudH,
  pick,
  onResize,
  onPick,
  onClose,
  onRewind,
  highlightId,
  scrollRef,
}: {
  messages: Message[]
  streaming: boolean
  prompt?: PromptWire
  cloud: boolean
  cloudH: number
  pick?: Message
  onResize: (h: number) => void
  onPick: (m?: Message) => void
  onClose: () => void
  onRewind?: (m: Message) => void
  highlightId?: string
  scrollRef?: RefObject<ScrollBoxRenderable | null>
}) => {
  const theme = useTheme().theme
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      position="relative"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} prompt={prompt} onRewind={onRewind} onPick={onPick} highlightId={highlightId} scrollRef={scrollRef} />
      {cloud ? (
        <box position="absolute" top={0} left={0} right={0} zIndex={1}>
          <ThoughtCloud
            height={cloudH} messages={messages}
            pick={pick} onResize={onResize} onClose={onClose}
          />
        </box>
      ) : null}
    </box>
  )
})
