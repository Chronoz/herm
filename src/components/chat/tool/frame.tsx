// InlineTool / BlockTool — the two shapes every tool renders into.
// oc's routes/session/index.tsx InlineTool/BlockTool translated to
// React/Herm theme. A tool is an inline row by default; it becomes a
// block when it has a body worth showing (diff, output, checklist).

import { memo, useState, type ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import type { ToolPart } from "../../../types/message"
import { useTheme } from "../../../theme"
import { useSpinnerGlyph } from "../../../ui/spinner"
import { spec } from "./preview"

function ms(d?: number): string {
  if (d == null) return ""
  if (d < 1000) return `${Math.round(d)}ms`
  if (d < 60000) return `${(d / 1000).toFixed(1)}s`
  return `${Math.floor(d / 60000)}m${Math.round((d % 60000) / 1000)}s`
}

type InlineProps = {
  part: ToolPart
  /** Content for the collapsed row; usually preview text. */
  children: ReactNode
  /** True once enough input exists to show `children` instead of pending. */
  complete?: boolean
  iconColor?: RGBA
  onClick?: () => void
}

export const InlineTool = memo((p: InlineProps) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  const s = spec(p.part.name)
  const running = p.part.status === "running"
  const failed = p.part.status === "error"
  const spin = useSpinnerGlyph(running)

  const fg = failed ? theme.error
    : hover && p.onClick ? theme.text
    : running ? theme.text
    : theme.textMuted

  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      onMouseOver={p.onClick ? () => setHover(true) : undefined}
      onMouseOut={p.onClick ? () => setHover(false) : undefined}
      onMouseDown={p.onClick}
    >
      <box height={1}>
        <text>
          <span fg={running ? theme.warning : p.iconColor ?? fg}>{running ? spin : s.icon} </span>
          {p.complete ?? true
            ? <span fg={fg}>{p.children}</span>
            : <span fg={fg}>~ {s.pending}</span>}
          {p.part.duration != null
            ? <span fg={theme.textMuted}>  {ms(p.part.duration)}</span>
            : null}
        </text>
      </box>
      {failed && p.part.result ? (
        <box minHeight={1} paddingLeft={2}>
          <text fg={theme.error} wrapMode="word">{p.part.result}</text>
        </box>
      ) : null}
    </box>
  )
})

type BlockProps = {
  part: ToolPart
  title: string
  children: ReactNode
  onClick?: () => void
}

export const BlockTool = memo((p: BlockProps) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  const running = p.part.status === "running"
  const failed = p.part.status === "error"
  const spin = useSpinnerGlyph(running)

  return (
    <box
      border={["left"]}
      borderColor={theme.background}
      customBorderChars={{
        topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
        horizontal: "", vertical: "┃", topT: "", bottomT: "", leftT: "", rightT: "", cross: "",
      }}
      backgroundColor={hover ? theme.backgroundMenu : theme.backgroundPanel}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      flexDirection="column"
      gap={1}
      onMouseOver={p.onClick ? () => setHover(true) : undefined}
      onMouseOut={p.onClick ? () => setHover(false) : undefined}
      onMouseDown={p.onClick}
    >
      <box height={1}>
        {running
          ? <text><span fg={theme.warning}>{spin} </span><span fg={theme.textMuted}>{p.title.replace(/^# /, "")}</span></text>
          : <text fg={theme.textMuted}>{p.title}</text>}
      </box>
      {p.children}
      {failed && p.part.result ? (
        <box minHeight={1}>
          <text fg={theme.error} wrapMode="word">{p.part.result}</text>
        </box>
      ) : null}
    </box>
  )
})

/** Click-to-expand text body capped at `cap` lines. */
export const Overflow = memo(({ text, cap = 10 }: { text: string; cap?: number }) => {
  const theme = useTheme().theme
  const [open, setOpen] = useState(false)
  const lines = text.split("\n")
  const over = lines.length > cap
  const body = open || !over ? text : [...lines.slice(0, cap), "…"].join("\n")
  return (
    <box flexDirection="column" gap={1} onMouseDown={over ? () => setOpen(o => !o) : undefined}>
      <text fg={theme.text}>{body}</text>
      {over ? (
        <text fg={theme.textMuted}>{open ? "Click to collapse" : "Click to expand"}</text>
      ) : null}
    </box>
  )
})
