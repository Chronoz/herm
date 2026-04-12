// Using OpenTUI React, not standard React
import { AnimatedAvatar } from "../avatar/AnimatedAvatar";
import { useTheme } from "../../theme";

interface SidebarProps {
  activeTools: string[];
  memoryCount: number;
}

export const Sidebar = ({ activeTools, memoryCount }: SidebarProps) => {
  const { theme } = useTheme();
  const allTools = ["web", "file", "terminal", "code", "vision", "browser"];

  return (
    <box width={48} flexDirection="column">
      {/* Avatar (bust) */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar />
      </box>

      {/* Body (pillar) */}
      <box
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.hermBody}
      >
        <text fg={theme.hermBodyText}>
          <strong>Tools</strong>
        </text>
        <text> </text>
        {allTools.map((tool) => (
          <text key={tool} fg={theme.hermBodyText}>
            {activeTools.includes(tool) ? "[x]" : "[ ]"} {tool}
          </text>
        ))}

        <text> </text>
        <text> </text>
        <text fg={theme.hermBodyText}>
          <strong>Memory</strong>
        </text>
        <text fg={theme.hermBodyText}>
          {memoryCount} facts
        </text>
      </box>
    </box>
  );
};
