// Using OpenTUI React, not standard React
import { MessageItem, type Message } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";

interface MessageListProps {
  messages: Message[];
  isTyping: boolean;
}

export const MessageList = ({ messages, isTyping }: MessageListProps) => {
  if (messages.length === 0) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center">
          <text>
            <span fg="gray">Welcome to Herm</span>
          </text>
          <text>
            <span fg="gray">Type your message below to start...</span>
          </text>
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