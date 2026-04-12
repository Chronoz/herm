// Using OpenTUI React, not standard React

export const TypingIndicator = () => {
  return (
    <box padding={1} marginBottom={1} backgroundColor="#006644">
      <text>
        <strong>Hermes:</strong>
        <span> </span>
        <span fg="#90EE90">typing...</span>
      </text>
    </box>
  );
};