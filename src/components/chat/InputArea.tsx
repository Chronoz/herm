import { useTheme } from "../../theme"
import type { Usage } from "../../types/message"

type InputAreaProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  focused: boolean
  ready: boolean
  streaming: boolean
  model?: string
  usage?: Usage
  cost?: number
}

function fmt(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export const InputArea = ({
  value,
  onChange,
  onSubmit,
  focused,
  ready,
  streaming,
  model,
  usage,
  cost,
}: InputAreaProps) => {
  const { theme } = useTheme()

  // Status line parts
  const parts: string[] = []
  if (model) parts.push(model)
  if (usage) parts.push(`${fmt(usage.total)} tokens`)
  if (cost !== undefined && cost > 0) parts.push(`$${cost.toFixed(2)}`)

  const status = ready ? (streaming ? "Generating..." : "Ready") : "Connecting..."
  const color = ready ? (streaming ? theme.warning : theme.success) : theme.error

  return (
    <box flexDirection="column" marginTop={0}>
      {/* Input box */}
      <box
        border
        borderStyle="single"
        borderColor={focused ? theme.borderActive : theme.border}
        flexDirection="row"
      >
        <box width={2} height={1}>
          <text fg={theme.primary}>{">"} </text>
        </box>
        <input
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={streaming ? "Generating..." : "Message Hermes..."}
          focused={focused}
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
        />
      </box>
      {/* Footer bar */}
      <box height={1} flexDirection="row" paddingX={1}>
        <box flexGrow={1}>
          <text>
            <span fg={color}>● </span>
            <span fg={theme.textMuted}>{status}</span>
            {parts.length > 0 ? <span fg={theme.textMuted}> · {parts.join(" · ")}</span> : null}
          </text>
        </box>
        <box>
          <text>
            <span fg={theme.textMuted}>Enter: Send · Esc: Interrupt · Ctrl+Y: Copy</span>
          </text>
        </box>
      </box>
    </box>
  )
}
