// Using OpenTUI React, not standard React
import { useTheme } from "../../theme";

interface InputAreaProps {
  input: string;
  hermesReady: boolean;
}

export const InputArea = ({ input, hermesReady }: InputAreaProps) => {
  const { theme } = useTheme();

  return (
    <>
      <box
        height={3}
        border
        borderStyle="single"
        paddingLeft={1}
        marginTop={1}
      >
        <text fg={theme.text}>
          {">"} {input}_
        </text>
      </box>

      <text fg={theme.textMuted}>
        Ctrl+C: Exit | Enter: Send |{" "}
        {hermesReady ? "Connected" : "Connecting..."}
      </text>
    </>
  );
};
