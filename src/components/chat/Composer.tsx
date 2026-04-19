// Composer — owns the chat input buffer, slash popover, ghost completion
// and prompt history. The shell (app.tsx) drives keyboard routing through
// the imperative handle so there is exactly one global useKeyboard.

import { forwardRef, memo, useImperativeHandle, useRef, useState, useCallback } from "react"
import type { SubmitEvent, PasteEvent } from "@opentui/core"
import { decodePasteBytes } from "@opentui/core"
import { useTheme } from "../../theme"
import { useGateway } from "../../app/gateway"
import type { Usage } from "../../types/message"
import type { SlashCommand } from "../../commands/slash"
import { useSlashCommands } from "../../app/useSlashCommands"
import { useSlashPopover } from "../../app/useSlashPopover"
import { useAtRefPopover } from "../../app/useAtRefPopover"
import { useInputHistory } from "../../app/useInputHistory"
import { SlashPopover } from "./SlashPopover"
import { AtRefPopover } from "./AtRefPopover"
import { trunc } from "../../ui/fmt"

export type ComposerHandle = {
  value: () => string
  set: (v: string) => void
  /** Insert multi-line text: ≥2 lines collapses via gateway. */
  insert: (text: string) => void
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
  title?: string
  usage?: Usage
  cost?: number
  turns?: number
  /** 0–100; context window fill from session.usage. */
  contextPct?: number
  queue?: ReadonlyArray<string>
  onSend: (text: string) => void
  onSlash: (cmd: SlashCommand) => void
  onEnqueue?: (text: string) => void
  onDequeue?: (i: number) => void
}

function fmt(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export const Composer = memo(forwardRef<ComposerHandle, Props>((props, ref) => {
  const theme = useTheme().theme
  const gw = useGateway()
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

  // Multi-line insert: ≥`limit` lines → gateway writes a temp file and
  // hands back a `[Pasted #N …]` placeholder (hermes CLI convention;
  // expanded server-side in prompt.submit). Below limit: flatten
  // newlines to spaces (single-line <input>).
  const insert = useCallback((text: string, limit: number) => {
    const lines = text.split("\n").length
    const flat = () => setInput(v => v + text.replace(/\s*\n\s*/g, " "))
    if (lines < limit) return flat()
    gw.request<{ placeholder: string }>("paste.collapse", { text })
      .then(r => setInput(v => v + r.placeholder + " "))
      .catch(flat)
  }, [gw])

  const paste = useCallback((e: PasteEvent) => {
    const text = decodePasteBytes(e.bytes)
    if (!text.includes("\n")) return // let Input.handlePaste do it
    e.preventDefault()
    insert(text, 5)
  }, [insert])

  const submit = () => {
    // While streaming, slash/at popovers are suppressed; anything
    // typed is a plain prompt to enqueue.
    if (live.current.props.streaming) {
      const text = live.current.input.trim()
      if (!text || !live.current.props.ready) return
      hist.push(text)
      setInput("")
      live.current.props.onEnqueue?.(text)
      return
    }
    const a = live.current.at
    if (a.open) return atAccept()
    const p = live.current.pop
    if (p.open) {
      const c = p.popover?.[p.cursor]
      if (c) select(c)
      return
    }
    const text = live.current.input.trim()
    if (!text || !live.current.props.ready) return
    hist.push(text)
    setInput("")
    live.current.props.onSend(text)
  }

  useImperativeHandle(ref, () => ({
    value: () => live.current.input,
    set: setInput,
    insert: (text) => insert(text, 2),
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
  }), [hist.up, hist.down, pop.setCursor, insert])

  const active = props.focused && !props.streaming
  const label = !props.ready ? "Connecting..."
    : props.streaming ? (props.status || "Generating...")
    : "Ready"
  const dot = props.ready ? (props.streaming ? theme.warning : theme.success) : theme.error

  const stats: string[] = []
  if (props.title) stats.push(`"${props.title}"`)
  if (props.model) stats.push(props.model)
  if (props.turns) stats.push(`${props.turns} turns`)
  if (props.usage) stats.push(`${fmt(props.usage.input)}→${fmt(props.usage.output)}`)
  if (props.cost != null && props.cost > 0) stats.push(`$${props.cost.toFixed(2)}`)

  // Context fill — shown as its own colored segment so it can tint
  // independently of the rest of the (muted) stats line. Mirrors the
  // hermes CLI status bar's yellow→orange→red ramp.
  const pct = props.contextPct
  const ctxFg = pct == null ? undefined
    : pct >= 85 ? theme.error
    : pct >= 70 ? theme.warning
    : pct >= 50 ? theme.accent
    : theme.textMuted

  const hint = props.streaming
    ? (input ? "Enter: Queue · " : "") + "Esc×2: Interrupt" + ((props.queue?.length ?? 0) > 0 ? " · Ctrl+U: Pop queued" : "")
    : pop.open ? "↑↓: Navigate · Tab: Complete · Enter: Run · Esc: Close"
    : at.open ? "↑↓: Navigate · Tab/Enter: Insert · Esc: Close"
    : props.focused ? "Enter: Send · ↑↓: History · /: Commands · @: Context · Ctrl+G: Editor"
    : "Tab: Focus input · Esc: Focus input"

  return (
    <box flexDirection="column" position="relative">
      {active && pop.open ? (
        <box position="absolute" bottom={4} left={0} right={0}>
          <SlashPopover
            commands={pop.popover!}
            cursor={pop.cursor}
            onCursor={pop.setCursor}
            onSelect={select}
          />
        </box>
      ) : active && at.open ? (
        <box position="absolute" bottom={4} left={0} right={0}>
          <AtRefPopover
            items={at.items}
            cursor={at.cursor}
            onCursor={at.setCursor}
            onSelect={atAccept}
          />
        </box>
      ) : null}

      {(props.queue?.length ?? 0) > 0 ? (
        <box flexDirection="column" paddingX={1} paddingBottom={1}>
          {props.queue!.map((q, i) => (
            <box key={i} height={1} onMouseDown={() => props.onDequeue?.(i)}>
              <text>
                <span fg={theme.borderSubtle}>{i === 0 ? "╭" : "│"} </span>
                <span fg={theme.textMuted}>⏸ {i + 1}. {trunc(q, 60)}</span>
              </text>
            </box>
          ))}
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
          onPaste={paste}
          placeholder={props.streaming ? "Type to queue... (Enter queues, Ctrl+U pops)" : "Message Hermes... (/ for commands)"}
          focused={props.focused}
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
            {pct != null ? <span fg={ctxFg}> · ctx {Math.round(pct)}%</span> : null}
          </text>
        </box>
        <box>
          <text fg={theme.textMuted}>{hint}</text>
        </box>
      </box>
    </box>
  )
}))
