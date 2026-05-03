// Auto-confirm countdown dialog. Fires `onFire()` when the counter
// hits 0 unless cancelled. Any key cancels — a judge misfire that
// suspends the box mid-demo is the failure mode we're guarding.

import { useEffect, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

type Props = {
  title: string
  body: string
  /** What the action does — shown under the countdown. */
  action: string
  seconds: number
  onFire: () => void
  onCancel: () => void
}

const Countdown = (p: Props) => {
  const theme = useTheme().theme
  const [n, setN] = useState(p.seconds)

  // Single chained timeout per tick; cleanup cancels. A countdown is
  // time-driven by definition — the `setTimeout` smell rule is about
  // render choreography, which this isn't.
  useEffect(() => {
    if (n <= 0) { p.onFire(); return }
    const t = setTimeout(() => setN(v => v - 1), 1000)
    return () => clearTimeout(t)
  }, [n, p.onFire])

  useKeyboard(() => p.onCancel())

  const bar = "█".repeat(n) + "░".repeat(Math.max(0, p.seconds - n))
  return (
    <box flexDirection="column" width={58}>
      <box height={1}><text fg={theme.warning}><strong>{p.title}</strong></text></box>
      <box height={1} />
      <box minHeight={1}><text wrapMode="word">{p.body}</text></box>
      <box height={1} />
      <box height={1}><text fg={theme.warning}>{bar}  {n}s</text></box>
      <box height={1}><text fg={theme.textMuted}>{p.action}</text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>press any key to cancel</text></box>
    </box>
  )
}

export function openCountdown(
  dialog: DialogContext,
  opts: Omit<Props, "onFire" | "onCancel">,
): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.replace(
      <Countdown
        {...opts}
        onFire={() => { dialog.clear(); resolve(true) }}
        onCancel={() => { dialog.clear(); resolve(false) }}
      />,
      () => resolve(false),
    )
  })
}
