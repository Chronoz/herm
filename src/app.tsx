import { useKeyboard, useRenderer } from "@opentui/react"
import { Profiler, useState, useEffect, useRef, useCallback, useMemo } from "react"
import * as perf from "./utils/perf"
import { setBridge, enabled as controlEnabled } from "./utils/control"
import { HermesApiClient } from "./utils/hermes-api-client"
import type { DonePayload } from "./utils/hermes-api-client"
import type { AvatarState } from "./components/avatar/states"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar } from "./components/sidebar/Sidebar"
import { Overview } from "./tabs/Overview"
import { Chat } from "./tabs/Chat"
import { Context } from "./tabs/Context"
import { Sessions } from "./tabs/Sessions"
import { Analytics } from "./tabs/Analytics"
import type { MessageRow } from "./utils/hermes-home"
import { Memory } from "./tabs/Memory"
import { Skills } from "./tabs/Skills"
import { Config } from "./tabs/Config"
import { Cron } from "./tabs/Cron"
import { Toolsets } from "./tabs/Toolsets"
import { Env } from "./tabs/Env"
import type { Message, Usage, ToolPart, ThinkingPart } from "./types/message"
import { mid } from "./types/message"
import { copySelection } from "./utils/clipboard"
import { ThemeProvider, useTheme } from "./theme"
import { DialogProvider, useDialog } from "./ui/dialog"
import { ToastProvider } from "./ui/toast"
import { CommandProvider, useCommand } from "./ui/command"
import { HelpDialog } from "./dialogs/help"
import { openThemePicker } from "./dialogs/theme-picker"
import type { SlashCommand } from "./commands/slash"
import { filter as filterSlash } from "./commands/slash"
import { InputArea } from "./components/chat/InputArea"

export const App = () => (
  <ThemeProvider>
    <ToastProvider>
      <DialogProvider>
        <CommandProvider>
          <AppInner />
        </CommandProvider>
      </DialogProvider>
    </ToastProvider>
  </ThemeProvider>
)

const MAX_HISTORY = 50
const INTERRUPT_WINDOW = 5000

