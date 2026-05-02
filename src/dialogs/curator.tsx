// Curator control panel. Reads .curator_state + config.curator.*; the
// report pane shows the newest logs/curator/*/REPORT.md. Writes route
// through `shell.exec → hermes curator <verb>` so the CLI owns the
// state machine (see Agents.tsx / Kanban.tsx for the precedent).

import { useEffect, useState, useCallback } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { useGateway } from "../app/gateway"
import { useHome, home } from "../home"
import { useToast } from "../ui/toast"
import { readLatestCuratorReport, type CuratorReportInfo } from "../utils/hermes-home"
import { KVLink } from "../components/ui/FileLink"
import { KVBlock } from "../ui/kv"
import { Spinner } from "../ui/spinner"
import { ago, until, dur, trunc } from "../ui/fmt"

const iso = (s: string | null | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

type Sh = { stdout: string; stderr: string; code: number }

const CuratorDialog = () => {
  const { theme, syntaxStyle } = useTheme()
  const gw = useGateway()
  const toast = useToast()
  const state = useHome("curatorState")
  const cfg = useHome("config")?.curator
  const [report, setReport] = useState<CuratorReportInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<"run" | "pause" | "resume" | null>(null)

  useEffect(() => {
    readLatestCuratorReport()
      .then(r => { setReport(r); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  const sh = useCallback((verb: "run" | "pause" | "resume", ok: string) => {
    if (busy) return
    setBusy(verb)
    gw.request<Sh>("shell.exec", { command: `hermes curator ${verb}` })
      .then(r => {
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
        toast.show({ variant: "success", message: ok })
        home.invalidate("curatorState")
      })
      .catch((e: Error) => toast.show({ variant: "error", message: trunc(e.message, 120) }))
      .finally(() => setBusy(null))
  }, [gw, toast, busy])

  useKeyboard((key) => {
    if (key.raw === "r") return sh("run", "Curator run started (background)")
    if (key.raw === "p") return state?.paused
      ? sh("resume", "Curator resumed")
      : sh("pause", "Curator paused")
  })

  const last = iso(state?.last_run_at ?? null)
  // Next-due is last_run_at + interval_hours. CLI additionally gates on
  // min_idle_hours, so this is "eligible from", not "will fire at".
  const due = last && cfg ? last + cfg.interval_hours * 3600 : null
  const status = cfg?.enabled === false ? "disabled"
    : state?.paused ? "paused"
    : "enabled"
  const tint = status === "enabled" ? theme.success
    : status === "paused" ? theme.warning : theme.textMuted

  return (
    <box flexDirection="column" width={120} height={34}>
      <box height={1} flexDirection="row">
        <text>
          <span fg={theme.primary}><strong>Skill Curator</strong></span>
          <span fg={tint}>{`  · ${status}`}</span>
        </text>
        {busy ? <box marginLeft={2}><Spinner color={theme.textMuted} label={busy} /></box> : null}
      </box>
      <box height={1}>
        <text fg={theme.textMuted}>
          {state
            ? `${state.run_count} run${state.run_count === 1 ? "" : "s"}${last ? " · last " + ago(last) : " · never"} · Esc to close`
            : "No curator state yet · Esc to close"}
        </text>
      </box>
      <box height={1} />

      <box flexDirection="row" flexGrow={1} gap={2}>
        <box flexDirection="column" width={40} height="100%" flexShrink={0}>
          <KVBlock rows={[
            ["Next run", status !== "enabled" ? `— (${status})`
              : due ? until(due) : "when idle"],
            ["Last run", last ? ago(last) : "never"],
            ["Duration", state?.last_run_duration_seconds
              ? dur(state.last_run_duration_seconds) : undefined],
          ]} />
          <box height={1} />
          <box height={1}><text fg={theme.textMuted}>Config  ·  edit in Config tab</text></box>
          <KVBlock rows={[
            ["Interval", cfg ? `${cfg.interval_hours}h` : "—"],
            ["Stale after", cfg ? `${cfg.stale_after_days}d` : "—"],
            ["Archive after", cfg ? `${cfg.archive_after_days}d` : "—"],
          ]} />
          <box height={1} />
          <box flexDirection="column">
            <box height={1}><text>
              <span fg={theme.accent}>r </span>
              <span fg={theme.text}>run now</span>
              <span fg={theme.textMuted}>  (background)</span>
            </text></box>
            <box height={1}><text>
              <span fg={theme.accent}>p </span>
              <span fg={theme.text}>{state?.paused ? "resume" : "pause"}</span>
            </text></box>
          </box>
          {state?.last_run_summary ? <>
            <box height={1} />
            <box height={1}><text fg={theme.textMuted}>Last run</text></box>
            <scrollbox scrollY flexGrow={1}>
              <markdown content={state.last_run_summary}
                fg={theme.markdownText} syntaxStyle={syntaxStyle} />
            </scrollbox>
          </> : null}
        </box>

        {!loaded ? (
          <box height={1}><text fg={theme.textMuted}>loading report…</text></box>
        ) : report ? (
          <box flexDirection="column" flexGrow={1} height="100%" minWidth={0}>
            <box height={1}><text fg={theme.info}><strong>{`▾ Report · ${report.runId}`}</strong></text></box>
            <KVLink label="File" source={report.source} text={report.source.relative} />
            <box height={1} />
            <scrollbox scrollY flexGrow={1} border borderColor={theme.border}
              paddingLeft={1} paddingRight={1}>
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
    </box>
  )
}

export const openCurator = (dialog: DialogContext) =>
  dialog.replace(<CuratorDialog />)
