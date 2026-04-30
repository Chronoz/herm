import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Profiler, useState, useEffect, useRef, useCallback, useReducer } from "react"
import * as perf from "./utils/perf"
import * as spawnHistory from "./app/spawnHistory"
import { setBridge, enabled as controlEnabled } from "./utils/control"
import { hasInterp, interpolate } from "./utils/interpolate"
import { GatewayProvider, useGateway, useGatewayEvent, type Gateway } from "./app/gateway"
import type { GatewayEvent, SessionInfo, SessionUsageResponse, TranscriptMessage, ImageAttachResponse } from "./utils/gateway-types"
import type { Message } from "./types/message"
import { CLOUD_MIN } from "./components/chat/ThoughtCloud"
import type { AvatarState } from "./components/avatar/states"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar } from "./components/sidebar/Sidebar"
import { Chat } from "./tabs/Chat"
import { Context } from "./tabs/Context"
import { Sessions } from "./tabs/Sessions"
import { Agents } from "./tabs/Agents"
import { Analytics } from "./tabs/Analytics"
import { Memory } from "./tabs/Memory"
import { Skills } from "./tabs/Skills"
import { Config } from "./tabs/Config"
import { Cron } from "./tabs/Cron"
import { Toolsets } from "./tabs/Toolsets"
import { Env } from "./tabs/Env"
import type { Usage } from "./types/message"
import { copySelection } from "./utils/clipboard"
import { ThemeProvider, useTheme } from "./theme"
import { DialogProvider, useDialog } from "./ui/dialog"
import { ToastProvider, useToast } from "./ui/toast"
import { CommandProvider, useCommand } from "./ui/command"
import { KeysProvider } from "./keys"
import { HelpDialog } from "./dialogs/help"
import { openKeys } from "./dialogs/keys"
import { openLogs } from "./dialogs/logs"
import { openThemePicker } from "./dialogs/theme-picker"
import { openModelPicker } from "./dialogs/model-picker"
import { openEikonPicker } from "./dialogs/eikon-picker"
import { openTextPrompt } from "./dialogs/text-prompt"
import { openRollback } from "./dialogs/rollback"
import { openHistory } from "./dialogs/history"
import { openStatus, openUsage, openProfile } from "./dialogs/info"
import { openAlert } from "./dialogs/alert"
import { openMessage } from "./dialogs/message"
import { parseEikon, type ParsedEikon } from "./components/avatar/eikon"
import { ApprovalPrompt, ClarifyPrompt, SudoPrompt, SecretPrompt } from "./ui/prompts"
import { resolve as resolveSlash, type SlashCommand } from "./commands/slash"
import { useSlashCommands } from "./app/useSlashCommands"
import { Composer, type ComposerHandle } from "./components/chat/Composer"
import * as preferences from "./utils/preferences"
import { turnReducer, initialTurn, transcriptToMessages } from "./app/turnReducer"
import { mapEvent } from "./app/gatewayEvents"
import { useSession } from "./app/useSession"
import { SkinProvider, deriveSkin, type SkinState } from "./app/skin"
import { useAppKeys } from "./app/useAppKeys"
import { TABS, TAB_MAX, CHAT_TAB, TAB_SLASH } from "./app/tabs"
import { activeProfileName } from "./utils/hermes-profiles"

export const App = (props: { initialTheme?: string; gateway?: Gateway }) => (
  <ThemeProvider initial={props.initialTheme}>
    <GatewayProvider client={props.gateway}>
      <ToastProvider>
        <KeysProvider>
          <DialogProvider>
            <CommandProvider>
              <AppInner />
            </CommandProvider>
          </DialogProvider>
        </KeysProvider>
      </ToastProvider>
    </GatewayProvider>
  </ThemeProvider>
)

