import type { SubmitEvent } from "@opentui/core"
import { useTheme } from "../../theme"
import type { Usage } from "../../types/message"

type InputAreaProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (val?: string) => void
  focused: boolean
  ready: boolean
  streaming: boolean
  model?: string
  usage?: Usage
  cost?: number
  turns?: number
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
  turns,
}: InputAreaProps) => {
  const { theme } = useTheme()

  // Left status
  const status = ready ? (streaming ? "Generating..." : "Ready") : "Connecting..."
  const dot = ready ? (streaming ? theme.warning : theme.success) : theme.error

  // Right status — model info + stats
  const stats: string[] = []
  if (model) stats.push(model)
  if (turns && turns > 0) stats.push(`${turns} turns`)
  if (usage) stats.push(`${fmt(usage.input)}→${fmt(usage.output)}`)
  if (cost !== undefined && cost > 0) stats.push(`$${cost.toFixed(2)}`)

  return (
    <box flexDirection="column">
      {/* Input box */}
      <box
        border
        borderStyle="single"
        borderColor={focused && !streaming ? theme.borderActive : theme.border}
        flexDirection="row"
        height={3}
      >
        <box width={2} height={1}>
          <text fg={theme.primary}>{">"} </text>
        </box>
        <input
          value={value}
          onChange={onChange}
          onSubmit={onSubmit as unknown as (e: SubmitEvent) => void}
          placeholder={streaming ? "Waiting for response..." : "Message Hermes..."}
          focused={focused && !streaming}
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
        />
      </box>
      {/* Status bar */}
      <box height={1} flexDirection="row" paddingX={1}>
        <box flexGrow={1}>
          <text>
            <span fg={dot}>● </span>
            <span fg={theme.textMuted}>{status}</span>
            {stats.length > 0 ? <span fg={theme.textMuted}> · {stats.join(" · ")}</span> : null}
          </text>
        </box>
        <box>
          <text>
            <span fg={theme.textMuted}>
              {streaming ? "Esc×2: Interrupt" : "Enter: Send · ↑↓: History · Ctrl+Y: Copy"}
            </span>
          </text>
        </box>
      </box>
    </box>
  )
}
