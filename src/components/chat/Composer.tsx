// Composer — owns the chat input buffer, slash popover, ghost completion
// and prompt history. The shell (app.tsx) drives keyboard routing through
// the imperative handle so there is exactly one global useKeyboard.

import { forwardRef, memo, useImperativeHandle, useRef, useState } from "react"
import type { SubmitEvent } from "@opentui/core"
import { useTheme } from "../../theme"
import type { Usage } from "../../types/message"
import type { SlashCommand } from "../../commands/slash"
import { useSlashCommands } from "../../app/useSlashCommands"
import { useSlashPopover } from "../../app/useSlashPopover"
import { useAtRefPopover } from "../../app/useAtRefPopover"
import { useInputHistory } from "../../app/useInputHistory"
import { SlashPopover } from "./SlashPopover"
import { AtRefPopover } from "./AtRefPopover"

export type ComposerHandle = {
  value: () => string
  set: (v: string) => void
  popOpen: () => boolean
  popNav: (d: -1 | 1) => void
  popAccept: () => void
  popCancel: () => void
  historyUp: () => void
  historyDown: () => void
}

type Props = {
  focused: boolean
  ready: boolean
  streaming: boolean
  status?: string
  model?: string
  usage?: Usage
  cost?: number
  turns?: number
  onSend: (text: string) => void
  onSlash: (cmd: SlashCommand) => void
}

function fmt(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export const Composer = memo(forwardRef<ComposerHandle, Props>((props, ref) => {
  const theme = useTheme().theme
  const [input, setInput] = useState("")

  const cmds = useSlashCommands().cmds
  const pop = useSlashPopover(input, cmds)
  const at = useAtRefPopover(input)
  const hist = useInputHistory(input, setInput)

  // Hold latest pop/props in a ref so the imperative handle is stable.
  const live = useRef({ pop, at, props, input })
  live.current = { pop, at, props, input }

  // Selecting a popover entry: subcommand synthetics (name contains a
  // space) complete the input for further typing; real commands dispatch.
  const select = (c: SlashCommand) => {
    if (c.name.includes(" ")) { setInput(`/${c.name} `); return }
    setInput("")
    live.current.props.onSlash(c)
  }

  const atAccept = (idx?: number) => {
    const next = live.current.at.accept(live.current.input, idx)
    if (next !== null) setInput(next)
  }

  const submit = () => {
    const a = live.current.at
    if (a.open) return atAccept()
    const p = live.current.pop
    if (p.open) {
      const c = p.popover?.[p.cursor]
      if (c) select(c)
      return
    }
    const text = live.current.input.trim()
    if (!text || !live.current.props.ready || live.current.props.streaming) return
    hist.push(text)
    setInput("")
    live.current.props.onSend(text)
  }

  useImperativeHandle(ref, () => ({
    value: () => live.current.input,
    set: setInput,
    popOpen: () => live.current.pop.open || live.current.at.open,
    popNav: (d) => {
      const a = live.current.at
      if (a.open) return a.setCursor(c => Math.max(0, Math.min(a.items.length - 1, c + d)))
      const max = (live.current.pop.popover?.length ?? 1) - 1
      pop.setCursor(c => Math.max(0, Math.min(max, c + d)))
    },
    popAccept: () => {
      const a = live.current.at
      if (a.open) return atAccept()
      const p = live.current.pop
      const c = p.popover?.[p.cursor]
      if (c) setInput(`/${c.name}${c.name.includes(" ") ? " " : ""}`)
    },
    popCancel: () => {
      const a = live.current.at
      if (a.open) return a.dismiss()
      setInput("")
    },
    historyUp: hist.up,
    historyDown: hist.down,
  }), [hist.up, hist.down, pop.setCursor])

  const active = props.focused && !props.streaming
  const label = !props.ready ? "Connecting..."
    : props.streaming ? (props.status || "Generating...")
    : "Ready"
  const dot = props.ready ? (props.streaming ? theme.warning : theme.success) : theme.error

  const stats: string[] = []
  if (props.model) stats.push(props.model)
  if (props.turns) stats.push(`${props.turns} turns`)
  if (props.usage) stats.push(`${fmt(props.usage.input)}→${fmt(props.usage.output)}`)
  if (props.cost != null && props.cost > 0) stats.push(`$${props.cost.toFixed(2)}`)

  const hint = props.streaming ? "Esc×2: Interrupt"
    : pop.open ? "↑↓: Navigate · Tab: Complete · Enter: Run · Esc: Close"
    : at.open ? "↑↓: Navigate · Tab/Enter: Insert · Esc: Close"
    : props.focused ? "Enter: Send · ↑↓: History · /: Commands · @: Context · Tab: Content"
    : "Tab: Focus input · Esc: Focus input"

  return (
    <box flexDirection="column" position="relative">
      {pop.open ? (
        <box position="absolute" bottom={4} left={0} right={0}>
          <SlashPopover
            commands={pop.popover!}
            cursor={pop.cursor}
            onCursor={pop.setCursor}
            onSelect={select}
          />
        </box>
      ) : at.open ? (
        <box position="absolute" bottom={4} left={0} right={0}>
          <AtRefPopover
            items={at.items}
            cursor={at.cursor}
            onCursor={at.setCursor}
            onSelect={atAccept}
          />
        </box>
      ) : null}

      <box
        border
        borderStyle="single"
        borderColor={active ? theme.borderActive : theme.border}
        flexDirection="row"
        height={3}
        position="relative"
      >
        <box width={2} height={1}>
          <text fg={theme.primary}>{">"} </text>
        </box>
        <input
          value={input}
          onInput={setInput}
          onSubmit={submit as unknown as (e: SubmitEvent) => void}
          placeholder={props.streaming ? "Waiting for response..." : "Message Hermes... (/ for commands)"}
          focused={active}
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
        />
        {pop.ghost && active ? (
          <box position="absolute" top={0} left={2 + input.length} height={1}>
            <text fg={theme.textMuted}>{pop.ghost}</text>
          </box>
        ) : null}
      </box>

      <box height={1} flexDirection="row" paddingX={1}>
        <box flexGrow={1}>
          <text>
            <span fg={dot}>● </span>
            <span fg={theme.textMuted}>{label}</span>
            {stats.length ? <span fg={theme.textMuted}> · {stats.join(" · ")}</span> : null}
          </text>
        </box>
        <box>
          <text fg={theme.textMuted}>{hint}</text>
        </box>
      </box>
    </box>
  )
}))
