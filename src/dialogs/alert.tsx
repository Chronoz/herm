// Scrollable read-only text dialog — oc ui/dialog-alert equivalent.

import { useKeyboard } from "@opentui/react"
import { useKeys } from "../keys"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { copy } from "../utils/clipboard"

export function openAlert(dialog: DialogContext, title: string, body: string) {
  dialog.replace(<Alert title={title} body={body} onClose={() => dialog.clear()} />)
}

const Alert = (props: { title: string; body: string; onClose: () => void }) => {
  const theme = useTheme().theme
  const keys = useKeys()
  useKeyboard((key) => {
    if (keys.match("dialog.cancel", key) || keys.match("dialog.accept", key)) props.onClose()
    if (keys.match("dialog.copy", key)) void copy(props.body)
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
        <text fg={theme.textMuted}>{`${keys.print("dialog.cancel")} close · ${keys.print("dialog.copy")} copy`}</text>
      </box>
    </box>
  )
}
