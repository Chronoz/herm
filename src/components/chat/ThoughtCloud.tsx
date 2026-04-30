// Eikon thought cloud — shows the non-output parts of a turn
// (reasoning, tool trail, status). Sits in flow above the chat scroll.
// Auto-opens while the assistant is reasoning or running tools, closes
// once text is streaming; pinning a past message holds it open. The
// tail bubbles live on the Sidebar avatar.

import { memo, useEffect, useRef, useState } from "react"
import type { BorderCharacters, MouseEvent } from "@opentui/core"
import type { Message, Part, ThinkingPart, ToolPart } from "../../types/message"
import { Tool } from "./tool"
import { usePref } from "../../utils/preferences"
import { useTheme } from "../../theme"

export const CLOUD_MIN = 12
const CLOUD_MAX = 24

// Heavy triple-dash — reads as thick + noncontinuous. Corners stay
// heavy-solid so the box parses as a bubble, not a grid.
const CLOUD: BorderCharacters = {
  topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛",
  horizontal: "┅", vertical: "┇",
  topT: "┅", bottomT: "┅", leftT: "┇", rightT: "┇", cross: "╋",
}

// Stepped bubbles bridging the cloud to the avatar's upper-left. Three
// slots, big→small top→bottom. When animating, one slot is lit per
// frame and travels bottom→top (away from the head, into the cloud);
// the trailing empty frame reads as the bubble entering the cloud.
const SLOTS = [
  ["┏┅┅┓   ", "┗┅┅┛   "],
  ["   ┏┓  ", "   ┗┛  "],
  ["     ╸ ", "       "],
]
const BLANK = "       "
const ORDER = [2, 1, 0, -1]

export const Tail = memo((props: { run: boolean }) => {
  const theme = useTheme().theme
  const [f, setF] = useState(0)
  useEffect(() => {
    if (!props.run) { setF(0); return }
    const t = setInterval(() => setF(p => (p + 1) % ORDER.length), 160)
    return () => clearInterval(t)
  }, [props.run])
  const lit = props.run ? ORDER[f] : null
  return (
    <box flexDirection="column">
      {SLOTS.flatMap((slot, i) =>
        slot.map((l, j) => (
          <text key={`${i}-${j}`} fg={theme.hermAvatar}>
            {lit === null || lit === i ? l : BLANK}
          </text>
        )),
      )}
    </box>
  )
})

function parts(m: Message | undefined): Part[] {
  return m?.parts.filter(p => p.type !== "text") ?? []
}

function latest(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "assistant") return messages[i]
  return undefined
}

// Rough row cost — enough for auto-grow between MIN and MAX.
function rows(list: Part[]): number {
  return list.reduce((n, p) =>
    n + (p.type === "thinking" ? Math.ceil(p.content.length / 80) || 1
       : p.type === "tool" && p.diff ? 6
       : 1), 0)
}

export const ThoughtCloud = memo((props: {
  height: number
  messages: Message[]
  streaming: boolean
  status: string
  pick?: Message
  onResize: (h: number) => void
  onClose?: () => void
}) => {
  const theme = useTheme().theme
  const detail = usePref("toolDetails") ?? "expanded"
  const src = props.pick ?? latest(props.messages)
  const body = parts(src)

  // Auto-grow: track content until the user drags; then their size
  // sticks. `want` is the dep so growth follows streamed thinking text,
  // not just part count.
  const manual = useRef(false)
  const want = Math.min(CLOUD_MAX, Math.max(CLOUD_MIN, rows(body) + 3))
  const resize = props.onResize
  useEffect(() => {
    if (!manual.current) resize(want)
  }, [want, resize])

  // Drag-resize via the bottom edge. MouseEvent.y is absolute terminal
  // row; delta from the drag origin maps 1:1 to height rows.
  const drag = useRef<{ y: number; h: number } | null>(null)
  const grab = (e: MouseEvent) => {
    drag.current = { y: e.y, h: props.height }
    manual.current = true
    e.stopPropagation()
  }
  const move = (e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    resize(Math.min(CLOUD_MAX, Math.max(CLOUD_MIN, d.h + (e.y - d.y))))
  }
  const drop = () => { drag.current = null }

  // Click-to-close on the header strip only (not the body — scrolling
  // through reasoning text shouldn't dismiss the cloud). Same down→up
  // guard as MessageItem so selection drags don't trigger it.
  const at = useRef<{ x: number; y: number } | null>(null)
  const down = (e: MouseEvent) => { at.current = { x: e.x, y: e.y } }
  const up = (e: MouseEvent) => {
    const a = at.current
    at.current = null
    if (props.onClose && a && a.x === e.x && a.y === e.y) props.onClose()
  }

  return (
    <box
      height={props.height} flexDirection="column" position="relative"
      border borderColor={theme.hermAvatar} customBorderChars={CLOUD}
      backgroundColor={theme.backgroundPanel} paddingX={1}
    >
      <box height={1} flexShrink={0} flexDirection="row"
           onMouseDown={down} onMouseUp={up}>
        <box flexGrow={1}>
          <text fg={theme.textMuted}>
            {props.streaming ? (props.status || "· · ·") : ""}
          </text>
        </box>
        {detail !== "expanded" ? (
          <box marginRight={1}><text fg={theme.textMuted}>⟨{detail}⟩</text></box>
        ) : null}
        {props.onClose ? (
          <box width={1}><text fg={theme.textMuted}>×</text></box>
        ) : null}
      </box>
      <scrollbox scrollY stickyScroll stickyStart="bottom" flexGrow={1}>
        <box flexDirection="column" width="100%">
          {body.map((p, i) =>
            p.type === "thinking"
              ? <box key={(p as ThinkingPart).key ?? `th-${i}`} minHeight={1}>
                  <text fg={theme.textMuted} wrapMode="word">{(p as ThinkingPart).content}</text>
                </box>
              : <Tool key={(p as ToolPart).id || `t-${i}`} tool={p as ToolPart} detail={detail} />,
          )}
        </box>
      </scrollbox>
      <box position="absolute" left={0} right={0} bottom={0} height={1}
           onMouseDown={grab} onMouseDrag={move} onMouseUp={drop} onMouseDragEnd={drop} />
    </box>
  )
})
