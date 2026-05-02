import { memo } from "react"
import { useTheme } from "../../theme"
import { useKeys } from "../../keys"

type Tab = {
  name: string
  description: string
}

type TabBarProps = {
  tabs: ReadonlyArray<Tab>
  activeTab: number
  onTabChange: (index: number) => void
}

// 1..9, 0, - — mirrors the <leader>+digit map in useAppKeys.
const idx = (i: number) => i < 9 ? String(i + 1) : i === 9 ? "0" : "-"

export const TabBar = memo(({ tabs, activeTab, onTabChange }: TabBarProps) => {
  const theme = useTheme().theme
  const keys = useKeys()

  return (
    <box width="100%" flexDirection="column" height={1}>
      <box flexDirection="row" overflow="hidden">
        {tabs.map((tab, i) => (
          <box
            key={i}
            onMouseDown={() => onTabChange(i)}
            paddingX={2}
            marginRight={1}
            flexShrink={0}
            backgroundColor={i === activeTab ? theme.backgroundElement : undefined}
          >
            <text attributes={3}>
              <span fg={theme.borderSubtle}>{idx(i)} </span>
              <span fg={i === activeTab ? theme.primary : theme.textMuted}>{tab.name}</span>
            </text>
          </box>
        ))}
        <box flexGrow={1} minWidth={0} />
        <box paddingX={1} flexShrink={1} minWidth={0} overflow="hidden">
          <text fg={theme.borderSubtle}>
            {`${keys.print("tab.prev")}/${keys.print("tab.next")} or ${keys.print("leader")} N`}
          </text>
        </box>
      </box>
    </box>
  )
})
