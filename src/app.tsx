import { useKeyboard, useRenderer } from "@opentui/react"
import { useState, useEffect, useRef, useCallback } from "react"
import { HermesApiClient } from "./utils/hermes-api-client"
import type { DonePayload } from "./utils/hermes-api-client"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar } from "./components/sidebar/Sidebar"
import { Overview } from "./tabs/Overview"
import { Chat } from "./tabs/Chat"
import { Context } from "./tabs/Context"
import { Sessions } from "./tabs/Sessions"
import type { MessageRow } from "./utils/hermes-home"
import { Memory } from "./tabs/Memory"
import type { Message, Usage, ToolPart } from "./types/message"
import { mid } from "./types/message"
import { copySelection } from "./utils/clipboard"
import { ThemeProvider, useTheme } from "./theme"
import { DialogProvider, useDialog } from "./ui/dialog"
import { ToastProvider } from "./ui/toast"
import { CommandProvider, useCommand } from "./ui/command"
import { HelpDialog } from "./dialogs/help"
import { openThemePicker } from "./dialogs/theme-picker"

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
const INTERRUPT_WINDOW = 5000 // ms — double-escape window

const AppInner = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [model] = useState("hermes-agent")
  const [tools] = useState(["web", "file"])
  const [memos] = useState(0)
  const [ready, setReady] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [session, setSession] = useState(`herm-${Date.now()}`)
  const [tab, setTab] = useState(1)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [total, setTotal] = useState({ input: 0, output: 0 })
  const [cost, setCost] = useState(0)
  const [interrupted, setInterrupted] = useState(false)
  const [msgCount, setMsgCount] = useState(0)

  // Prompt history
  const [history, setHistory] = useState<string[]>([])
  const histIdx = useRef(-1)
  const stash = useRef("")

  // Double-escape tracking
  const lastEsc = useRef(0)

  const renderer = useRenderer()
  const client = useRef<HermesApiClient | null>(null)
  const buf = useRef("")
  const start = useRef(Date.now())

  const dialog = useDialog()
  const themeCtx = useTheme()
  const cmd = useCommand()

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

    api.on("start", () => {
      setStreaming(true)
      setInterrupted(false)
      buf.current = ""
    })

    api.on("content", (chunk: string) => {
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

    api.on("tool", (tc: { id: string; name: string; status: string }) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const existing = last.parts.find(p => p.type === "tool" && p.id === tc.id)
          if (existing) {
            const parts = last.parts.map(p =>
              p.type === "tool" && p.id === tc.id ? { ...p, status: tc.status } as ToolPart : p
            )
            return [...prev.slice(0, -1), { ...last, parts }]
          }
          const part: ToolPart = { type: "tool", id: tc.id, name: tc.name, args: "", status: tc.status as ToolPart["status"] }
          return [...prev.slice(0, -1), { ...last, parts: [...last.parts, part] }]
        }
        return [...prev, {
          id: mid(),
          role: "assistant",
          parts: [{ type: "tool", id: tc.id, name: tc.name, args: "", status: tc.status as ToolPart["status"] }],
          timestamp: Date.now() / 1000,
          model,
        }]
      })
    })

    api.on("done", (data: DonePayload) => {
      setStreaming(false)
      buf.current = ""
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const parts = last.parts.map(p =>
            p.type === "text" && p.streaming ? { ...p, streaming: false } : p
          )
          return [...prev.slice(0, -1), {
            ...last,
            parts,
            duration: data.duration,
            usage: data.usage,
          }]
        }
        return prev
      })
      setMsgCount(c => c + 1)
      if (data.usage) {
        setUsage(data.usage)
        setTotal(prev => ({
          input: prev.input + data.usage!.input,
          output: prev.output + data.usage!.output,
        }))
        const c = (data.usage.input * 3 + data.usage.output * 15) / 1_000_000
        setCost(prev => prev + c)
      }
    })

    api.on("aborted", () => {
      setStreaming(false)
      setInterrupted(true)
      buf.current = ""
      // Mark streaming text as complete
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
      buf.current = ""
      setMessages(prev => [...prev, {
        id: mid(),
        role: "system",
        parts: [{ type: "text", content: `Error: ${err.message}`, streaming: false }],
        timestamp: Date.now() / 1000,
      }])
    })

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
  }, [session, model])

  useEffect(() => {
    connect()
    return () => { client.current?.disconnect() }
  }, [connect])

  // Send message — accepts optional value from input onSubmit
  const send = useCallback((val?: string) => {
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
  }, [input, ready, streaming])

  // Copy last assistant message text
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

  // Switch to an existing session — load its history into chat
  const switchSession = useCallback((sid: string, rows: MessageRow[]) => {
    // Convert MessageRows to app Message format
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
    setTab(1) // switch to Chat tab
    setMsgCount(loaded.length)
    setCost(0)
    setUsage(undefined)
    setTotal({ input: 0, output: 0 })

    // Update the API client's session ID
    if (client.current) {
      client.current.disconnect()
    }
    // Reconnect with new session
    const api = new HermesApiClient({
      url: "http://localhost:8642/v1",
      key: process.env.API_SERVER_KEY,
      session: sid,
      model,
    })
    // Re-wire events (same as connect() but skip the connected system message)
    api.on("start", () => { setStreaming(true); setInterrupted(false); buf.current = "" })
    api.on("content", (chunk: string) => {
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
    api.on("tool", (tc: { id: string; name: string; status: string }) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const existing = last.parts.find(p => p.type === "tool" && p.id === tc.id)
          if (existing) {
            const parts = last.parts.map(p =>
              p.type === "tool" && p.id === tc.id ? { ...p, status: tc.status } as ToolPart : p
            )
            return [...prev.slice(0, -1), { ...last, parts }]
          }
          const part: ToolPart = { type: "tool", id: tc.id, name: tc.name, args: "", status: tc.status as ToolPart["status"] }
          return [...prev.slice(0, -1), { ...last, parts: [...last.parts, part] }]
        }
        return [...prev, {
          id: mid(),
          role: "assistant",
          parts: [{ type: "tool", id: tc.id, name: tc.name, args: "", status: tc.status as ToolPart["status"] }],
          timestamp: Date.now() / 1000,
          model,
        }]
      })
    })
    api.on("done", (data: DonePayload) => {
      setStreaming(false)
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
      setMsgCount(c => c + 1)
      if (data.usage) {
        setUsage(data.usage)
        setTotal(prev => ({ input: prev.input + data.usage!.input, output: prev.output + data.usage!.output }))
        setCost(prev => prev + (data.usage!.input * 3 + data.usage!.output * 15) / 1_000_000)
      }
    })
    api.on("aborted", () => {
      setStreaming(false); setInterrupted(true); buf.current = ""
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          const parts = last.parts.map(p => p.type === "text" && p.streaming ? { ...p, streaming: false } : p)
          return [...prev.slice(0, -1), { ...last, parts, error: "Interrupted" }]
        }
        return prev
      })
    })
    api.on("error", (err: Error) => {
      setStreaming(false); buf.current = ""
      setMessages(prev => [...prev, { id: mid(), role: "system", parts: [{ type: "text", content: `Error: ${err.message}`, streaming: false }], timestamp: Date.now() / 1000 }])
    })
    client.current = api
    setReady(true)
  }, [model])

  // Keyboard handler
  useKeyboard((key) => {
    // Global: Ctrl+C — copy selection or exit
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    // Tab switching: Ctrl+Left/Right
    if (key.ctrl && key.name === "left") { setTab(t => Math.max(0, t - 1)); return }
    if (key.ctrl && key.name === "right") { setTab(t => Math.min(4, t + 1)); return }

    // Only handle remaining keys on Chat tab
    if (tab !== 1) return

    // Double-escape to interrupt
    if (key.name === "escape") {
      if (streaming) {
        const now = Date.now()
        if (now - lastEsc.current < INTERRUPT_WINDOW) {
          client.current?.interrupt()
          lastEsc.current = 0
        } else {
          lastEsc.current = now
          // Show hint — press again to interrupt
          setMessages(prev => {
            // Avoid duplicate hints
            const last = prev[prev.length - 1]
            if (last?.role === "system" && last.parts[0]?.type === "text" && last.parts[0].content.includes("Press Escape again")) {
              return prev
            }
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

    // Ctrl+Y — copy last assistant message
    if (key.ctrl && key.name === "y") {
      copyLast()
      return
    }

    // Up arrow — prompt history (only when not streaming)
    if (key.name === "up" && !streaming) {
      if (history.length === 0) return
      if (histIdx.current === -1) stash.current = input
      const next = Math.min(histIdx.current + 1, history.length - 1)
      histIdx.current = next
      setInput(history[next])
      return
    }

    // Down arrow — prompt history
    if (key.name === "down" && !streaming) {
      if (histIdx.current === -1) return
      const next = histIdx.current - 1
      histIdx.current = next
      setInput(next === -1 ? stash.current : history[next])
      return
    }
  })

  const tabs = [
    { name: "Overview", description: "Dashboard" },
    { name: "Chat", description: "Main chat interface" },
    { name: "Context", description: "Context and session info" },
    { name: "Sessions", description: "Session history" },
    { name: "Memory", description: "Agent memory browser" },
  ]

  const content = () => {
    switch (tab) {
      case 0:
        return <Overview />
      case 1:
        return (
          <Chat
            messages={messages}
            streaming={streaming}
            input={input}
            onInput={setInput}
            onSubmit={send}
            ready={ready}
            model={model}
            usage={usage}
            cost={cost}
            turns={msgCount}
          />
        )
      case 2:
        return (
          <Context
            description={tabs[tab].description}
            client={client.current}
            messages={messages}
            sessionStart={start.current}
          />
        )
      case 3:
        return <Sessions onSwitch={switchSession} />
      case 4:
        return <Memory />
      default:
        return null
    }
  }

  const { theme } = useTheme()

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.background}
      onMouseUp={() => copySelection(renderer)}
    >
      <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />

      <box flexGrow={1} flexDirection="row">
        {content()}
        <Sidebar activeTools={tools} memoryCount={memos} />
      </box>
    </box>
  )
}
