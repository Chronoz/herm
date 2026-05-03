// Scene list for the showcase recording. Plain data — reorder/drop freely.
// Driven by drive.ts against the :7777 control server.

import { TABS } from "../../src/app/tabs"

export type Step =
  | { do: "tab"; n: number }
  | { do: "key"; name: string; ctrl?: boolean; shift?: boolean; safe?: boolean }
  | { do: "keys"; seq: Array<{ name: string; ctrl?: boolean; shift?: boolean }>; delay?: number }
  | { do: "type"; text: string; delay?: number }
  | { do: "input"; text: string }
  | { do: "send"; text: string }
  | { do: "hold"; ms: number }
  | { do: "wait"; for: "ready" | "idle" | { grep: string }; timeout?: number }
  | { do: "note"; text: string }
  | { do: "quit" }

const PROMPT_1 =
  "write me a haiku about a terminal UI, then list 3 bun one-liners that would impress a shell nerd"
const PROMPT_2 =
  "what tabs are available in this interface and what does each one do, in one line each?"

// ── small composites ────────────────────────────────────────────────
const hold = (ms: number): Step => ({ do: "hold", ms })
const key = (name: string, o: Partial<Extract<Step, { do: "key" }>> = {}): Step =>
  ({ do: "key", name, ...o })
const tab = (n: number): Step => ({ do: "tab", n })
const note = (text: string): Step => ({ do: "note", text })

/** Browse a list tab: jump, linger, a few j/k to show it's live. */
const tour = (n: number, jk = 3): Step[] => [
  note(`── tab ${n}: ${TABS[n]?.name ?? "?"}`),
  tab(n),
  hold(1200),
  { do: "keys", seq: Array.from({ length: jk }, () => ({ name: "j" })), delay: 180 },
  hold(500),
  { do: "keys", seq: Array.from({ length: Math.min(jk, 2) }, () => ({ name: "k" })), delay: 180 },
  hold(700),
]

/** Type over whatever has focus, submit, wait for the stream to finish. */
const prompt = (text: string): Step[] => [
  { do: "type", text, delay: 22 },
  hold(300),
  key("return", { safe: false }),
  { do: "wait", for: "idle", timeout: 120_000 },
  hold(1500),
]

// ── the tour ────────────────────────────────────────────────────────
export const SCENES: Step[] = [
  { do: "wait", for: "ready", timeout: 30_000 },
  note("splash"),
  hold(1800),

  // first prompt — typed over the splash, Enter dismisses + sends
  note("chat: prompt 1"),
  ...prompt(PROMPT_1),
  // scroll the reply a bit
  { do: "keys", seq: [{ name: "up" }, { name: "up" }, { name: "down" }, { name: "down" }], delay: 250 },
  hold(600),

  // tab sweep — every tab gets a linger + j/k tickle
  ...TABS.flatMap((_, i) => i === 0 ? [] : tour(i)),

  // Config → models category (row 1), open picker, bail
  note("config: model picker"),
  tab(8),
  hold(600),
  key("j"), hold(200), // down to "models"
  key("return", { safe: false }), hold(1200),
  key("escape"), hold(500),

  // global model picker from Chat
  note("chat: ctrl+m picker"),
  tab(0), hold(400),
  key("m", { ctrl: true }), hold(1400),
  key("j"), hold(200), key("j"), hold(200),
  key("escape"), hold(500),

  // second prompt
  note("chat: prompt 2"),
  ...prompt(PROMPT_2),

  hold(1000),
  { do: "quit" },
]
