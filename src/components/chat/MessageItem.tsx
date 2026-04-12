// Using OpenTUI React, not standard React
import { useTheme } from "../../theme";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

interface MessageItemProps {
  message: Message;
}

export const MessageItem = ({ message }: MessageItemProps) => {
  const { theme } = useTheme();

  const bg =
    message.role === "user"
      ? theme.primary
      : message.role === "assistant"
        ? theme.secondary
        : theme.backgroundElement;

  const label =
    message.role === "user"
      ? "You"
      : message.role === "assistant"
        ? "Hermes"
        : "System";

  return (
    <box padding={1} marginBottom={1} backgroundColor={bg}>
      <text fg={theme.text}>
        <strong>{label}:</strong>
        <span> {message.content}</span>
      </text>
    </box>
  );
};
