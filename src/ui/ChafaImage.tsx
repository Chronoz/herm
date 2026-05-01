// Inline image rendering via chafa + the SGR parser (utils/chafa.ts).
// Shown in-transcript when an assistant response or user attachment contains
// MEDIA:/path/to/image.ext. Click to collapse to a compact chip; click chip
// to re-expand. Any render failure (chafa missing, file gone, timeout)
// silently degrades to the plain MediaChip — no error chrome in the stream.

import { memo, useMemo, useState } from "react"
import { useTheme } from "../theme"
import { openFile } from "../utils/open-file"
import { renderChafa, hex, chafaBin } from "../utils/chafa"
import { MediaChip } from "../components/chat/MediaChip"

const basename = (p: string) => p.split(/[/\\]/).pop() || p

type Props = { path: string; width?: number }

export const ChafaImage = memo(({ path, width }: Props) => {
  const theme = useTheme().theme
  const [collapsed, setCollapsed] = useState(false)
  const w = Math.max(20, Math.min(80, width ?? 60))
  const hasChafa = chafaBin() !== null
  const result = useMemo(
    () => hasChafa ? renderChafa(path, w) : ({ err: "chafa not installed" } as const),
    [path, w, hasChafa],
  )

  // chafa missing or render failed → stream the MediaChip, no chrome
  if (!hasChafa || "err" in result) return <MediaChip path={path} />

  // Collapsed state wraps MediaChip so click re-expands. Don't reuse its
  // onMouseDown openFile behavior here — in-chat toggle takes precedence.
  if (collapsed) {
    return (
      <box onMouseDown={() => setCollapsed(false)}>
        <MediaChip path={path} />
      </box>
    )
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="column" onMouseDown={() => setCollapsed(true)}>
        {result.rows.map((row, i) => (
          <text key={i}>
            {row.map((c, j) => (
              <span key={j} fg={hex(c.fg)} bg={hex(c.bg)}>{c.ch}</span>
            ))}
          </text>
        ))}
      </box>
      <box height={1} onMouseDown={() => openFile(path)}>
        <text>
          <span fg={theme.textMuted}>{"  "}</span>
          <span fg={theme.accent}>◉ </span>
          <span fg={theme.text}>{basename(path)}</span>
          <span fg={theme.textMuted}>{"  click image to collapse · click name to open"}</span>
        </text>
      </box>
    </box>
  )
})
