// Action catalog — the curated set of named, rebindable key actions.
//
// Each ActionId maps to a default chord string (see chord.ts for grammar),
// a human description, and a scope. Scope drives Help grouping and tells
// the migration which handler owns the match:
//
//   global    shell-level (useAppKeys) — fires regardless of focused tab
//   list      shared nav vocabulary consumed by useListKeys across tabs/dialogs
//   dialog    modal overlays
//   composer  textarea keyBindings (fed via toBindings)
//   <tab>     tab-local, matched only when that tab is focused
//
// `<leader>` is a two-stroke prefix (default Ctrl+X, rebindable via the
// `leader` entry). Existing Ctrl-chords are kept as secondary alternates
// so nothing breaks while the leader pattern settles; print() shows the
// first alternate, so Help advertises the leader form.
//
// Trailing markers cross-reference opencode's config/keybinds.ts:
//   (blank)  oc has the same action on substantively the same chord
//   ø        oc has an analogue but herm binds it differently
//   ☨        no oc equivalent (herm-specific surface or concept)

export type Scope =
  | "global" | "list" | "dialog" | "composer"
  | "sessions" | "cron" | "env" | "agents" | "skills" | "config"

export type Def = { chord: string; desc: string; scope: Scope }

const def = (chord: string, desc: string, scope: Scope): Def => ({ chord, desc, scope })

export const DEFAULTS = {
  // ── global ──────────────────────────────────────────────────────
  "leader":            def("ctrl+x",               "Leader prefix",                      "global"),
  "app.exit":          def("ctrl+c",               "Quit (or copy selection)",           "global"),
  "app.suspend":       def("ctrl+z",               "Suspend to shell",                   "global"),
  "palette.open":      def("ctrl+k",               "Command palette",                    "global"), // ø command_list=ctrl+p
  "help.open":         def("f1",                   "Keyboard shortcuts",                 "global"), // ☨
  "tab.next":          def("ctrl+right",           "Next tab",                           "global"), // ☨
  "tab.prev":          def("ctrl+left",            "Previous tab",                       "global"), // ☨
  "focus.cycle":       def("tab",                  "Cycle focus (double-tap → composer)","global"), // ☨
  "editor.open":       def("<leader>e,ctrl+g",     "Open $EDITOR on prompt",             "global"),
  "reply.copy":        def("<leader>y,ctrl+y",     "Copy last assistant reply",          "global"),
  "clipboard.attach":  def("alt+v",                "Attach clipboard image",             "global"), // ø input_paste=ctrl+v
  "queue.pop":         def("ctrl+u",               "Pop last queued prompt",             "global"), // ☨
  "session.interrupt": def("escape",               "Interrupt (double-tap while streaming)", "global"),
  "session.new":       def("<leader>n",            "New session",                        "global"),
  "session.undo":      def("<leader>u",            "Undo last turn",                     "global"),
  "session.compress":  def("<leader>c",            "Compress context",                   "global"),
  "session.timeline":  def("<leader>g",            "Session timeline",                   "global"),
  "theme.pick":        def("<leader>t",            "Switch theme",                       "global"),
  "model.pick":        def("<leader>m",            "Switch model",                       "global"),
  "tool.details":      def("<leader>d",            "Cycle tool-trail detail",            "global"), // ø tool_details=none
  "status.open":       def("<leader>s",            "Show status",                        "global"),

  // ── list (shared across tabs + list-shaped dialogs) ─────────────
  // ☨ — oc has no generic list surface; nearest are per-dialog
  //     session_*/stash_* bindings and messages_* scroll.
  "list.up":           def("up",                   "Move selection up",                  "list"),
  "list.down":         def("down",                 "Move selection down",                "list"),
  "list.pageUp":       def("pageup",               "Page up",                            "list"),
  "list.pageDown":     def("pagedown",             "Page down",                          "list"),
  "list.home":         def("home",                 "First item",                         "list"),
  "list.end":          def("end",                  "Last item",                          "list"),
  "list.activate":     def("return",               "Activate / open",                    "list"),
  "list.delete":       def("d,delete",             "Delete item",                        "list"),
  "list.refresh":      def("r",                    "Reload",                             "list"),
  "list.new":          def("n",                    "Create",                             "list"),
  "list.search":       def("/",                    "Filter",                             "list"),
  "list.toggle":       def("space",                "Toggle item",                        "list"),

  // ── dialog ──────────────────────────────────────────────────────
  // ☨ — oc dialogs hardcode return/escape/y/n per-component.
  "dialog.accept":     def("return",               "Accept",                             "dialog"),
  "dialog.cancel":     def("escape",               "Cancel / close",                     "dialog"),
  "dialog.confirm":    def("y",                    "Yes",                                "dialog"),
  "dialog.deny":       def("n",                    "No",                                 "dialog"),
  "dialog.copy":       def("c",                    "Copy body",                          "dialog"),

  // ── composer (fed to <textarea keyBindings> via toBindings) ─────
  "input.submit":      def("return",               "Send",                               "composer"),
  "input.newline":     def("shift+return,ctrl+return,alt+return,ctrl+j", "Insert newline", "composer"),

  // ── tab-specific ────────────────────────────────────────────────
  // ☨ — herm admin tabs (Cron/Env/Skills/Agents/Config) have no oc
  //     counterpart; sessions.rename diverges from oc's session-
  //     dialog ctrl+r.
  "sessions.rename":   def("t",                    "Retitle session",                    "sessions"), // ø session_rename=ctrl+r
  "cron.run":          def("x",                    "Run job now",                        "cron"),
  "env.reveal":        def("v",                    "Reveal value",                       "env"),
  "agents.pause":      def("p",                    "Pause / resume delegation",          "agents"),
  "agents.kill":       def("k",                    "Kill subagent",                      "agents"),
  "agents.history":    def("h",                    "Spawn history",                      "agents"),
  "skills.inspect":    def("i",                    "Inspect skill",                      "skills"),
  "config.save":       def("ctrl+s",               "Write config",                       "config"),
} satisfies Record<string, Def>

export type ActionId = keyof typeof DEFAULTS

/** Actions in a given scope, catalog order. */
export function inScope(s: Scope): ActionId[] {
  return (Object.keys(DEFAULTS) as ActionId[]).filter(id => DEFAULTS[id].scope === s)
}
