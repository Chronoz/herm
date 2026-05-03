// Goal-completion hook. Polls state_meta['goal:<sid>'] after each turn
// and, on transition to status=done, performs the onGoalDone pref
// action. The judge that *writes* that status lives elsewhere:
//   - hermes_cli cli.py / gateway/run.py today
//   - herm's own drive loop once option-B lands (herm-2ku)
// This module is the reactor, not the driver.

import type { DialogContext } from "../ui/dialog"
import type { Gateway } from "./gateway"
import * as prefs from "../utils/preferences"
import { openCountdown } from "../dialogs/countdown"
import { io } from "../io"

type Toast = { show: (o: { variant: "success"; title?: string; message: string; duration?: number }) => void }
type ShellResult = { stdout: string; stderr: string; code: number }

export type GoalHook = {
  /** Called from onTurnComplete. Reads goal state, fires if done. */
  check: (sid: string) => void
  /** Drive GoalManager via shell.exec — verbs map to goals.py methods.
   *  Returns a one-line status string for the transcript. */
  cmd: (sid: string, verb: string, arg: string) => Promise<string>
}

const SECONDS = 10
const SUSPEND = process.platform === "darwin" ? "pmset sleepnow" : "systemctl suspend"

const run = (cmd: string) =>
  Bun.spawn(["sh", "-c", cmd], { stdout: "ignore", stderr: "ignore" })

// shell.exec inherits the gateway subprocess env (HERMES_HOME +
// PYTHONPATH=<agent-root>), so hermes_cli.goals resolves and writes to
// the same state.db the io reader polls. JSON.stringify handles the
// inner python string literal (", \, \n); shQuote handles the outer
// sh -c arg so goal text can't inject.
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const PY: Record<string, (a: string) => string> = {
  set:    a => `m.set(${JSON.stringify(a)}); print(m.status_line())`,
  done:   a => `m.mark_done(${JSON.stringify(a || "marked via herm")}); print("✓ marked done")`,
  pause:  () => `m.pause(); print(m.status_line())`,
  resume: () => `m.resume(); print(m.status_line())`,
  clear:  () => `m.clear(); print("cleared")`,
  status: () => `print(m.status_line())`,
}

// Latch per sid+goal so repeated done-polls don't re-fire. Module
// scope — switching sessions naturally keys out of it, and profile
// switch calls rehome() which starts a fresh sid anyway.
const fired = new Map<string, string>()

export function makeGoalHook(gw: Gateway, dialog: DialogContext, toast: Toast): GoalHook {
  const act = (goal: string) => {
    const pref = (prefs.get("onGoalDone") ?? "toast").trim()
    const head = goal.length > 60 ? goal.slice(0, 57) + "…" : goal
    toast.show({
      variant: "success", title: "Goal complete", message: head, duration: 8000,
    })
    if (pref === "toast") return
    const cmd = pref === "suspend" ? SUSPEND : pref
    void openCountdown(dialog, {
      title: "Goal complete — " + (pref === "suspend" ? "suspending" : "running hook"),
      body: head,
      action: `→ ${cmd}`,
      seconds: SECONDS,
    }).then(ok => { if (ok) run(cmd) })
  }

  return {
    check: (sid: string) => {
      if (!sid) return
      void io.goalState(sid).then(s => {
        if (!s || s.status !== "done") return
        if (fired.get(sid) === s.goal) return
        fired.set(sid, s.goal)
        act(s.goal)
      }).catch(() => {})
    },
    cmd: async (sid: string, verb: string, arg: string) => {
      const body = PY[verb] ?? (arg || verb ? PY.set : PY.status)
      // Non-verb first token = start of goal text.
      const text = PY[verb] ? arg : [verb, arg].filter(Boolean).join(" ")
      const py = `from hermes_cli.goals import GoalManager; m=GoalManager(${JSON.stringify(sid)}); ${body(text)}`
      const r = await gw.request<ShellResult>("shell.exec", {
        command: `python3 -c ${shQuote(py)}`,
      })
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim())
      return r.stdout.trim() || "ok"
    },
  }
}
