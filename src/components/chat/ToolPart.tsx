import { memo, useCallback, useMemo, useState } from "react"
import type { ToolPart as Part } from "../../types/message"
import { DiffBlock, isDiff } from "./DiffBlock"
import { useTheme } from "../../theme"
import { useSpinnerGlyph } from "../../ui/spinner"

/** First non-empty string value in an args object, truncated. */
function brief(args: string, max = 40): string {
  if (!args) return ""
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    const v = Object.values(obj).find(x => typeof x === "string" && x.trim().length > 0) as string | undefined
    const s = (v ?? "").replace(/\s+/g, " ").trim()
    return s.length > max ? s.slice(0, max) + "…" : s
  } catch {
    const s = args.replace(/\s+/g, " ").trim()
    return s.length > max ? s.slice(0, max) + "…" : s
  }
}

/** Parse args JSON into [key, value-string] pairs for the expanded view. */
function kv(args: string): [string, string][] {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    return Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ])
  } catch {
    return args ? [["input", args]] : []
  }
}

function ms(d?: number): string {
  if (d == null) return ""
  return d < 10000 ? `${Math.round(d)}ms` : `${(d / 1000).toFixed(1)}s`
}

export const ToolPart = memo(({ tool }: { tool: Part }) => {
  const theme = useTheme().theme
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(o => !o), [])

  const running = tool.status === "running"
  const failed = tool.status === "error"
  const tint = failed ? theme.error : running ? theme.warning : theme.textMuted
  const spin = useSpinnerGlyph(running)
  const glyph = running ? spin : open ? "▾" : "▸"

  const sum = useMemo(() => brief(tool.args) || tool.preview || "", [tool.args, tool.preview])
  const pairs = useMemo(() => kv(tool.args), [tool.args])
  const diff = useMemo(
    () => tool.diff ?? (isDiff(tool.result) ? tool.result : undefined),
    [tool.diff, tool.result],
  )
  const lines = useMemo(
    () => (tool.result ?? "").split("\n").filter(l => l.length > 0).slice(0, 5),
    [tool.result],
  )

  return (
    <box flexDirection="column">
      <box height={1} onMouseDown={toggle}>
        <text>
          <span fg={tint}>{glyph} </span>
          <span fg={theme.text}>{tool.name}</span>
          {sum ? <span fg={theme.textMuted}>  {sum}</span> : null}
          {diff && !open ? <span fg={theme.accent}>  ±</span> : null}
          {tool.duration != null ? <span fg={theme.textMuted}>  {ms(tool.duration)}</span> : null}
        </text>
      </box>
      {open ? (
        <box flexDirection="column" paddingLeft={2} marginBottom={1}>
          {pairs.map(([k, v]) => (
            <box key={k} height={1}>
              <text>
                <span fg={theme.textMuted}>{k} </span>
                <span fg={theme.text}>{v.replace(/\n/g, "⏎").slice(0, 120)}</span>
              </text>
            </box>
          ))}
          {diff ? (
            <box marginTop={pairs.length ? 1 : 0}>
              <DiffBlock text={diff} />
            </box>
          ) : lines.length ? (
            <box flexDirection="column" marginTop={pairs.length ? 1 : 0}>
              {lines.map((l, i) => (
                <box key={i} height={1}>
                  <text fg={theme.textMuted}>{l}</text>
                </box>
              ))}
            </box>
          ) : null}
        </box>
      ) : null}
    </box>
  )
})
