// MEDIA: directive rendering — `MEDIA:/path` lines in assistant output
// become clickable chips instead of literal text. Neither reference
// (Ink nor opencode) renders pixels; both surface an openable link.
// OpenTUI has no image primitive, so this is the ceiling for now.

import { memo, useState } from "react"
import { TextAttributes } from "@opentui/core"
import { openFile } from "../../utils/open-file"
import { useTheme } from "../../theme"

// Ink's canonical regex. Match-per-line only — a MEDIA path is the
// whole line, optionally wrapped in backticks/quotes by the model.
export const MEDIA_LINE_RE = /^\s*[`"']?MEDIA:\s*(\S+?)[`"']?\s*$/

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus"])
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv"])

export type MediaKind = "img" | "audio" | "video" | "file" | "url"

export function classify(path: string): MediaKind {
  if (/^https?:\/\//i.test(path)) return "url"
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (IMAGE_EXT.has(ext)) return "img"
  if (AUDIO_EXT.has(ext)) return "audio"
  if (VIDEO_EXT.has(ext)) return "video"
  return "file"
}

const basename = (p: string) => p.split(/[/\\]/).pop() || p

type Seg = { md: string } | { media: string }

// Split text into alternating markdown / media segments. Adjacent
// markdown lines are re-joined so OpenTUI's MarkdownRenderable still
// sees complete fenced blocks etc. MEDIA lines inside fenced code are
// left as literal text (they're examples, not directives).
export function splitMedia(text: string): Seg[] {
  if (!text.includes("MEDIA:")) return [{ md: text }]
  const out: Seg[] = []
  let buf: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (buf.length) out.push({ md: buf.join("\n") })
    buf = []
  }
  for (const line of text.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (f) {
      if (fence && f[0] === fence[0] && f.length >= fence.length) fence = null
      else if (!fence) fence = f
      buf.push(line)
      continue
    }
    const m = !fence && line.match(MEDIA_LINE_RE)?.[1]
    if (m) { flush(); out.push({ media: m }); continue }
    buf.push(line)
  }
  flush()
  return out
}

export const MediaChip = memo((props: { path: string }) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  const kind = classify(props.path)
  const badge = {
    img: theme.accent, audio: theme.warning, video: theme.info,
    url: theme.primary, file: theme.secondary,
  }[kind]
  return (
    <box
      flexDirection="row" height={1}
      onMouseDown={() => openFile(props.path)}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text>
        <span bg={badge} fg={theme.background}> {kind} </span>
        <span bg={theme.backgroundElement} fg={theme.text}
              attributes={hover ? TextAttributes.UNDERLINE : TextAttributes.NONE}>
          {" "}{basename(props.path)}{" "}
        </span>
      </text>
    </box>
  )
})
