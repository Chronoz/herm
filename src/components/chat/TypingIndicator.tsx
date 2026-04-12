// Using OpenTUI React, not standard React
import { useTheme } from "../../theme";

export const TypingIndicator = () => {
  const { theme } = useTheme();

  return (
    <box padding={1} marginBottom={1} backgroundColor={theme.backgroundElement}>
      <text>
        <span fg={theme.info}>typing...</span>
      </text>
    </box>
  );
};
