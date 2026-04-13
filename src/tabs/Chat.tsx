import { MessageList } from "../components/chat/MessageList"
import { InputArea } from "../components/chat/InputArea"
import { useTheme } from "../theme"
import type { Message, Usage } from "../types/message"
import type { SlashCommand } from "../commands/slash"

type ChatProps = {
  messages: Message[]
  streaming: boolean
  input: string
  onInput: (v: string) => void
  onSubmit: (val?: string) => void
  ready: boolean
  model?: string
  usage?: Usage
  cost?: number
  turns?: number
  // Slash popover
  popover: ReadonlyArray<SlashCommand> | null
  popCursor: number
  onPopCursor: (idx: number) => void
  onPopSelect: (cmd: SlashCommand) => void
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
  turns,
  popover,
  popCursor,
  onPopCursor,
  onPopSelect,
}: ChatProps) => {
  const { theme } = useTheme()
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} streaming={streaming} />
      <box flexShrink={0}>
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
        turns={turns}
        popover={popover}
        popCursor={popCursor}
        onPopCursor={onPopCursor}
        onPopSelect={onPopSelect}
      />
      </box>
    </box>
  )
}
