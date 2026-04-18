import { useRenderer } from "@opentui/react"
import { Profiler, useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react"
import * as perf from "./utils/perf"
import { setBridge, enabled as controlEnabled } from "./utils/control"
import { GatewayProvider, useGateway, useGatewayEvent } from "./app/gateway"
import type { GatewayEvent, SessionInfo } from "./utils/gateway-types"
import type { AvatarState } from "./components/avatar/states"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar } from "./components/sidebar/Sidebar"
import { Overview } from "./tabs/Overview"
import { Chat } from "./tabs/Chat"
import { Context } from "./tabs/Context"
import { Sessions } from "./tabs/Sessions"
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
import { openThemePicker } from "./dialogs/theme-picker"
import { openModelPicker } from "./dialogs/model-picker"
import { ApprovalPrompt, ClarifyPrompt, SudoPrompt, SecretPrompt } from "./ui/prompts"
import type { SlashCommand } from "./commands/slash"
import { InputArea } from "./components/chat/InputArea"
import * as preferences from "./utils/preferences"
import { turnReducer, initialTurn, userMessage, systemMessage } from "./app/turnReducer"
import { mapEvent } from "./app/gatewayEvents"
import { useSession } from "./app/useSession"
import { useSlashCommands } from "./app/useSlashCommands"
import { useInputHistory } from "./app/useInputHistory"
import { useSlashPopover } from "./app/useSlashPopover"
import { useAppKeys } from "./app/useAppKeys"

