// Using OpenTUI React, not standard React
import { MessageItem, type Message } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { useTheme } from "../../theme";

interface MessageListProps {
  messages: Message[];
  isTyping: boolean;
}

export const MessageList = ({ messages, isTyping }: MessageListProps) => {
  const { theme } = useTheme();

  if (messages.length === 0) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center">
          <text fg={theme.textMuted}>Welcome to Herm</text>
          <text fg={theme.textMuted}>Type your message below to start...</text>
        </box>
      </box>
    );
  }

  return (
    <scrollbox flexGrow={1} focused>
      <box flexDirection="column">
        {messages.map((msg, index) => (
          <MessageItem key={index} message={msg} />
        ))}
        {isTyping && <TypingIndicator />}
      </box>
    </scrollbox>
  );
};
