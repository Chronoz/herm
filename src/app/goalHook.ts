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

export type GoalHook = {
  /** Called from onTurnComplete. Reads goal state, fires if done. */
  check: (sid: string) => void
}

const SECONDS = 10
const SUSPEND = process.platform === "darwin" ? "pmset sleepnow" : "systemctl suspend"

const run = (cmd: string) =>
  Bun.spawn(["sh", "-c", cmd], { stdout: "ignore", stderr: "ignore" })

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
  }
}