export const App = ({ initialTheme }: { initialTheme?: string }) => (
  <ThemeProvider initial={initialTheme}>
    <ToastProvider>
      <DialogProvider>
        <GatewayProvider>
          <CommandProvider>
            <AppInner />
          </CommandProvider>
        </GatewayProvider>
      </DialogProvider>
    </ToastProvider>
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
  const { cmds } = useSlashCommands()

  const [turn, dispatch] = useReducer(turnReducer, initialTurn)
  const [input, setInput] = useState("")
  const [ready, setReady] = useState(false)
  const [sid, setSid] = useState("")
  const [tab, setTab] = useState(1)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [cost, setCost] = useState(0)
  const [msgCount, setMsgCount] = useState(0)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [focusRegion, setFocusRegion] = useState<"input" | "content">("input")
  const sessionStart = useRef(Date.now())

  const history = useInputHistory(input, setInput)
  const pop = useSlashPopover(input, cmds)

  // Derive avatar state
  const agentState: AvatarState = !ready
    ? "error"
    : turn.toolActive ? "working"
    : turn.streaming && turn.hasContent ? "speaking"
    : turn.streaming ? "thinking"
    : "idle"

  // ── Handle gateway events ─────────────────────────────────────────
  const handle = useCallback((ev: GatewayEvent) => {
    const action = mapEvent(ev, {
      onReady: () => {
        session.boot().then(({ id, messages }) => {
          setSid(id)
          sessionStart.current = Date.now()
          if (messages.length) dispatch({ kind: "load", messages })
          setMsgCount(messages.length)
        })
      },
      onSessionInfo: (si) => {
        setInfo(si)
        setReady(true)
        if (si.session_id) setSid(si.session_id)
      },
      onUsage: (u) => {
        setUsage(u)
        setCost(prev => prev + (u.input * 3 + u.output * 15) / 1_000_000)
      },
      onTurnComplete: () => setMsgCount(c => c + 1),
      onClarify: (req) => dialog.replace(<ClarifyPrompt req={req} />),
      onApproval: (req) => dialog.replace(<ApprovalPrompt req={req} />),
      onSudo: (req) => dialog.replace(<SudoPrompt req={req} />),
      onSecret: (req) => dialog.replace(<SecretPrompt req={req} />),
      onBackground: (_tid, text) => toast.show({ variant: "info", message: `bg task: ${text.slice(0, 80)}` }),
      onBtw: (text) => dispatch({ kind: "system", text: `btw: ${text}` }),
    })
    if (action) dispatch(action)
  }, [session, dialog, toast])

  useGatewayEvent(handle)

  // ── Command palette ───────────────────────────────────────────────
  useEffect(() => cmd.register([
    { title: "Help", value: "help", keybind: "f1", description: "Keyboard shortcuts", category: "General",
      onSelect: () => dialog.replace(<HelpDialog />) },
    { title: "Switch Theme", value: "theme", description: "Change color theme", category: "General",
      onSelect: () => openThemePicker(dialog, themeCtx) },
    { title: "Switch Model", value: "model", description: "Pick provider and model", category: "General",
      onSelect: () => openModelPicker(dialog, gw) },
    { title: "New Session", value: "new-session", description: "Start a new chat session", category: "Session",
      onSelect: () => newSession() },
    { title: "Compress Session", value: "compress", description: "Compress conversation history", category: "Session",
      onSelect: () => session.compress() },
    { title: "Undo Last Turn", value: "undo", description: "Remove last user/assistant exchange", category: "Session",
      onSelect: () => session.undo() },
    { title: "Branch Session", value: "branch", description: "Fork the current conversation", category: "Session",
      onSelect: () => session.branch() },
  ]), [cmd, dialog, themeCtx, session, gw])

  // ── Session ops ───────────────────────────────────────────────────
  const newSession = useCallback(async () => {
    dispatch({ kind: "reset" })
    setMsgCount(0)
    setCost(0)
    setUsage(undefined)
    setReady(false)
    try { setSid(await session.create()); sessionStart.current = Date.now() }
    catch {}
  }, [session])

  const switchSession = useCallback(async (target: string) => {
    dispatch({ kind: "reset" })
    setMsgCount(0)
    setCost(0)
    setUsage(undefined)
    setReady(false)
    try {
      const { id, messages } = await session.resume(target)
      setSid(id)
      sessionStart.current = Date.now()
      if (messages.length) { dispatch({ kind: "load", messages }); setMsgCount(messages.length) }
    } catch (err) {
      dispatch({ kind: "system", text: `Failed to resume: ${err instanceof Error ? err.message : String(err)}` })
    }
  }, [session])

  // ── Send message ──────────────────────────────────────────────────
  const send = useCallback((val?: string) => {
    if (pop.open) { slash(pop.popover![pop.cursor]); return }
    const msg = (val ?? input).trim()
    if (!msg || !ready || turn.streaming) return

    history.push(msg)
    dispatch({ kind: "user", text: msg })
    preferences.set("lastSessionId", sid)
    gw.request("prompt.submit", { text: msg }).catch(() => {})
    setInput("")
    setTab(1)
  }, [input, ready, turn.streaming, pop.open, pop.popover, pop.cursor, sid, gw, history])

  // ── Slash dispatch ────────────────────────────────────────────────
  const slash = useCallback((command: SlashCommand) => {
    if (command.name.includes(" ")) { setInput(`/${command.name} `); return }
    setInput("")
    if (command.target === "local") {
      switch (command.name) {
        case "clear": dispatch({ kind: "reset" }); setMsgCount(0); return
        case "new": newSession(); return
        case "theme": openThemePicker(dialog, themeCtx); return
        case "help": dialog.replace(<HelpDialog />); return
      }
    }

    if (command.target !== "gateway" || !ready || turn.streaming) return
    dispatch({ kind: "user", text: `/${command.name}` })
    gw.request<{ output?: string }>("slash.exec", { command: `/${command.name}` })
      .then(res => { if (res?.output) dispatch({ kind: "system", text: res.output }) })
      .catch(() => { gw.request("prompt.submit", { text: `/${command.name}` }).catch(() => {}) })
  }, [ready, turn.streaming, dialog, themeCtx, newSession, gw])

  // ── Copy last assistant ───────────────────────────────────────────
  const copyLast = useCallback(() => {
    for (let i = turn.messages.length - 1; i >= 0; i--) {
      const m = turn.messages[i]
      if (m.role !== "assistant") continue
      const content = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
      if (!content) continue
      process.stdout.write(`\x1b]52;c;${Buffer.from(content).toString("base64")}\x07`)
      return true
    }
    return false
  }, [turn.messages])

  // ── Keyboard ──────────────────────────────────────────────────────
  useAppKeys({
    tab, setTab, focusRegion, setFocusRegion,
    streaming: turn.streaming,
    popOpen: pop.open,
    onPopNavigate: (d) => pop.setCursor(c => Math.max(0, Math.min((pop.popover?.length ?? 1) - 1, c + d))),
    onPopAccept: () => {
      const item = pop.popover?.[pop.cursor]
      if (!item) return
      setInput(item.name.includes(" ") ? `/${item.name} ` : `/${item.name}`)
    },
    onPopCancel: () => setInput(""),
    onHistoryUp: history.up,
    onHistoryDown: history.down,
    onInterrupt: () => session.interrupt(),
    onInterruptNotice: () => dispatch({ kind: "interrupt.notice", text: "Press Escape again to interrupt" }),
    onCopyLast: () => { copyLast() },
    input,
  })

  // ── Control server bridge (headless/automation) ───────────────────
  const state = useRef({ tab, ready, streaming: turn.streaming, messages: turn.messages, sid, input, focusRegion })
  state.current = { tab, ready, streaming: turn.streaming, messages: turn.messages, sid, input, focusRegion }
  useEffect(() => {
    if (!controlEnabled) return
    setBridge({
      tab: () => state.current.tab,
      setTab,
      send: (msg: string) => {
        if (!state.current.ready || state.current.streaming) return
        dispatch({ kind: "user", text: msg })
        gw.request("prompt.submit", { text: msg }).catch(() => {})
        setTab(1)
      },
      ready: () => state.current.ready,
      streaming: () => state.current.streaming,
      messages: () => state.current.messages.length,
      session: () => state.current.sid,
      input: () => state.current.input,
      setInput,
      focusRegion: () => state.current.focusRegion,
      setFocusRegion,
      renderer: () => renderer,
    })
  }, [gw, renderer])

  const model = info?.model ?? "hermes-agent"

  const tabs = useMemo(() => [
    { name: "Overview", description: "Dashboard" },
    { name: "Chat", description: "Main chat interface" },
    { name: "Context", description: "Context and session info" },
    { name: "Sessions", description: "Session history" },
    { name: "Analytics", description: "Token usage and costs" },
    { name: "Skills", description: "Installed skills browser" },
    { name: "Cron", description: "Scheduled job manager" },
    { name: "Toolsets", description: "Available toolsets manager" },
    { name: "Config", description: "Configuration editor" },
    { name: "Env", description: "API keys & env variables" },
    { name: "Memory", description: "Agent memory browser" },
  ], [])

  const content = () => {
    const inner = (() => {
      switch (tab) {
        case 0: return <Overview visible={tab === 0} />
        case 1: return <Chat messages={turn.messages} streaming={turn.streaming} />
        case 2: return <Context description={tabs[tab].description} messages={turn.messages}
                               sessionStart={sessionStart.current} visible={tab === 2} />
        case 3: return <Sessions onSwitch={switchSession} />
        case 4: return <Analytics visible={tab === 4} />
        case 5: return <Skills />
        case 6: return <Cron />
        case 7: return <Toolsets />
        case 8: return <Config />
        case 9: return <Env />
        case 10: return <Memory visible={tab === 10} />
        default: return null
      }
    })()
    const name = tabs[tab]?.name ?? "unknown"
    return <Profiler id={`tab:${name}`} onRender={perf.onRender}>{inner}</Profiler>
  }

  const { theme } = useTheme()
  const onMouseUp = useCallback(() => copySelection(renderer), [renderer])
  const inputFocused = focusRegion === "input" && !turn.streaming

  return (
    <Profiler id="shell" onRender={perf.onRender}>
      <box width="100%" height="100%" flexDirection="column"
           backgroundColor={theme.background} onMouseUp={onMouseUp}>
        <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />
        <box flexGrow={1} flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {content()}
            <box flexShrink={0}>
              <InputArea
                value={input} onChange={setInput} onSubmit={send}
                focused={inputFocused} ready={ready} streaming={turn.streaming}
                model={model} usage={usage} cost={cost} turns={msgCount}
                popover={pop.popover} popCursor={pop.cursor}
                onPopCursor={pop.setCursor} onPopSelect={slash}
                ghost={pop.ghost}
              />
            </box>
          </box>
          <Profiler id="sidebar" onRender={perf.onRender}>
            <Sidebar agentState={agentState} />
          </Profiler>
        </box>
      </box>
    </Profiler>
  )
}
