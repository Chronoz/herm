import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Profiler, useState, useEffect, useRef, useCallback, useReducer } from "react"
import * as perf from "./utils/perf"
import { setBridge, enabled as controlEnabled } from "./utils/control"
import { GatewayProvider, useGateway, useGatewayEvent, type Gateway } from "./app/gateway"
import type { GatewayEvent, SessionInfo, SessionUsageResponse } from "./utils/gateway-types"
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
import { HelpDialog } from "./dialogs/help"
import { openLogs } from "./dialogs/logs"
import { openThemePicker } from "./dialogs/theme-picker"
import { openModelPicker } from "./dialogs/model-picker"
import { openEikonPicker } from "./dialogs/eikon-picker"
import { parseEikon, type ParsedEikon } from "./components/avatar/eikon"
import { ApprovalPrompt, ClarifyPrompt, SudoPrompt, SecretPrompt } from "./ui/prompts"
import type { SlashCommand } from "./commands/slash"
import { Composer, type ComposerHandle } from "./components/chat/Composer"
import * as preferences from "./utils/preferences"
import { turnReducer, initialTurn } from "./app/turnReducer"
import { mapEvent } from "./app/gatewayEvents"
import { useSession } from "./app/useSession"
import { useAppKeys } from "./app/useAppKeys"
import { TABS, TAB_MAX, CHAT_TAB } from "./app/tabs"

