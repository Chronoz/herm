# Chat Parity Tracker

Scope: the **chat surface only** — transcript rendering, tool trail,
composer, streaming feedback, interactive prompts. Admin tabs excluded.

## Reference rule

  **WHAT** a feature is (exists, data shape, event name, tool args)
    ← hermes-agent. Ink TUI (`ui-tui/src/`) is canonical; the
      prompt_toolkit CLI (`cli.py` + `agent/display.py`) is consulted
      only to catch features Ink regressed or hasn't migrated yet.

  **HOW** it renders and interacts (layout, keybinds, component shape)
    ← opencode (`~/Dev/clones/opencode/.../tui/`). Always.

  When the two can't be reconciled (hermes-specific concept with no
  opencode analogue — e.g. skins, /btw), the item is tagged `†` and
  the HOW is Herm's existing primitives (TabShell/KVBlock/dialog).

Every item below therefore has:
  what: <hermes-agent pointer — establishes the feature + data>
  how:  <opencode pointer — establishes the render>
  → <herm target path>

State key: `[ ]` backlog · `[>]` doing · `[x]` done · `[~]` partial ·
`[-]` won't do · `†` no-oc-analogue

───────────────────────────────────────────────────────────────────────
## A — Tool trail rendering
───────────────────────────────────────────────────────────────────────

Herm today: one `ToolPart.tsx` (98L) — generic collapsed row + 5-line
result preview + DiffBlock. No per-tool dispatch.

oc today: `routes/session/index.tsx` L1544-1590 — `<Switch>` over
`part.tool` dispatching to 14 per-tool components (bash, glob, read,
grep, list, webfetch, codesearch, websearch, write, edit, task,
apply_patch, todowrite, question, skill).

[x] A1  Per-tool dispatch + preview table
        what: hermes tool vocabulary (~35 names) — `agent/display.py`
              `build_tool_preview()` primary_args map is the *data
              source* for which arg is the one-liner per tool.
        how:  oc `routes/session/index.tsx` ToolPartRenderer `<Switch>`
              — one `<Match>` per tool → dedicated component;
              unmatched falls through to a generic renderer.
        → src/components/chat/tool/index.tsx (dispatch)
          src/components/chat/tool/preview.ts (name→primary-arg map)

[~] A2  terminal — shell block    ⚠ blocked on wire (UPSTREAM tool.*)
        what: tool.complete result for `terminal` carries
              {output, exit_code, error}.
        how:  oc `bash` match → mono block, exit-code footer row,
              truncation with "show N more" expand.
        → src/components/chat/tool/Terminal.tsx

[~] A3  read_file / write_file / patch
        what: inline_diff already on tool.complete payload (ink wires
              it; pt's `render_edit_diff_with_delta` proves the data
              path).
        how:  oc `read`/`write`/`edit`/`apply_patch` matches — path as
              a link-styled header row, body = diff (write/edit/patch)
              or line-range excerpt (read). oc's file-delta footer
              ("# Created/Deleted/Moved …") at L2137-2139.
        → src/components/chat/tool/File.tsx
        → done: write/patch with inline_diff → BlockTool+DiffBlock+
          delta footer. read_file body not on wire.

[~] A4  search_files / web_search    ⚠ blocked on wire
        what: result JSON has matches[] / results[].
        how:  oc `grep`/`glob`/`codesearch`/`websearch` matches —
              grouped-by-file list, path bold, per-hit line row.
        → src/components/chat/tool/Search.tsx

[~] A5  todo    ⚠ blocked on wire (args.todos[] not sent)
        what: args.todos[] with {id, content, status}.
        how:  oc `component/todo-item.tsx` (32L) — status glyph +
              content, strikethrough on completed.
        → src/components/chat/tool/Todo.tsx

[x] A6  delegate_task — subagent accordion
        what: gateway `subagent.{start,thinking,tool,progress,complete}`
              events; turnReducer already folds them into a flat
              `subagent[N]` pseudo-ToolPart.
        how:  oc `task` match + `routes/session/dialog-subagent.tsx` +
              `subagent-footer.tsx` — nested part list under the task
              row, own footer with model/tokens.
        → src/components/chat/tool/Subagent.tsx
          src/types/message.ts (+ SubagentPart holding Part[])

