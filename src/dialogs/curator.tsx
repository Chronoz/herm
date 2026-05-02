// Curator report viewer. Reads .curator_state + the newest
// logs/curator/*/REPORT.md directly; no gateway RPC involved.

import { useEffect, useState } from "react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { useHome } from "../home"
import { readLatestCuratorReport, type CuratorReportInfo } from "../utils/hermes-home"
import { KVLink } from "../components/ui/FileLink"
import { ago } from "../ui/fmt"

const iso = (s: string | null | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

const CuratorDialog = () => {
  const { theme, syntaxStyle } = useTheme()
  const state = useHome("curatorState")
  const [report, setReport] = useState<CuratorReportInfo | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    readLatestCuratorReport()
      .then(r => { setReport(r); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  const last = iso(state?.last_run_at ?? null)

  return (
    <box flexDirection="column" width={110} height={32}>
      <box height={1}>
        <text>
          <span fg={theme.primary}><strong>Skill Curator</strong></span>
          {state?.paused ? <span fg={theme.warning}>  · paused</span> : null}
        </text>
      </box>
      <box height={1}>
        <text fg={theme.textMuted}>
          {state
            ? `${state.run_count} run${state.run_count === 1 ? "" : "s"}${last ? " · last " + ago(last) : " · never"} · Esc to close`
            : "No curator state yet · Esc to close"}
        </text>
      </box>
      <box height={1} />

      {state?.last_run_summary ? (
        <box minHeight={1}>
          <text fg={theme.text} wrapMode="word">{state.last_run_summary}</text>
        </box>
      ) : null}
      {state?.last_run_summary ? <box height={1} /> : null}

      {!loaded ? (
        <box height={1}><text fg={theme.textMuted}>loading report…</text></box>
      ) : report ? (
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          <box height={1}><text fg={theme.info}><strong>{`▾ Report · ${report.runId}`}</strong></text></box>
          <KVLink label="File" source={report.source} text={report.source.relative} />
          <box height={1} />
          <scrollbox scrollY flexGrow={1}>
            <box flexDirection="column" width="100%">
              <markdown content={report.content || "(empty)"}
                fg={theme.markdownText} syntaxStyle={syntaxStyle} />
            </box>
          </scrollbox>
        </box>
      ) : (
        <box height={1}><text fg={theme.textMuted}>No runs yet — curator has not completed a cycle.</text></box>
      )}
    </box>
  )
}

export const openCurator = (dialog: DialogContext) =>
  dialog.replace(<CuratorDialog />)
