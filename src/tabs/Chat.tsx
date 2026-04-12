import { MessageList } from "../components/chat/MessageList"
import { InputArea } from "../components/chat/InputArea"
import { useTheme } from "../theme"
import type { Message, Usage } from "../types/message"

type ChatProps = {
  messages: Message[]
  streaming: boolean
  input: string
  onInput: (v: string) => void
  onSubmit: () => void
  ready: boolean
  model?: string
  usage?: Usage
  cost?: number
}

export const Chat = ({
  messages,
  streaming,
  input,
  onInput,
  onSubmit,
  ready,
  model,
  usage,
  cost,
}: ChatProps) => {
  const { theme } = useTheme()
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} />
      <InputArea
        value={input}
        onChange={onInput}
        onSubmit={onSubmit}
        focused={!streaming}
        ready={ready}
        streaming={streaming}
        model={model}
        usage={usage}
        cost={cost}
      />
    </box>
  )
}
