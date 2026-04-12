// Using OpenTUI React, not standard React

interface InputAreaProps {
  input: string;
  hermesReady: boolean;
}

export const InputArea = ({ input, hermesReady }: InputAreaProps) => {
  return (
    <>
      <box
        height={3}
        border
        borderStyle="single"
        paddingLeft={1}
        marginTop={1}
      >
        <text>
          {">"} {input}_
        </text>
      </box>

      {/* Help text */}
      <text>
        <span fg="gray">
          Ctrl+C: Exit | Enter: Send |{" "}
          {hermesReady ? "Connected" : "Connecting..."}
        </span>
      </text>
    </>
  );
};