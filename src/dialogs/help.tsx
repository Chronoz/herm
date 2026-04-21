/**
 * Help dialog — keyboard shortcut reference.
 */

import { useTheme } from "../theme"

const SECTIONS = [
  {
    name: "General",
    keys: [
      ["Ctrl+C", "Exit (or copy selection)"],
      ["Ctrl+K", "Command palette"],
      ["F1 / ?", "Help"],
    ],
  },
  {
    name: "Chat",
    keys: [
      ["Enter", "Send message"],
      ["Esc ×2", "Interrupt generation"],
      ["Ctrl+Y", "Copy last response"],
      ["Alt+V", "Attach clipboard image"],
      ["↑ / ↓", "Prompt history"],
    ],
  },
  {
    name: "Navigation",
    keys: [
      ["Ctrl+←/→", "Switch tabs"],
    ],
  },
] as const

export const HelpDialog = () => {
  const theme = useTheme().theme

  return (
    <box flexDirection="column" width={56}>
      <text fg={theme.text}>
        <strong>Keyboard Shortcuts</strong>
      </text>
      <box height={1} />
      {SECTIONS.map(section => (
        <box key={section.name} flexDirection="column">
          <text fg={theme.primary}>
            <strong>{section.name}</strong>
          </text>
          {section.keys.map(pair => (
            <box key={pair[0]} flexDirection="row" paddingLeft={1}>
              <box width={16}>
                <text fg={theme.accent}>
                  {pair[0]}
                </text>
              </box>
              <text fg={theme.textMuted}>
                {pair[1]}
              </text>
            </box>
          ))}
          <box height={1} />
        </box>
      ))}
    </box>
  )
}
