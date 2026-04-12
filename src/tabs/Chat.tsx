// Using OpenTUI React, not standard React
import { MessageList } from "../components/chat/MessageList";
import { InputArea } from "../components/chat/InputArea";
import type { Message } from "../components/chat/MessageItem";
import { useTheme } from "../theme";

interface ChatTabProps {
  messages: Message[];
  isTyping: boolean;
  input: string;
  hermesReady: boolean;
}

export const Chat = ({ messages, isTyping, input, hermesReady }: ChatTabProps) => {
  const { theme } = useTheme();
  return (
    <box
      flexGrow={1}
      padding={1}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <MessageList messages={messages} isTyping={isTyping} />
      <InputArea input={input} hermesReady={hermesReady} />
    </box>
  );
};