export const App = (props: { initialTheme?: string; gateway?: Gateway }) => (
  <ThemeProvider initial={props.initialTheme}>
    <GatewayProvider client={props.gateway}>
      <ToastProvider>
        <DialogProvider>
          <CommandProvider>
            <AppInner />
          </CommandProvider>
        </DialogProvider>
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
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [cost, setCost] = useState(0)
  const [msgCount, setMsgCount] = useState(0)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [focusRegion, setFocusRegion] = useState<"input" | "content">("input")
  const [status, setStatus] = useState("")
  const [eikon, setEikon] = useState<ParsedEikon | undefined>(undefined)
  const sessionStart = useRef(Date.now())
  const composer = useRef<ComposerHandle>(null)

  const agentState: AvatarState = !ready
    ? "error"
    : turn.toolActive ? "working"
    : turn.streaming && turn.hasContent ? "speaking"
    : turn.streaming ? "thinking"
    : "idle"

  // ── Session reset / lifecycle ─────────────────────────────────────
  const reset = useCallback(() => {
    dispatch({ kind: "reset" })
    setMsgCount(0)
    setCost(0)
    setUsage(undefined)
    setReady(false)
    setStatus("")
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
      .then(r => { if (r.cost_usd != null) setCost(r.cost_usd) })
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

  // ── Slash dispatch ────────────────────────────────────────────────
  const slash = useCallback((c: SlashCommand) => {
    if (c.target === "local") {
      switch (c.name) {
        case "clear": dispatch({ kind: "reset" }); setMsgCount(0); return
        case "new": newSession(); return
        case "theme": openThemePicker(dialog, themeCtx); return
        case "help": dialog.replace(<HelpDialog />); return
        case "logs": openLogs(dialog); return
        case "eikon": pickEikon(); return
      }
    }
    if (c.target !== "gateway" || !ready || turn.streaming) return
    dispatch({ kind: "user", text: `/${c.name}` })
    gw.request<{ output?: string }>("slash.exec", { command: `/${c.name}` })
      .then(res => { if (res?.output) dispatch({ kind: "system", text: res.output }) })
      .catch(() => { gw.request("prompt.submit", { text: `/${c.name}` }).catch(() => {}) })
  }, [ready, turn.streaming, dialog, themeCtx, newSession, gw, pickEikon])

  // ── Send ──────────────────────────────────────────────────────────
  const send = useCallback((text: string) => {
    dispatch({ kind: "user", text })
    preferences.set("lastSessionId", sid)
    gw.request("prompt.submit", { text }).catch(() => {})
    setTab(CHAT_TAB)
  }, [sid, gw])

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
  const handle = useCallback((ev: GatewayEvent) => {
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
      },
      onUsage: (u) => setUsage(u),
      onTurnComplete: () => { setMsgCount(c => c + 1); setStatus(""); pollUsage() },
      onClarify: (req) => dialog.replace(<ClarifyPrompt req={req} />),
      onApproval: (req) => dialog.replace(<ApprovalPrompt req={req} />),
      onSudo: (req) => dialog.replace(<SudoPrompt req={req} />),
      onSecret: (req) => dialog.replace(<SecretPrompt req={req} />),
      onBackground: (_tid, text) => toast.show({ variant: "info", message: `bg task: ${text.slice(0, 80)}` }),
      onBtw: (text) => dispatch({ kind: "system", text: `btw: ${text}` }),
      onStatus: (text) => setStatus(text),
    })
    if (action) dispatch(action)
  }, [session, dialog, toast, pollUsage])

  useGatewayEvent(handle)

  // ── Command palette ───────────────────────────────────────────────
  useEffect(() => cmd.register([
    { title: "Help", value: "help", keybind: "f1", description: "Keyboard shortcuts", category: "General",
      onSelect: () => dialog.replace(<HelpDialog />) },
    { title: "Gateway Logs", value: "logs", description: "Show gateway stderr", category: "General",
      onSelect: () => openLogs(dialog) },
    { title: "Switch Theme", value: "theme", description: "Change color theme", category: "General",
      onSelect: () => openThemePicker(dialog, themeCtx) },
    { title: "Switch Model", value: "model", description: "Pick provider and model", category: "General",
      onSelect: () => openModelPicker(dialog, gw) },
    { title: "Pick Avatar", value: "eikon", description: "Choose sidebar .eikon avatar", category: "General",
      onSelect: () => pickEikon() },
    { title: "New Session", value: "new-session", description: "Start a new chat session", category: "Session",
      onSelect: () => newSession() },
    { title: "Compress Session", value: "compress", description: "Compress conversation history", category: "Session",
      onSelect: () => session.compress() },
    { title: "Undo Last Turn", value: "undo", description: "Remove last user/assistant exchange", category: "Session",
      onSelect: () => session.undo() },
    { title: "Branch Session", value: "branch", description: "Fork the current conversation", category: "Session",
      onSelect: () => session.branch() },
  ]), [cmd, dialog, themeCtx, session, gw, newSession, pickEikon])

  // ── Keyboard ──────────────────────────────────────────────────────
  useAppKeys({
    tab, tabMax: TAB_MAX, setTab, focusRegion, setFocusRegion,
    streaming: turn.streaming,
    composer,
    onInterrupt: () => session.interrupt(),
    onInterruptNotice: () => dispatch({ kind: "interrupt.notice", text: "Press Escape again to interrupt" }),
    onCopyLast: () => { copyLast() },
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

  const model = info?.model ?? "hermes-agent"
  const contentFocused = focusRegion === "content" && !turn.streaming

  const content = () => {
    const inner = (() => {
      switch (tab) {
        case 0: return <Chat messages={turn.messages} streaming={turn.streaming} />
        case 1: return <Context description={TABS[tab].description} messages={turn.messages}
                               sessionStart={sessionStart.current} />
        case 2: return <Sessions onSwitch={switchSession} focused={contentFocused} />
        case 3: return <Agents focused={contentFocused} />
        case 4: return <Analytics />
        case 5: return <Skills focused={contentFocused} />
        case 6: return <Cron focused={contentFocused} />
        case 7: return <Toolsets focused={contentFocused} />
        case 8: return <Config focused={contentFocused} />
        case 9: return <Env focused={contentFocused} />
        case 10: return <Memory />
        default: return null
      }
    })()
    const name = TABS[tab]?.name ?? "unknown"
    return <Profiler id={`tab:${name}`} onRender={perf.onRender}>{inner}</Profiler>
  }

  const theme = themeCtx.theme
  const onMouseUp = useCallback(() => copySelection(renderer), [renderer])
  const inputFocused = focusRegion === "input" && !turn.streaming

  return (
    <Profiler id="shell" onRender={perf.onRender}>
      <box width="100%" height="100%" flexDirection="column"
           backgroundColor={theme.background} onMouseUp={onMouseUp}>
        <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
        <box flexGrow={1} flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {content()}
            <box flexShrink={0}>
              <Composer
                ref={composer}
                focused={inputFocused} ready={ready} streaming={turn.streaming}
                status={status} model={model} usage={usage} cost={cost} turns={msgCount}
                onSend={send} onSlash={slash}
              />
            </box>
          </box>
          {dims.width >= 120 ? (
            <Profiler id="sidebar" onRender={perf.onRender}>
              <Sidebar agentState={agentState} info={info} eikon={eikon} />
            </Profiler>
          ) : null}
        </box>
      </box>
    </Profiler>
  )
}
