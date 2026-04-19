import { memo } from "react"
import { useTheme } from "../../theme"

/** Heuristic: unified-diff output from patch/edit tools. */
export function isDiff(s: string | undefined): boolean {
  if (!s) return false
  return /^--- a\//m.test(s) || /^@@ /m.test(s) || /^diff --git /m.test(s)
}

const CAP = 80

/**
 * Line-colored unified diff. OpenTUI ships a native `<diff>` renderable
 * (split/unified, line numbers), but it manages its own scroll regions
 * and height — heavy for an inline preview nested inside the chat
 * scrollbox. This block renders one `<text>` per line with theme colors
 * and a hard 80-line cap so layout stays stable.
 */
export const DiffBlock = memo(({ text }: { text: string }) => {
  const theme = useTheme().theme
  const all = text.replace(/\n$/, "").split("\n")
  const rows = all.slice(0, CAP)
  const more = all.length - rows.length

  const fg = (l: string) =>
    l.startsWith("@@") ? theme.accent
    : l.startsWith("+++") || l.startsWith("---") ? theme.textMuted
    : l.startsWith("+") ? theme.success
    : l.startsWith("-") ? theme.error
    : theme.textMuted

  return (
    <box flexDirection="column" backgroundColor={theme.backgroundPanel}>
      {rows.map((l, i) => (
        <box key={i} height={1}>
          <text fg={fg(l)}>{l || " "}</text>
        </box>
      ))}
      {more > 0 ? (
        <box height={1}>
          <text fg={theme.textMuted}>… {more} more lines</text>
        </box>
      ) : null}
    </box>
  )
})
