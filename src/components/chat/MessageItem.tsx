// Using OpenTUI React, not standard React

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

interface MessageItemProps {
  message: Message;
}

export const MessageItem = ({ message }: MessageItemProps) => {
  const backgroundColor = 
    message.role === "user"
      ? "#004488"
      : message.role === "assistant"
        ? "#006644"
        : "#444400";

  const displayName = 
    message.role === "user"
      ? "You"
      : message.role === "assistant"
        ? "Hermes"
        : "System";

  return (
    <box
      padding={1}
      marginBottom={1}
      backgroundColor={backgroundColor}
    >
      <text>
        <strong>{displayName}:</strong>
        <span> {message.content}</span>
      </text>
    </box>
  );
};