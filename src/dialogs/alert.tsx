// Scrollable read-only text dialog — oc ui/dialog-alert equivalent.

import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { copy } from "../utils/clipboard"

export function openAlert(dialog: DialogContext, title: string, body: string) {
  dialog.replace(<Alert title={title} body={body} onClose={() => dialog.clear()} />)
}

const Alert = (props: { title: string; body: string; onClose: () => void }) => {
  const theme = useTheme().theme
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") props.onClose()
    if (key.name === "c") void copy(props.body)
  })
  return (
    <box flexDirection="column" width={84} maxHeight={28}
         border={["left"]} borderColor={theme.info}
         customBorderChars={{ topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
           horizontal: "", vertical: "┃", topT: "", bottomT: "", leftT: "", rightT: "", cross: "" }}
         backgroundColor={theme.backgroundPanel}
         paddingLeft={2} paddingRight={2} paddingY={1} gap={1}>
      <box height={1}>
        <text><span fg={theme.info}>◈ </span><span fg={theme.text}>{props.title}</span></text>
      </box>
      <scrollbox scrollY flexGrow={1}>
        <text fg={theme.text} wrapMode="word">{props.body}</text>
      </scrollbox>
      <box height={1}>
        <text fg={theme.textMuted}>esc close · c copy</text>
      </box>
    </box>
  )
}