[x] A7  Running-tool spinner
        what: tool.start → status="running" until tool.complete.
        how:  oc `component/spinner.tsx` (24L) — single shared braille
              cycle, theme-colored.
        → src/ui/spinner.tsx (shared; also used by B4)

[x] A8  Trail details-mode toggle
        what: ink `detailsMode: hidden|collapsed|expanded`. (pt
              `/verbose` is the regression-catch that confirms the
              feature predates ink.)
        how:  oc `kv.json tool_details_visibility` bool + per-message
              expand state — a single kv-persisted tri-state, cycled
              by a keybind registered in `context/keybind.tsx`.
        → preferences key `toolDetails`; cycled via command palette
          "Tool Details" entry (oc default keybind is "none" so no
          dedicated key). ThoughtCloud subscribes via usePref(),
          passes `detail` to each <Tool>. Semantics: hidden = no
          completed-tool rows (running stays visible), collapsed =
          FileEdit blocks become inline+delta, expanded = full diff.

[x] A9  Word-level intra-line diff highlight
        what: n/a (neither pt nor ink does this — pure oc polish).
        how:  oc diff rendering in session/index + `kv.diff_wrap_mode`.
        → src/components/chat/DiffBlock.tsx upgrade

───────────────────────────────────────────────────────────────────────
## B — Streaming / thinking
───────────────────────────────────────────────────────────────────────

[x] B1  Reasoning preview collapse

[x] B2  Live reasoning stream (reasoning.delta → ThinkingPart append)

[ ] B3  Reasoning-token segment in assistant header
        what: usage.reasoning on message.complete.
        how:  oc assistant footer row (model · in/out/reasoning · dur).

[x] B4  Streaming status line  †
        what: gateway `thinking.delta` verb text + skin thinking_verbs
              list. Hermes-specific — oc has no skin system.
        how:  oc `component/spinner.tsx` for the glyph; verb text stays
              as-is from gateway; local rotation fallback uses Herm
              theme, not a ported KawaiiSpinner.

───────────────────────────────────────────────────────────────────────
## C — Interactive prompts
───────────────────────────────────────────────────────────────────────

All four prompt dialogs exist (src/ui/prompts.tsx, 236L), wired.

[x] C1  Approval dialog
        what: `approval.request` {command, description}; choices
              approve/deny/always/yolo.
        how:  oc `routes/session/permission.tsx` (691L) — command in
              a bordered `<code>` block, risk copy wrapped, choice
              list with per-choice description, remember-scope row.
        → src/ui/prompts.tsx ApprovalPrompt rebuild

[x] C2  Clarify
        how:  oc `routes/session/question.tsx` — already matched.

[x] C3  Secret / sudo masked input

[x] C4  Background / BTW completion  †
        what: `background.complete` `btw.complete` events.
        how:  no oc analogue. Use oc toast → click → oc dialog-alert
              pattern for full text; drop a system-line marker in the
              transcript so it survives the toast.

───────────────────────────────────────────────────────────────────────
## D — Composer
───────────────────────────────────────────────────────────────────────

[x] D1  @-ref autocomplete
        what: `complete.path` RPC + hermes @-keyword set (@diff
              @staged @git:N @url: @folder:).
        how:  oc `component/prompt/autocomplete.tsx` trigger-char
              providers — one provider per prefix, merged + scored.

[x] D2  Fuzzy scoring
        what: n/a (pure oc).
        how:  oc `component/prompt/frecency.tsx` — subsequence match
              score + recency weight. Port scorer only; keep Herm's
              SlashPopover render.

[-] D3  Multiline input
        Decision: keep single-line; Ctrl+G is the multi-line path.
        Add Shift+Enter → Ctrl+G alias. (oc uses `<textarea>` with
        `textarea-keybindings.ts`; not adopting — composer rebuild
        cost outweighs benefit while Ctrl+G exists.)

[x] D4  Image attachment chips
        what: `image.attach` RPC; pt-only today (ink regressed this —
              a real regression-catch).
        how:  oc file-part chip row above prompt (attach.ts pattern) —
              badge+name spans, clear on send.
        → src/components/chat/Composer.tsx (chip row)
          app.tsx attachments[] mirror. No detach — see UPSTREAM.md.

[ ] D5  Prompt stash
        what: n/a (pure oc).
        how:  oc `dialog-stash.tsx` + `prompt/stash.tsx`.
        
