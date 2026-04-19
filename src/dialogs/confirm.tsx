// Generic y/n confirm dialog. `openConfirm(dialog, {...})` resolves to
// true on [y], false on [n]/Esc.

import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

type Props = {
  title: string
  body: string
  yes?: string
  no?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const Confirm = (props: Props) => {
  const theme = useTheme().theme
  useKeyboard((key) => {
    if (key.name === "y") return props.onConfirm()
    if (key.name === "n" || key.name === "escape") return props.onCancel()
  })
  return (
    <box flexDirection="column" width={54}>
      <box height={1}>
        <text fg={props.danger ? theme.warning : theme.primary}>
          <strong>{props.title}</strong>
        </text>
      </box>
      <box height={1} />
      <box minHeight={1}><text wrapMode="word">{props.body}</text></box>
      <box height={1} />
      <box height={1}>
        <text fg={theme.textMuted}>
          {`[y] ${props.yes ?? "confirm"}   [n] ${props.no ?? "cancel"}`}
        </text>
      </box>
    </box>
  )
}

export function openConfirm(
  dialog: DialogContext,
  opts: Omit<Props, "onConfirm" | "onCancel">,
): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.replace(
      <Confirm
        {...opts}
        onConfirm={() => { dialog.clear(); resolve(true) }}
        onCancel={() => { dialog.clear(); resolve(false) }}
      />,
    )
  })
}
