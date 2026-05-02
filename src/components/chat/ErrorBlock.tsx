// Turn-level error card — a failed assistant turn (API error, agent
// crash) renders this in place of the ✗ one-liner. Uses the same
// panel grammar as BlockTool (┃ left bar, backgroundPanel) so it
// reads as "a block in the trail that happens to be red."

import { memo, useEffect, useState } from "react"
import { LEFT_BAR } from "../../ui/borders"
import { useTheme } from "../../theme"
import { copy } from "../../utils/clipboard"

const CAP = 6

export const ErrorBlock = memo(({ text }: { text: string }) => {
  const theme = useTheme().theme
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const lines = text.trimEnd().split("\n")
  const head = lines[0] || "Error"
  const body = lines.slice(1)
  const over = body.length > CAP
  const shown = open || !over ? body : body.slice(0, CAP)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const doCopy = () => {
    void copy(text)
    setCopied(true)
  }

  return (
    <box
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={LEFT_BAR}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      flexDirection="column"
      gap={1}
    >
      <box flexDirection="row" height={1}>
        <box flexGrow={1}>
          <text><span fg={theme.error}>✗ </span><span fg={theme.text}>{head}</span></text>
        </box>
        <box onMouseDown={doCopy} paddingX={1}>
          <text fg={copied ? theme.success : theme.textMuted}>{copied ? "copied" : "copy"}</text>
        </box>
      </box>
      {shown.length ? (
        <box flexDirection="column" onMouseDown={over ? () => setOpen(o => !o) : undefined}>
          {shown.map((l, i) => (
            <box key={i} height={1}><text fg={theme.textMuted}>{l || " "}</text></box>
          ))}
          {over ? (
            <box height={1}>
              <text fg={theme.textMuted}>{open ? "Click to collapse" : `… ${body.length - CAP} more — click to expand`}</text>
            </box>
          ) : null}
        </box>
      ) : null}
    </box>
  )
})
