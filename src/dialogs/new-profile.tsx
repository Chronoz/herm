import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { validateName } from "../utils/hermes-profiles"
import type { DialogContext } from "../ui/dialog"

type Result = { name: string; cloneFrom: string | null; alias: boolean }

export function openCreateProfile(dialog: DialogContext, opts: { existing: string[] }): Promise<Result | null> {
  return new Promise(resolve => {
    const done = (r: Result | null) => { dialog.clear(); resolve(r) }
    dialog.replace(<Form existing={opts.existing} done={done} />)
  })
}

const Form = ({ existing, done }: { existing: string[]; done: (r: Result | null) => void }) => {
  const theme = useTheme().theme
  const [name, setName] = useState("")
  const [cloneIdx, setCloneIdx] = useState(0)
  const [alias, setAlias] = useState(true)
  const options = ["(fresh)", ...existing]
  const err = name ? validateName(name, existing) : null
  const valid = !!name && !err

  useKeyboard((key) => {
    if (key.name === "escape") return done(null)
    if (key.name === "return") {
      if (!valid) return
      return done({ name, cloneFrom: cloneIdx === 0 ? null : options[cloneIdx], alias })
    }
    if (key.name === "up") return setCloneIdx(i => Math.max(0, i - 1))
    if (key.name === "down") return setCloneIdx(i => Math.min(options.length - 1, i + 1))
    if (key.name === "tab") return setAlias(a => !a)
    if (key.name === "backspace") return setName(n => n.slice(0, -1))
    if (key.raw && key.raw.length === 1 && /[a-z0-9_-]/.test(key.raw))
      return setName(n => n + key.raw)
  })

  return (
    <box flexDirection="column" width={54}>
      <box height={1}><text fg={theme.primary}><strong>New Profile</strong></text></box>
      <box height={1} />
      <box height={1} flexDirection="row">
        <box width={11}><text fg={theme.textMuted}>Name</text></box>
        <text>
          <span fg={valid || !name ? theme.text : theme.error}>{name}</span>
          <span fg={theme.accent}>█</span>
        </text>
      </box>
      <box height={1}><text fg={theme.textMuted}>  a-z 0-9 _ -  ·  lowercase</text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Clone from  (↑↓)</text></box>
      {options.map((o, i) => (
        <box key={o} height={1}>
          <text fg={i === cloneIdx ? theme.accent : theme.text}>
            {i === cloneIdx ? "▸ " : "  "}{o}
          </text>
        </box>
      ))}
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {`[Tab] shell alias: ${alias ? "yes" : "no"}`}
      </text></box>
      <box height={1}><text fg={theme.textMuted}>
        {valid ? "Enter create  ·  Esc cancel" : err ?? "type a name"}
      </text></box>
    </box>
  )
}