const AppInner = () => {
  const gw = useGateway()
  const dialog = useDialog()
  const themeCtx = useTheme()
  const cmd = useCommand()
  const toast = useToast()
  const renderer = useRenderer()
  const session = useSession()
  const dims = useTerminalDimensions()

  const [turn, dispatch] = useReducer(turnReducer, initialTurn)
  const [ready, setReady] = useState(false)
  const [sid, setSid] = useState("")
  const [tab, setTab] = useState(CHAT_TAB)
  const [hideSidebar, setHideSidebar] = useState(false)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [cost, setCost] = useState(0)
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined)
  const [msgCount, setMsgCount] = useState(0)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [title, setTitle] = useState("")
  const [focusRegion, setFocusRegion] = useState<"input" | "content">("input")
  const goToTab = useCallback((t: number) => {
    setTab(t)
    setFocusRegion(t === CHAT_TAB ? "input" : "content")
  }, [])
  const [status, setStatus] = useState("")
  const [eikon, setEikon] = useState<ParsedEikon | undefined>(undefined)
  const [queue, setQueue] = useState<string[]>([])
  const [attachments, setAttachments] = useState<ImageAttachResponse[]>([])
  const [cloud, setCloud] = useState(false)
  const [cloudH, setCloudH] = useState(CLOUD_MIN)
  const [pick, setPick] = useState<Message | undefined>(undefined)
  const [skin, setSkin] = useState<SkinState>(() => deriveSkin(undefined))
  const inflight = useRef(false)
  // Client-side interrupt latch: flipped on Esc×2 before the gateway has
  // confirmed the stop. Stream-mutation events still in the stdio pipe
  // (already written by the agent thread before it saw the interrupt
  // flag) are dropped until the terminal `message.complete` arrives.
  const interrupted = useRef(false)
  const sessionStart = useRef(Date.now())
  const composer = useRef<ComposerHandle>(null)
  const { cmds } = useSlashCommands()
  // Live ref so send() (stable for queue-drain) reads the current catalog
  // without re-creating itself on every catalog refresh.
  const cmdsRef = useRef(cmds); cmdsRef.current = cmds

  const agentState: AvatarState = !ready
    ? "error"
    : turn.toolActive ? "working"
    : turn.streaming && turn.hasContent ? "speaking"
    : turn.streaming ? "thinking"
    : "idle"

  // Thought cloud: single `cloud` bit, driven by events. Streaming
  // opens it and clears any pin; streaming end closes it; avatar click
  // and message-pin override freely from either side.
  useEffect(() => {
    if (turn.streaming) setPick(undefined)
    setCloud(turn.streaming)
  }, [turn.streaming])
  const onPick = useCallback((m?: Message) => { setPick(m); setCloud(!!m) }, [])
  // Avatar click toggles the cloud. Closing it also clears any pinned
  // message so the next open shows live state, not stale pin.
  const onAvatar = useCallback(() => setCloud(o => {
    if (o) setPick(undefined)
    return !o
  }), [])
  const onEnqueue = useCallback((t: string) => setQueue(q => [...q, t]), [])

  // ── Session reset / lifecycle ─────────────────────────────────────
  const reset = useCallback(() => {
    dispatch({ kind: "reset" })
    setMsgCount(0)
    setCost(0)
    setCtxPct(undefined)
    setUsage(undefined)
    setReady(false)
    setStatus("")
    setTitle("")
    setAttachments([])
  }, [])

  const newSession = useCallback(async () => {
    reset()
    try { setSid(await session.create()); sessionStart.current = Date.now() }
    catch {}
  }, [reset, session])

  const switchSession = useCallback(async (target: string) => {
    reset()
    try {
      const res = await session.resume(target)
      setSid(res.id)
      sessionStart.current = Date.now()
      if (res.messages.length) { dispatch({ kind: "load", messages: res.messages }); setMsgCount(res.messages.length) }
    } catch (err) {
      dispatch({ kind: "system", text: `Failed to resume: ${err instanceof Error ? err.message : String(err)}` })
    }
  }, [reset, session])

  const pollUsage = useCallback(() => {
    gw.request<SessionUsageResponse>("session.usage")
      .then(r => {
        if (r.cost_usd != null) setCost(r.cost_usd)
        setCtxPct(r.context_percent ?? undefined)
      })
      .catch(() => {})
  }, [gw])

  // ── Eikon avatar ──────────────────────────────────────────────────
  const loadEikon = useCallback((path: string) => {
    Bun.file(path).text()
      .then(t => setEikon(parseEikon(t)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const path = preferences.get("eikonPath")
    if (path) loadEikon(path)
  }, [loadEikon])

  const pickEikon = useCallback(() => {
    openEikonPicker(dialog, (path) => {
      preferences.set("eikonPath", path)
      loadEikon(path)
    })
  }, [dialog, loadEikon])

  // ── Title ─────────────────────────────────────────────────────────
  const applyTitle = useCallback((t: string) => {
    gw.request<{ title: string }>("session.title", { title: t })
      .then(r => { setTitle(r.title); dispatch({ kind: "system", text: `Title: ${r.title}` }) })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, toast])

  const editTitle = useCallback(() => {
    openTextPrompt(dialog, { title: "Session Title", initial: title })
      .then(v => { if (v) applyTitle(v) })
  }, [dialog, title, applyTitle])

  // ── Message actions ───────────────────────────────────────────────
  // turnsFrom counts user turns at-or-after m — each session.undo pops
  // one user+assistant pair server-side.
  const turnsFrom = (m: Message) => {
    const at = turn.messages.findIndex(x => x.id === m.id)
    return at < 0 ? 0 : turn.messages.slice(at).filter(x => x.role === "user").length
  }

  const rewind = useCallback(async (m: Message) => {
    if (turn.streaming) return
    const n = turnsFrom(m)
    if (n === 0) return
    const text = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
    for (let i = 0; i < n; i++) await gw.request("session.undo").catch(() => {})
    const r = await gw.request<{ messages: TranscriptMessage[] }>("session.history").catch(() => null)
    const at = turn.messages.findIndex(x => x.id === m.id)
    dispatch({ kind: "load", messages: r ? transcriptToMessages(r.messages ?? []) : turn.messages.slice(0, at) })
    setMsgCount(c => Math.max(0, c - n))
    composer.current?.set(text)
    setFocusRegion("input")
  }, [turn.streaming, turn.messages, gw])

  // Non-destructive: session.branch clones full history into a new
  // gateway session; undo N turns *in that session* to land at m;
  // then switch. Original session is untouched.
  const fork = useCallback(async (m: Message) => {
    if (turn.streaming) return
    const n = turnsFrom(m)
    const text = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
    const res = await gw.request<{ session_id: string; title?: string }>("session.branch", {})
      .catch((e: Error) => { toast.show({ variant: "error", message: `branch failed: ${e.message}` }); return null })
    if (!res?.session_id) return
    for (let i = 0; i < n; i++)
      await gw.request("session.undo", { session_id: res.session_id }).catch(() => {})
    await switchSession(res.session_id)
    composer.current?.set(text)
    setFocusRegion("input")
    toast.show({ variant: "success", message: `forked → ${res.title ?? res.session_id}` })
  }, [turn.streaming, turn.messages, gw, toast, switchSession])

  const msgMenu = useCallback((m: Message) => {
    if (turn.streaming) return
    openMessage(dialog, m, { rewind, fork })
  }, [turn.streaming, dialog, rewind, fork])

  // ── Attachments ───────────────────────────────────────────────────
  // Gateway owns the canonical list (session["attached_images"]); chips
  // are a client-side mirror. prompt.submit drains server-side, so clear
  // here too. No image.detach RPC yet — chips are display-only.
  const attachClipboard = useCallback(() => {
    gw.request<ImageAttachResponse>("clipboard.paste")
      .then(r => r.attached
        ? setAttachments(a => [...a, r])
        : toast.show({ variant: "info", message: r.message ?? "No image in clipboard" }))
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, toast])

  // ── Slash dispatch ────────────────────────────────────────────────
  const slash = useCallback((c: SlashCommand, arg = "") => {
    if (c.target === "local") {
      switch (c.name) {
        case "clear": dispatch({ kind: "reset" }); setMsgCount(0); return
        case "new": newSession(); return
        case "theme": openThemePicker(dialog, themeCtx); return
        case "help": dialog.replace(<HelpDialog />); return
        case "keys": openKeys(dialog); return
        case "logs": openLogs(dialog); return
        case "eikon": pickEikon(); return
        case "title": arg ? applyTitle(arg) : editTitle(); return
        case "rollback": openRollback(dialog, gw, toast); return
        case "history": openHistory(dialog, gw); return
        case "status": openStatus(dialog, info, sid); return
        case "usage": openUsage(dialog, gw); return
        case "profile": openProfile(dialog); return
        case "steer":
          openTextPrompt(dialog, { title: "Steer", label: "Note to inject on next tool result" })
            .then(text => {
              if (!text) return
              gw.request<{ accepted: boolean }>("session.steer", { text })
                .then(r => toast.show(r.accepted
                  ? { variant: "success", message: "Queued — lands on next tool result" }
                  : { variant: "info", message: "No turn running; send as a normal message" }))
                .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
            })
          return
        case "reload-mcp": {
          // Gateway gates this behind `approvals.mcp_reload_confirm` (default on)
          // to warn about prompt-cache invalidation. When the arg is `now`/`once`/
          // `approve`/`yes` we skip the gate; `always` additionally persists the
          // approvals key to false so future calls never prompt again.
          const a = arg.trim().toLowerCase()
          const params: { confirm?: true; always?: true } = {}
          if (a === "now" || a === "once" || a === "approve" || a === "yes") params.confirm = true
          else if (a === "always") { params.confirm = true; params.always = true }
          toast.show({ variant: "info", message: "Reloading MCP servers…" })
          gw.request<{ status?: string; message?: string }>("reload.mcp", params)
            .then(r => {
              if (r.status === "confirm_required") {
                toast.show({ variant: "warning",
                  message: r.message || "/reload-mcp invalidates prompt cache. Re-run as `/reload-mcp now` or `/reload-mcp always`." })
                return
              }
              toast.show({ variant: "success", message: params.always
                ? "MCP servers reloaded · future /reload-mcp runs silently"
                : "MCP servers reloaded" })
            })
            .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
          return
        }
        case "save":
          gw.request<{ file: string }>("session.save")
            .then(r => toast.show({ variant: "success", message: `Saved → ${r.file}` }))
            .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
          return
      }
    }
    if (c.target !== "gateway" || !ready || turn.streaming) return
    const jump = TAB_SLASH[c.name]
    if (jump !== undefined && !arg) { goToTab(jump); return }
    const full = `/${c.name}${arg ? " " + arg : ""}`
    dispatch({ kind: "user", text: full })
    gw.request<{ output?: string }>("slash.exec", { command: full })
      .then(res => { if (res?.output) dispatch({ kind: "system", text: res.output }) })
      .catch(() => { gw.request("prompt.submit", { text: full }).catch(() => {}) })
  }, [ready, turn.streaming, dialog, themeCtx, newSession, gw, pickEikon, editTitle, applyTitle, toast, info, sid])

  // ── Send ──────────────────────────────────────────────────────────
  const send = useCallback(async (raw: string) => {
    // Slash-shaped input resolves against the merged catalog: exact
    // name/alias wins, else unique prefix. This covers the "typed with
    // arg" path the popover can't — e.g. `/mod gpt-4`, `/q follow-up`.
    // Unknown `/xxx` falls through to prompt.submit verbatim (lets the
    // agent interpret paths like `/etc/hosts`).
    const m = raw.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
    if (m) {
      const [, name, arg = ""] = m
      if (name === "queue" || name === "q") return setQueue(q => [...q, arg.trim()])
      const r = resolveSlash(cmdsRef.current, name)
      if ("hit" in r) return slash(r.hit, arg.trim())
      if ("ambiguous" in r) {
        const head = r.ambiguous.slice(0, 6).join(", ")
        return dispatch({
          kind: "system",
          text: `ambiguous: /${name} → ${head}${r.ambiguous.length > 6 ? ", …" : ""}`,
        })
      }
    }
    // {!cmd} spans resolve via shell.exec before submit so the
    // transcript shows what was actually sent. The await is short
    // (gateway-side 30s cap); status line signals the wait.
    let text = raw
    if (hasInterp(raw)) {
      setStatus("interpolating…")
      text = await interpolate(gw, raw)
      setStatus("")
    }
    interrupted.current = false
    dispatch({ kind: "user", text })
    setAttachments([])
    gw.request("prompt.submit", { text }).catch(() => { inflight.current = false })
    setTab(CHAT_TAB)
  }, [gw, slash, applyTitle])

  // ── Queue drain ───────────────────────────────────────────────────
  // Purely client-side: prompts typed while streaming accumulate in
  // `queue`; on idle the head auto-submits. turnReducer doesn't flip
  // `streaming` until the gateway emits message.start (async), so a
  // naive effect would fire repeatedly and drain the whole queue in
  // one tick. `inflight` bridges the dispatch→message.start gap.
  useEffect(() => { if (turn.streaming) inflight.current = false }, [turn.streaming])
  useEffect(() => {
    if (turn.streaming || inflight.current || !ready || queue.length === 0) return
    const [head, ...rest] = queue
    inflight.current = true
    setQueue(rest)
    send(head)
  }, [turn.streaming, ready, queue, send])

  const dequeue = useCallback((i: number) => {
    const item = queue[i]
    if (item === undefined) return
    setQueue(q => q.filter((_, j) => j !== i))
    composer.current?.set(item)
    setFocusRegion("input")
  }, [queue])

  // ── Copy last assistant ───────────────────────────────────────────
  const copyLast = useCallback(() => {
    for (let i = turn.messages.length - 1; i >= 0; i--) {
      const m = turn.messages[i]
      if (m.role !== "assistant") continue
      const text = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
      if (!text) continue
      process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`)
      return true
    }
    return false
  }, [turn.messages])

  // ── Gateway events ────────────────────────────────────────────────
  // Delta batching: streamed text/reasoning chunks are accumulated in
  // a ref and flushed at most once per 16ms. Every delta otherwise
  // triggers an O(messages) array spread + O(content) string concat +
  // full markdown re-parse of the streaming block. Any non-delta
  // action flushes synchronously first so part ordering is preserved.
  const deltas = useRef({ text: "", think: "", timer: null as ReturnType<typeof setTimeout> | null })

  const flush = useCallback(() => {
    const d = deltas.current
    if (d.timer) { clearTimeout(d.timer); d.timer = null }
    if (d.think) { dispatch({ kind: "thinking", text: d.think, final: false }); d.think = "" }
    if (d.text) { dispatch({ kind: "message.delta", chunk: d.text }); d.text = "" }
  }, [])

  // Events that mutate the in-progress assistant turn. Everything else
  // (system messages, session.info, toasts, completion, side channels)
  // is orthogonal to the stream and must pass the interrupt gate.
  const STREAM_EVENTS = useRef(new Set<GatewayEvent["type"]>([
    "message.delta", "reasoning.delta", "reasoning.available", "thinking.delta",
    "tool.start", "tool.progress", "tool.generating",
  ])).current

  const handle = useCallback((ev: GatewayEvent) => {
    if (interrupted.current && STREAM_EVENTS.has(ev.type)) return
    const action = mapEvent(ev, {
      onReady: () => {
        session.boot().then((r) => {
          setSid(r.id)
          sessionStart.current = Date.now()
          if (r.messages.length) dispatch({ kind: "load", messages: r.messages })
          setMsgCount(r.messages.length)
        })
      },
      onSessionInfo: (si) => {
        setInfo(si)
        setReady(true)
        if (si.session_id) setSid(si.session_id)
        const bad = (si.mcp_servers ?? []).filter(s => !s.connected)
        if (bad.length) dispatch({
          kind: "system",
          text: `MCP: ${bad.length} server(s) failed to connect — ${bad.map(s => s.name + (s.error ? ` (${s.error})` : "")).join(", ")}`,
        })
        gw.request<{ title: string; session_key?: string }>("session.title").then(r => {
          setTitle(r.title ?? "")
          if (r.session_key) preferences.set("lastSessionId", r.session_key)
        }).catch(() => {})
      },
      onUsage: (u) => setUsage(u),
      onTurnComplete: () => {
        interrupted.current = false
        setMsgCount(c => c + 1); setStatus(""); pollUsage()
        spawnHistory.flush(gw, sid)
      },
      onClarify: (req) => dialog.replace(<ClarifyPrompt req={req} />),
      onApproval: (req) => dialog.replace(<ApprovalPrompt req={req} />),
      onSudo: (req) => dialog.replace(<SudoPrompt req={req} />),
      onSecret: (req) => dialog.replace(<SecretPrompt req={req} />),
      onBackground: (tid, text) => {
        const head = text.split("\n")[0].slice(0, 80)
        dispatch({ kind: "system", text: `◷ background task ${tid} complete — ${head}` })
        toast.show({
          variant: "info", title: "Background task complete", message: head,
          duration: 8000,
          action: { label: "view", run: () => openAlert(dialog, `Background task ${tid}`, text) },
        })
      },
      onBtw: (text) => {
        const head = text.split("\n")[0].slice(0, 80)
        dispatch({ kind: "system", text: `◈ btw — ${head}` })
        toast.show({
          variant: "info", title: "btw", message: head, duration: 8000,
          action: { label: "view", run: () => openAlert(dialog, "btw", text) },
        })
      },
      onStatus: (text) => setStatus(text),
      onSkin: (s) => setSkin(deriveSkin(s)),
    })
    if (!action) return
    const d = deltas.current
    if (action.kind === "message.delta") {
      if (d.think) flush()
      d.text += action.chunk
      d.timer ??= setTimeout(flush, 16)
      return
    }
    if (action.kind === "thinking" && !action.final) {
      if (d.text) flush()
      d.think += action.text
      d.timer ??= setTimeout(flush, 16)
      return
    }
    flush()
    dispatch(action)
  }, [session, dialog, toast, pollUsage, gw, flush])

  useGatewayEvent(handle)

  // ── Command palette ───────────────────────────────────────────────
  useEffect(() => cmd.register([
    { title: "Help", value: "help", action: "help.open", category: "General",
      onSelect: () => dialog.replace(<HelpDialog />) },
    { title: "Keybindings", value: "keys", description: "View & rebind shortcuts", category: "General",
      onSelect: () => openKeys(dialog) },
    { title: "Gateway Logs", value: "logs", description: "Show gateway stderr", category: "General",
      onSelect: () => openLogs(dialog) },
    { title: "Switch Theme", value: "theme", action: "theme.pick", category: "General",
      onSelect: () => openThemePicker(dialog, themeCtx) },
    { title: "Switch Model", value: "model", action: "model.pick", category: "General",
      onSelect: () => openModelPicker(dialog, gw) },
    { title: "Pick Avatar", value: "eikon", description: "Choose sidebar .eikon avatar", category: "General",
      onSelect: () => pickEikon() },
    { title: "Rollback", value: "rollback", description: "Browse & restore checkpoints", category: "Session",
      onSelect: () => openRollback(dialog, gw, toast) },
    { title: "History", value: "history", action: "session.timeline", category: "Session",
      onSelect: () => openHistory(dialog, gw) },
    { title: "Status", value: "status", action: "status.open", category: "Info",
      onSelect: () => openStatus(dialog, info, sid) },
    { title: "Usage", value: "usage", description: "Tokens · context · cost", category: "Info",
      onSelect: () => openUsage(dialog, gw) },
    { title: "Profile", value: "profile", description: "Active profile details", category: "Info",
      onSelect: () => openProfile(dialog) },
    { title: "New Session", value: "new-session", action: "session.new", category: "Session",
      onSelect: () => newSession() },
    { title: "Compress Session", value: "compress", action: "session.compress", category: "Session",
      onSelect: () => session.compress() },
    { title: "Undo Last Turn", value: "undo", action: "session.undo", category: "Session",
      onSelect: () => session.undo() },
    { title: "Branch Session", value: "branch", description: "Fork the current conversation", category: "Session",
      onSelect: () => session.branch() },
  ]), [cmd, dialog, themeCtx, session, gw, toast, newSession, pickEikon, info, sid])

  // ── Keyboard ──────────────────────────────────────────────────────
  useAppKeys({
    tab, tabMax: TAB_MAX, chatTab: CHAT_TAB, setTab, focusRegion, setFocusRegion,
    streaming: turn.streaming,
    dialogOpen: dialog.stack.length > 0,
    composer,
    onInterrupt: () => {
      interrupted.current = true
      // Drop any 16ms-batched deltas that haven't hit the reducer yet —
      // flushing them would append post-interrupt text.
      const d = deltas.current
      if (d.timer) { clearTimeout(d.timer); d.timer = null }
      d.text = ""; d.think = ""
      session.interrupt()
    },
    onInterruptNotice: () => dispatch({ kind: "interrupt.notice", text: "Press Escape again to interrupt" }),
    onCopyLast: () => { copyLast() },
    onAttachClipboard: attachClipboard,
    onNotice: (text) => dispatch({ kind: "system", text }),
    onToggleSidebar: () => setHideSidebar(v => !v),
  })

  // ── Control bridge ────────────────────────────────────────────────
  const state = useRef({ tab, ready, streaming: turn.streaming, messages: turn.messages, sid, focusRegion })
  state.current = { tab, ready, streaming: turn.streaming, messages: turn.messages, sid, focusRegion }
  useEffect(() => {
    if (!controlEnabled) return
    setBridge({
      tab: () => state.current.tab,
      setTab,
      send: (msg: string) => {
        if (!state.current.ready || state.current.streaming) return
        dispatch({ kind: "user", text: msg })
        gw.request("prompt.submit", { text: msg }).catch(() => {})
        setTab(CHAT_TAB)
      },
      ready: () => state.current.ready,
      streaming: () => state.current.streaming,
      messages: () => state.current.messages.length,
      session: () => state.current.sid,
      input: () => composer.current?.value() ?? "",
      setInput: (v: string) => composer.current?.set(v),
      focusRegion: () => state.current.focusRegion,
      setFocusRegion,
      renderer: () => renderer,
      logs: (n?: number) => gw.tail(n),
    })
  }, [gw, renderer])

  const contentFocused = focusRegion === "content" && !turn.streaming

  const content = () => {
    const inner = (() => {
      switch (tab) {
        case 0: return <Chat messages={turn.messages} streaming={turn.streaming} status={status}
                             cloud={cloud} cloudH={cloudH} pick={pick}
                             onResize={setCloudH} onPick={onPick} onRewind={msgMenu} />
        case 1: return <Context description={TABS[tab].description} messages={turn.messages}
                               sessionStart={sessionStart.current} info={info ?? undefined}
                               focused={contentFocused} />
        case 2: return <Sessions onSwitch={switchSession} currentId={sid} focused={contentFocused} />
        case 3: return <Agents focused={contentFocused} sessionId={sid} />
        case 4: return <Analytics focused={contentFocused} />
        case 5: return <Skills focused={contentFocused} />
        case 6: return <Cron focused={contentFocused} />
        case 7: return <Toolsets focused={contentFocused} />
        case 8: return <Config focused={contentFocused} />
        case 9: return <Env focused={contentFocused} />
        case 10: return <Memory focused={contentFocused} />
        default: return null
      }
    })()
    const name = TABS[tab]?.name ?? "unknown"
    return <Profiler id={`tab:${name}`} onRender={perf.onRender}>{inner}</Profiler>
  }

  const theme = themeCtx.theme
  const onMouseUp = useCallback(() => copySelection(renderer), [renderer])
  const inputFocused = focusRegion === "input"

  return (
    <Profiler id="shell" onRender={perf.onRender}>
     <SkinProvider value={skin}>
      <box width="100%" height="100%" flexDirection="column"
           backgroundColor={theme.background} onMouseUp={onMouseUp}>
        <TabBar tabs={TABS} activeTab={tab} onTabChange={goToTab} />
        <box flexGrow={1} flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {content()}
            <box flexShrink={0} zIndex={1}>
              <Composer
                ref={composer}
                focused={inputFocused} ready={ready} streaming={turn.streaming}
                status={status}
                queue={queue}
                attachments={attachments}
                cmds={cmds}
                onSend={send} onSlash={slash}
                onEnqueue={onEnqueue}
                onDequeue={dequeue}
              />
            </box>
          </box>
          {dims.width >= (tab === CHAT_TAB ? 120 : 140) && !hideSidebar ? (
            <Profiler id="sidebar" onRender={perf.onRender}>
              <Sidebar agentState={agentState} info={info} usage={usage} eikon={eikon} profile={activeProfileName()}
                       title={title}
                       cloud={tab === 0 && cloud} pulse={turn.streaming}
                       onAvatar={onAvatar} />
            </Profiler>
          ) : null}
        </box>
      </box>
     </SkinProvider>
    </Profiler>
  )
}
