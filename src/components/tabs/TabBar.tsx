// Using OpenTUI React, not standard React
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../../theme";

interface Tab {
  name: string;
  description: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: number;
  onTabChange: (index: number) => void;
}

export const TabBar = ({ tabs, activeTab, onTabChange }: TabBarProps) => {
  const { theme } = useTheme();

  useKeyboard((key) => {
    if (key.name === "left" && activeTab > 0) {
      onTabChange(activeTab - 1);
    } else if (key.name === "right" && activeTab < tabs.length - 1) {
      onTabChange(activeTab + 1);
    }
  });

  return (
    <box width="100%" flexDirection="column">
      <box flexDirection="row">
        {tabs.map((tab, index) => (
          <box
            key={index}
            focusable
            onMouseDown={() => onTabChange(index)}
            paddingX={2}
            paddingY={0}
            marginRight={1}
            backgroundColor={index === activeTab ? theme.backgroundElement : undefined}
          >
            <text fg={index === activeTab ? theme.primary : theme.textMuted}>
              {tab.name}
            </text>
          </box>
        ))}
      </box>
    </box>
  );
};