[x] D6  Bracketed paste → paste.collapse

[x] D7  Explicit clipboard-image key
        what: pt Alt+V / Ctrl+V → `_try_attach_clipboard_image`. Ink
              regressed this. Gateway `clipboard.paste` RPC exists.
        how:  oc keybind registration pattern; chip render = D4.
        → src/app/useAppKeys.ts (key.meta && "v")
[x] D8  Ctrl+G $EDITOR handoff

[x] D9  Prompt history ↑↓

[x] D10 Prompt history persistence
        what: pt writes `~/.hermes/prompt_history`; ink regressed.
        how:  oc `component/prompt/history.tsx` (108L) — load on
              mount, append on submit, dedupe-adjacent, cap.
        → ~/.config/herm/history (not ~/.hermes — client state)
[x] D11 Queue chips

[x] D12 /steer wiring  †
        what: `session.steer` RPC.
        how:  oc has no steer; † — Shift+Enter while streaming sends
              via RPC instead of local-queue, chip styled distinctly.

───────────────────────────────────────────────────────────────────────
## E — Transcript actions
───────────────────────────────────────────────────────────────────────

[x] E1  Click-to-rewind (destructive undo)  → superseded by E2
[x] E2  Message action menu
        what: session.undo / session.history / clipboard.
        how:  oc `routes/session/dialog-message.tsx` (110L) — opened
              on message click, actions list.
[x] E3  Fork
        what: `session.branch` RPC.
        how:  oc `dialog-fork-from-timeline.tsx` — pick point, new
              session, switch.

[ ] E4  Timeline
        what: `session.history` RPC (already used by /history).
        how:  oc `routes/session/dialog-timeline.tsx` (47L) — vertical
              scrubber, per-turn token bar, click → E2 menu.

[ ] E5  Sticky prompt tracker
        what: n/a (pure oc).
        how:  oc session/index pinned-header pattern when scrollTop>0.

[ ] E6  Export
        what: `session.save` RPC (JSON only).
        how:  oc `ui/dialog-export-options.tsx` — format picker.

───────────────────────────────────────────────────────────────────────
## F — Assistant message body
───────────────────────────────────────────────────────────────────────

[x] F1  Markdown + syntax highlight

[ ] F2  Code-block chrome
        what: n/a (pure oc).
        how:  oc code-block box — bg, lang label top-right, copy on
              click. Blocked on OpenTUI MarkdownRenderable renderNode
              hook; workaround = pre-split fenced blocks.

[x] F3  File-part rendering
        what: MEDIA: directive lines in assistant output (Ink
              MEDIA_LINE_RE) + attached images/files in user message
              (pairs with D4).
        how:  oc file-part chip — mime badge + filename span.
        → src/components/chat/MediaChip.tsx (splitMedia + classify);
          MessageItem pre-splits text parts on MEDIA lines, renders
          chips between markdown segments. Fence-aware so examples in
          code blocks stay literal. Inline pixel rendering blocked on
          OpenTUI (no image primitive) + chafa not installed —
          neither reference renders pixels either.

[ ] F4  Compaction marker  †
        what: `session.compress` side-effect. No structured event.
        how:  no oc analogue — divider line via Herm SystemMessage.

[x] F5  Error treatment
        what: message.complete status="error" / message.error.
        how:  oc `component/error-component.tsx` (92L) — bordered
              box, title, collapsible body, copy affordance.

───────────────────────────────────────────────────────────────────────
## Order
───────────────────────────────────────────────────────────────────────

Wave 1 — oc render grammar for hermes tools (biggest visual delta):
  A1 A2 A3 A5 A7 F5
Wave 2 — upgrade partials:
  A6 C1 A4 B4 C4
Wave 3 — composer:
  D2 D4 D7 D10 D12 D1
Wave 4 — oc transcript actions:
  E2 E3 E4 E5 A8 A9 F2
Backlog: B3 D5 E6 F4
Won't-do: D3

Tally: 27 done, 4 partial, 6 open, 1 declined.
⚠ blocked on wire (UPSTREAM.md `tool.start/.complete`): A2 A4 A5 (+A3 read body)
† (no oc analogue): B4 C4 D12 F4

Each item: one commit, `bunx tsc --noEmit|grep ^src/` clean,
`bun test` green, check the box here.
