import { memo } from "react"
import { useTheme } from "../../theme"

type Tab = {
  name: string
  description: string
}

type TabBarProps = {
  tabs: Tab[]
  activeTab: number
  onTabChange: (index: number) => void
}

export const TabBar = memo(({ tabs, activeTab, onTabChange }: TabBarProps) => {
  const { theme } = useTheme()

  return (
    <box width="100%" flexDirection="column" height={2}>
      <box flexDirection="row" height={1}>
        {tabs.map((tab, i) => (
          <box
            key={i}
            onMouseDown={() => onTabChange(i)}
            paddingX={2}
            marginRight={1}
            backgroundColor={i === activeTab ? theme.backgroundElement : undefined}
          >
            <text fg={i === activeTab ? theme.primary : theme.textMuted}>
              {tab.name}
            </text>
          </box>
        ))}
        <box flexGrow={1} />
        <box paddingX={1}>
          <text fg={theme.borderSubtle}>Ctrl+←/→: Switch tabs</text>
        </box>
      </box>
      <box width="100%" height={1}>
        <text fg={theme.borderSubtle}>{'─'.repeat(120)}</text>
      </box>
    </box>
  )
})
