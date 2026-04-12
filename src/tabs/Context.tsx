// Using OpenTUI React, not standard React

interface ContextTabProps {
  description: string;
}

export const Context = ({ description }: ContextTabProps) => {
  return (
    <box flexGrow={1} padding={2}>
      <text>{description}</text>
    </box>
  );
};