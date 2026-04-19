import { useState, useEffect, useCallback, memo } from "react"
import { useKeyboard } from "@opentui/react"
import { analytics, type Analytics as Data } from "../utils/hermes-analytics"
import { useTheme } from "../theme"
import { TabShell } from "../ui/shell"
import { KVBlock } from "../ui/kv"
import { fmt, cost, trunc } from "../ui/fmt"

const SPARK = "▁▂▃▄▅▆▇█"

const bar = (val: number, max: number) =>
  "▆".repeat(max > 0 ? Math.round(20 * val / max) : 0)

const spark = (vals: number[]) => {
  const max = Math.max(1, ...vals)
  return vals.map(v => SPARK[Math.min(7, Math.floor(8 * v / max))]).join("")
}

export const Analytics = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Data>(() => analytics(7))

  const load = useCallback(() => setData(analytics(days)), [days])
  useEffect(load, [load])

  useKeyboard((key) => {
    if (!props.focused) return
    if (key.raw === "1") return setDays(1)
    if (key.raw === "7") return setDays(7)
    if (key.raw === "3") return setDays(30)
    if (key.raw === "r") return load()
  })

  const peak = Math.max(1, ...data.byModel.map(m => m.tokens))

  return (
    <TabShell
      title={`Analytics · ${days}d`}
      hint="1/7/3 period  r reload"
    >
      <KVBlock rows={[
        ["Sessions", String(data.total.sessions)],
        ["Messages", String(data.total.messages)],
        ["Tokens", fmt(data.total.tokens)],
        ["Cost", cost(data.total.cost), theme.accent],
      ]} />

      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>By model</text></box>

      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          {data.byModel.length === 0
            ? <box key="none" height={1}><text fg={theme.textMuted}>no sessions in range</text></box>
            : data.byModel.map(m => (
                <box key={m.model} height={1} flexDirection="row">
                  <box width={28} flexShrink={0}>
                    <text fg={theme.text}>{trunc(m.model, 27)}</text>
                  </box>
                  <box width={22} flexShrink={0}>
                    <text fg={theme.primary}>{bar(m.tokens, peak)}</text>
                  </box>
                  <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
                    <text>
                      <span fg={theme.text}>{fmt(m.tokens).padStart(8)}</span>
                      <span fg={theme.accent}>{cost(m.cost).padStart(9)}</span>
                      <span fg={theme.textMuted}>{`  ${m.sessions} sess`}</span>
                    </text>
                  </box>
                </box>
              ))}
        </box>
      </scrollbox>

      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>{`By day (${data.byDay.length})`}</text></box>
      <box height={1}>
        <text fg={theme.success}>{spark(data.byDay.map(d => d.tokens))}</text>
      </box>
      <box height={1}>
        <text fg={theme.textMuted}>
          {data.byDay.length > 0
            ? `${data.byDay[0].date} → ${data.byDay[data.byDay.length - 1].date}`
            : "—"}
        </text>
      </box>
    </TabShell>
  )
})
