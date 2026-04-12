// Using OpenTUI React, not standard React
import { AnimatedAvatar } from "../avatar/AnimatedAvatar";

interface SidebarProps {
  activeTools: string[];
  memoryCount: number;
}

export const Sidebar = ({ activeTools, memoryCount }: SidebarProps) => {
  const allTools = ["web", "file", "terminal", "code", "vision", "browser"];

  return (
    <box width={48} flexDirection="column">
      {/* Avatar Box */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar />
      </box>

      {/* Tools Section */}
      <box
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor="#333333"
      >
        <text>
          <strong>Tools</strong>
        </text>
        <text> </text>
        {allTools.map((tool) => (
          <text key={tool}>
            <span fg={activeTools.includes(tool) ? "green" : "gray"}>
              {activeTools.includes(tool) ? "[x]" : "[ ]"} {tool}
            </span>
          </text>
        ))}

        <text> </text>
        <text> </text>
        <text>
          <strong>Memory</strong>
        </text>
        <text>
          <span fg="gray">{memoryCount} facts</span>
        </text>
      </box>
    </box>
  );
};
