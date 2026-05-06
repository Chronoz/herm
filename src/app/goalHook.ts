// Goal-completion hook. Polls state_meta['goal:<sid>'] after each turn
// and, on transition to status=done, performs the onGoalDone pref
// action. The judge that *writes* that status lives in stock
// tui_gateway/server.py (the post-turn Ralph loop); this module is the
// reactor, not the driver.
//
// Setting/controlling the goal goes through the slash-worker
// (slash.exec → HermesCLI._handle_goal_command → GoalManager), NOT via
// shell.exec + `python3 -c` — that pattern is on tools/approval.py's
// DANGEROUS_PATTERNS list and tui_gateway's shell.exec handler hard-
// rejects it with a 4005 before it ever runs.

import type { DialogContext } from "../ui/dialog"
import type { Gateway } from "./gateway"
import * as prefs from "../utils/preferences"
import { openCountdown } from "../dialogs/countdown"
import { io } from "../io"

type Toast = { show: (o: { variant: "success"; title?: string; message: string; duration?: number }) => void }
type ShellResult = { stdout: string; stderr: string; code: number }
type SlashResult = { output?: string; warning?: string }

export type GoalHook = {
  /** Called from onTurnComplete. Reads goal state, fires if done. */
  check: (sid: string) => void
  /** Route /goal through the slash-worker. Returns cleaned output for
   *  the transcript plus whether this was a fresh set (caller kicks
   *  off the loop by sending the goal text as a prompt — parity with
   *  the CLI's _pending_input.put(goal)). */
  cmd: (arg: string) => Promise<{ line: string; kick: string | null }>
}

const SECONDS = 10
const SUSPEND = process.platform === "darwin" ? "pmset sleepnow" : "systemctl suspend"
const VERBS = new Set(["status", "pause", "resume", "clear", "stop", "done"])

// _handle_goal_command prints via _cprint with _DIM/_RST interpolated
// into the string before the worker's lambda swap, so the ANSI bytes
// are in the captured buffer. Strip them for the transcript.
const ANSI = /\x1b\[[0-9;]*m/g

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
    cmd: async (arg: string) => {
      const trimmed = arg.trim()
      const first = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? ""
      // Non-verb (and non-empty) first token ⇒ this is a fresh goal
      // set; the caller should kick the loop off by submitting the
      // goal text as the first prompt. Verbs + bare `/goal` just
      // report/mutate state.
      const kick = trimmed && !VERBS.has(first) ? trimmed : null
      const r = await gw.request<SlashResult>("slash.exec",
        { command: `/goal${trimmed ? " " + trimmed : ""}` })
      const line = (r.output ?? "").replace(ANSI, "").trim() || "ok"
      return { line, kick }
    },
  }
}

// Exposed for tests — keep type surface minimal.
export type { ShellResult }