const AppInner = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [model] = useState("hermes-agent")
  const [ready, setReady] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  const [toolActive, setToolActive] = useState(false)
  const [session, setSession] = useState(`herm-${Date.now()}`)
  const [tab, setTab] = useState(1)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [cost, setCost] = useState(0)
  const [msgCount, setMsgCount] = useState(0)

  const [history, setHistory] = useState<string[]>([])
  const [popCursor, setPopCursor] = useState(0)
  const histIdx = useRef(-1)
  const stash = useRef("")
  const lastEsc = useRef(0)

  // Derive avatar state from agent activity signals
  const agentState: AvatarState = !ready
    ? "error"
    : toolActive
      ? "working"
      : streaming && hasContent
        ? "speaking"
        : streaming
          ? "thinking"
          : "idle"

  const renderer = useRenderer()
  const client = useRef<HermesApiClient | null>(null)
  const buf = useRef("")

  const dialog = useDialog()
  const themeCtx = useTheme()
  const cmd = useCommand()

  // Slash popover — derived from input value
  const popover = useMemo(() => {
    const m = input.match(/^\/(\S*)$/)
    return m ? filterSlash(m[1]) : null
  }, [input])

  // Reset cursor when input changes
  useEffect(() => {
    setPopCursor(0)
  }, [input])

  const popOpen = popover !== null && popover.length > 0

  // Register commands
  useEffect(() => cmd.register([
    {
      title: "Help",
      value: "help",
      keybind: "f1",
      description: "Keyboard shortcuts",
      category: "General",
      onSelect: () => dialog.replace(<HelpDialog />),
    },
    {
      title: "Switch Theme",
      value: "theme",
      description: "Change color theme",
      category: "General",
      onSelect: () => openThemePicker(dialog, themeCtx),
    },
    {
      title: "New Session",
      value: "new-session",
      description: "Start a new chat session",
      category: "Session",
      onSelect: () => {},
    },
  ]), [cmd, dialog, themeCtx])

  // Wire API client event handlers — shared between connect() and switchSession()
  const wire = useCallback((api: HermesApiClient) => {
    api.on("start", () => {
      perf.count("stream:start")
      perf.mem("stream-start")
      setStreaming(true)
      setHasContent(false)
      setToolActive(false)
      buf.current = ""
    })

    api.on("content", (chunk: string) => {
      perf.count("stream:chunk")
      setHasContent(true)
      setToolActive(false)
      buf.current += chunk
      const text = buf.current
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant" && last.parts.some(p => p.type === "text" && p.streaming)) {
          const parts = last.parts.map(p =>
            p.type === "text" && p.streaming ? { ...p, content: text } : p
          )
          return [...prev.slice(0, -1), { ...last, parts }]
        }
        return [...prev, {
          id: mid(),
          role: "assistant",
          parts: [{ type: "text", content: text, streaming: true }],
          timestamp: Date.now() / 1000,
          model,
        }]
      })
    })

    api.on("tool", (tc: { id?: string; name: string; status: string; preview?: string; duration?: number }) => {
      setToolActive(tc.status === "running")
      setHasContent(false)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          // For tool.completed from runs API — match by name (last running tool with that name)
          if (!tc.id && tc.status !== "running") {
            const idx = last.parts.findIndex(p => p.type === "tool" && p.name === tc.name && p.status === "running")
            if (idx >= 0) {
              const tool = last.parts[idx] as ToolPart
              const parts = [...last.parts]
              parts[idx] = {
                ...tool,
                status: tc.status as ToolPart["status"],
                duration: tc.duration ?? (tool.startedAt ? Date.now() - tool.startedAt : undefined),
              }
              return [...prev.slice(0, -1), { ...last, parts }]
            }
          }
          const existing = tc.id ? last.parts.find(p => p.type === "tool" && p.id === tc.id) : null
          if (existing) {
            const parts = last.parts.map(p =>
              p.type === "tool" && p.id === tc.id ? { ...p, status: tc.status, ...(tc.status === "done" && (p as ToolPart).startedAt ? { duration: Date.now() - (p as ToolPart).startedAt! } : {}) } as ToolPart : p
            )
            return [...prev.slice(0, -1), { ...last, parts }]
          }
          const toolId = tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          const part: ToolPart = { type: "tool", id: toolId, name: tc.name, args: "", status: tc.status as ToolPart["status"], startedAt: Date.now(), preview: tc.preview }
          return [...prev.slice(0, -1), { ...last, parts: [...last.parts, part] }]
        }
        const toolId = tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        return [...prev, {
          id: mid(),
          role: "assistant",
          parts: [{ type: "tool", id: toolId, name: tc.name, args: "", status: tc.status as ToolPart["status"], preview: tc.preview }],
          timestamp: Date.now() / 1000,
          model,
        }]
      })
    })

    // Thinking/reasoning from runs API
    api.on("thinking", (text: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const thinkingPart = last.parts.find(p => p.type === "thinking")
          if (thinkingPart) {
            const parts = last.parts.map(p =>
              p.type === "thinking" ? { ...p, content: text, streaming: false } as ThinkingPart : p
            )
            return [...prev.slice(0, -1), { ...last, parts }]
          }
          return [...prev.slice(0, -1), { ...last, parts: [{ type: "thinking" as const, content: text, streaming: false }, ...last.parts] }]
        }
        return [...prev, {
          id: mid(),
          role: "assistant" as const,
          parts: [{ type: "thinking" as const, content: text, streaming: false }],
          timestamp: Date.now() / 1000,
          model,
        }]
      })
    })

    api.on("done", (data: DonePayload) => {
      perf.count("stream:done")
      perf.mem("stream-done")
      setStreaming(false)
      setHasContent(false)
      setToolActive(false)
      buf.current = ""
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const parts = last.parts.map(p =>
            p.type === "text" && p.streaming ? { ...p, streaming: false } : p
          )
          return [...prev.slice(0, -1), { ...last, parts, duration: data.duration, usage: data.usage }]
        }
        return prev
      })
      setMessages(prev => prev.length > 200 ? prev.slice(-200) : prev)
      setMsgCount(c => c + 1)
      if (data.usage) {
        setUsage(data.usage)
        setCost(prev => prev + (data.usage!.input * 3 + data.usage!.output * 15) / 1_000_000)
      }
    })

    api.on("aborted", () => {
      setStreaming(false)
      setHasContent(false)
      setToolActive(false)
      buf.current = ""
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const parts = last.parts.map(p =>
            p.type === "text" && p.streaming ? { ...p, streaming: false } : p
          )
          return [...prev.slice(0, -1), { ...last, parts, error: "Interrupted" }]
        }
        return prev
      })
    })

    api.on("error", (err: Error) => {
      setStreaming(false)
      setHasContent(false)
      setToolActive(false)
      buf.current = ""
      setMessages(prev => [...prev, {
        id: mid(),
        role: "system",
        parts: [{ type: "text", content: `Error: ${err.message}`, streaming: false }],
        timestamp: Date.now() / 1000,
      }])
    })
  }, [model])

  // Connect to Hermes
  const connect = useCallback(async () => {
    const api = new HermesApiClient({
      url: "http://localhost:8642/v1",
      key: process.env.API_SERVER_KEY,
      session,
      model,
    })

    api.on("connected", () => {
      setReady(true)
      setMessages(prev => [...prev, {
        id: mid(),
        role: "system",
        parts: [{ type: "text", content: `Connected to Hermes. Session: ${session}`, streaming: false }],
        timestamp: Date.now() / 1000,
      }])
    })

    wire(api)

    client.current = api
    try {
      await api.connect()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages([{
        id: mid(),
        role: "system",
        parts: [{ type: "text", content: `Failed to connect: ${msg}`, streaming: false }],
        timestamp: Date.now() / 1000,
      }])
    }
  }, [session, model, wire])

  useEffect(() => {
    connect()
    return () => { client.current?.disconnect() }
  }, [connect])

  // Control server bridge (CONTROL=1) — uses refs to avoid stale closures
  const state = useRef({ tab, ready, streaming, messages, session, input })
  state.current = { tab, ready, streaming, messages, session, input }
  useEffect(() => {
    if (!controlEnabled) return
    setBridge({
      tab: () => state.current.tab,
      setTab,
      send: (msg: string) => {
        if (!state.current.ready || state.current.streaming) return
        setMessages(prev => [...prev, {
          id: mid(),
          role: "user",
          parts: [{ type: "text", content: msg, streaming: false }],
          timestamp: Date.now() / 1000,
        }])
        client.current?.send(msg)
        setTab(1)
      },
      ready: () => state.current.ready,
      streaming: () => state.current.streaming,
      messages: () => state.current.messages.length,
      session: () => state.current.session,
      input: () => state.current.input,
      setInput: (v: string) => setInput(v),
      renderer: () => renderer,
    })
  }, [])

  // Handle slash commands
  const slash = useCallback((cmd: SlashCommand) => {
    setInput("")
    if (cmd.target === "local") {
      switch (cmd.name) {
        case "clear":
          setMessages([])
          setMsgCount(0)
          return
        case "new": {
          const sid = `herm-${Date.now()}`
          client.current?.disconnect()
          setMessages([])
          setSession(sid)
          setCost(0)
          setUsage(undefined)
          setMsgCount(0)
          connect()
          return
        }
        case "theme":
          openThemePicker(dialog, themeCtx)
          return
        case "help":
          dialog.replace(<HelpDialog />)
          return
      }
    }

    // Gateway commands — send as /{name}
    if (cmd.target === "gateway" && client.current && ready && !streaming) {
      setMessages(prev => [...prev, {
        id: mid(),
        role: "user",
        parts: [{ type: "text", content: `/${cmd.name}`, streaming: false }],
        timestamp: Date.now() / 1000,
      }])
      client.current.send(`/${cmd.name}`)
    }
  }, [ready, streaming, connect, dialog, themeCtx])

  // Send message (or select popover item on Enter)
  const send = useCallback((val?: string) => {
    // If popover is open, Enter selects the active command
    if (popOpen) {
      slash(popover[popCursor])
      return
    }
    const msg = (val ?? input).trim()
    if (!msg || !ready || streaming) return

    setHistory(prev => {
      const next = [msg, ...prev.filter(h => h !== msg)]
      return next.slice(0, MAX_HISTORY)
    })
    histIdx.current = -1
    stash.current = ""

    setMessages(prev => [...prev, {
      id: mid(),
      role: "user",
      parts: [{ type: "text", content: msg, streaming: false }],
      timestamp: Date.now() / 1000,
    }])

    client.current?.send(msg)
    setInput("")
    setTab(1)
  }, [input, ready, streaming, popOpen, popover, popCursor, slash])

  // Copy last assistant message
  const copyLast = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "assistant") {
        const content = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
        if (content) {
          process.stdout.write(`\x1b]52;c;${Buffer.from(content).toString("base64")}\x07`)
          return true
        }
      }
    }
    return false
  }, [messages])

  // Switch to an existing session
  const switchSession = useCallback((sid: string, rows: MessageRow[]) => {
    const loaded: Message[] = rows
      .filter(r => r.content && (r.role === "user" || r.role === "assistant"))
      .map(r => ({
        id: mid(),
        role: r.role as "user" | "assistant",
        parts: [{ type: "text" as const, content: r.content ?? "", streaming: false }],
        timestamp: r.timestamp,
      }))

    setMessages(loaded)
    setSession(sid)
    setTab(1)
    setMsgCount(loaded.length)
    setCost(0)
    setUsage(undefined)

    client.current?.disconnect()

    const api = new HermesApiClient({
      url: "http://localhost:8642/v1",
      key: process.env.API_SERVER_KEY,
      session: sid,
      model,
    })
    wire(api)
    client.current = api
    setReady(true)
  }, [model, wire])

  // Keyboard handler
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    if (key.ctrl && key.name === "left") { setTab(t => Math.max(0, t - 1)); return }
    if (key.ctrl && key.name === "right") { setTab(t => Math.min(10, t + 1)); return }

    // --- Popover open: route navigation keys to popover ---
    if (popOpen) {
      if (key.name === "escape") {
        setInput("")
        return
      }
      if (key.name === "up") {
        setPopCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.name === "down") {
        setPopCursor(c => Math.min((popover?.length ?? 1) - 1, c + 1))
        return
      }
      if (key.name === "tab") {
        const item = popover?.[popCursor]
        if (item) slash(item)
        return
      }
      // Enter is handled by <input> onSubmit — which calls send(),
      // but we intercept in send() when popover is open.
      return
    }

    // --- Popover closed: normal chat keys ---
    if (key.name === "escape") {
      if (streaming) {
        const now = Date.now()
        if (now - lastEsc.current < INTERRUPT_WINDOW) {
          client.current?.interrupt()
          lastEsc.current = 0
        } else {
          lastEsc.current = now
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === "system" && last.parts[0]?.type === "text" && last.parts[0].content.includes("Press Escape again")) return prev
            return [...prev, {
              id: mid(),
              role: "system",
              parts: [{ type: "text", content: "Press Escape again to interrupt", streaming: false }],
              timestamp: Date.now() / 1000,
            }]
          })
        }
      }
      return
    }

    if (key.ctrl && key.name === "y") { copyLast(); return }

    if (key.name === "up" && !streaming) {
      if (history.length === 0) return
      if (histIdx.current === -1) stash.current = input
      const next = Math.min(histIdx.current + 1, history.length - 1)
      histIdx.current = next
      setInput(history[next])
      return
    }

    if (key.name === "down" && !streaming) {
      if (histIdx.current === -1) return
      const next = histIdx.current - 1
      histIdx.current = next
      setInput(next === -1 ? stash.current : history[next])
      return
    }
  })

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
        case 1:
          return (
            <Chat messages={messages} streaming={streaming} />
          )
        case 2:
          return (
            <Context
              description={tabs[tab].description}
              client={client.current}
              messages={messages}
              sessionStart={Date.now()}
              visible={tab === 2}
            />
          )
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

  return (
    <Profiler id="shell" onRender={perf.onRender}>
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={theme.background}
        onMouseUp={() => copySelection(renderer)}
      >
        <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />
        <box flexGrow={1} flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {content()}
            <box flexShrink={0}>
              <InputArea
                value={input}
                onChange={setInput}
                onSubmit={send}
                focused={!streaming}
                ready={ready}
                streaming={streaming}
                model={model}
                usage={usage}
                cost={cost}
                turns={msgCount}
                popover={popover}
                popCursor={popCursor}
                onPopCursor={setPopCursor}
                onPopSelect={slash}
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
