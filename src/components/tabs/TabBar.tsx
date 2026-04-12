// Using OpenTUI React, not standard React
import { useKeyboard } from "@opentui/react";

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
  // Handle keyboard navigation for tabs
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
            backgroundColor={index === activeTab ? "#333333" : "transparent"}
          >
            <text fg={index === activeTab ? "#7aa2f7" : "#888888"}>
              {tab.name}
            </text>
          </box>
        ))}
      </box>
    </box>
  );
};
