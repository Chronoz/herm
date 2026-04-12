import { useKeyboard, useRenderer } from "@opentui/react"
import { useState, useEffect, useRef, useCallback } from "react"
import { HermesApiClient } from "./utils/hermes-api-client"
import type { DonePayload } from "./utils/hermes-api-client"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar } from "./components/sidebar/Sidebar"
import { Chat } from "./tabs/Chat"
import { Context } from "./tabs/Context"
import type { Message, Usage, ToolPart } from "./types/message"
import { mid } from "./types/message"
import { copySelection } from "./utils/clipboard"
import { ThemeProvider, useTheme } from "./theme"

export const App = () => (
  <ThemeProvider>
    <AppInner />
  </ThemeProvider>
)

const MAX_HISTORY = 50

const AppInner = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [model] = useState("hermes-agent")
  const [tools] = useState(["web", "file"])
  const [memos] = useState(0)
  const [ready, setReady] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [session] = useState(`herm-${Date.now()}`)
  const [tab, setTab] = useState(0)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [cost, setCost] = useState(0)

  // Prompt history
  const [history, setHistory] = useState<string[]>([])
  const histIdx = useRef(-1)
  const stash = useRef("")

  const renderer = useRenderer()
  const client = useRef<HermesApiClient | null>(null)
  const buf = useRef("")
  const start = useRef(Date.now())

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
      buf.current = ""
    })

    api.on("content", (chunk: string) => {
      buf.current += chunk
      const text = buf.current
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant" && last.parts.some(p => p.type === "text" && p.streaming)) {
          // Update existing streaming message
          const parts = last.parts.map(p =>
            p.type === "text" && p.streaming ? { ...p, content: text } : p
          )
          return [...prev.slice(0, -1), { ...last, parts }]
        }
        // Create new assistant message
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
          // Add new tool part
          const part: ToolPart = { type: "tool", id: tc.id, name: tc.name, args: "", status: tc.status as ToolPart["status"] }
          return [...prev.slice(0, -1), { ...last, parts: [...last.parts, part] }]
        }
        // Create new assistant message with tool
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
      // Finalize the last assistant message
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
      if (data.usage) {
        setUsage(data.usage)
        // Rough cost estimate (Claude Sonnet pricing as default)
        const c = (data.usage.input * 3 + data.usage.output * 15) / 1_000_000
        setCost(prev => prev + c)
      }
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

  // Send message
  const send = useCallback(() => {
    const msg = input.trim()
    if (!msg || !ready || streaming) return

    // Add to history
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

  // Copy last assistant message
  const copyLast = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "assistant") {
        const content = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
        if (content) {
          // Use OSC 52 to copy
          process.stdout.write(`\x1b]52;c;${Buffer.from(content).toString("base64")}\x07`)
          return true
        }
      }
    }
    return false
  }, [messages])

  // Keyboard handler
  useKeyboard((key) => {
    // Tab switching: Ctrl+Left/Right
    if (key.ctrl && key.name === "left") { setTab(t => Math.max(0, t - 1)); return }
    if (key.ctrl && key.name === "right") { setTab(t => Math.min(1, t + 1)); return }

    // Only handle input keys on Chat tab
    if (tab !== 0) return

    // Escape — interrupt streaming
    if (key.name === "escape") {
      if (streaming) client.current?.interrupt()
      return
    }

    // Ctrl+C — copy selection or exit
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return
      renderer.destroy()
      return
    }

    // Ctrl+Y — copy last assistant message
    if (key.ctrl && key.name === "y") {
      copyLast()
      return
    }

    // Up arrow — prompt history
    if (key.name === "up") {
      if (history.length === 0) return
      if (histIdx.current === -1) stash.current = input
      const next = Math.min(histIdx.current + 1, history.length - 1)
      histIdx.current = next
      setInput(history[next])
      return
    }

    // Down arrow — prompt history
    if (key.name === "down") {
      if (histIdx.current === -1) return
      const next = histIdx.current - 1
      histIdx.current = next
      setInput(next === -1 ? stash.current : history[next])
      return
    }

    // These keys are handled by the textarea component when focused
    // Let arrow left/right pass through
    if (key.name === "left" || key.name === "right") return
  })

  const tabs = [
    { name: "Chat", description: "Main chat interface" },
    { name: "Context", description: "Context and session info" },
  ]

  const content = () => {
    switch (tab) {
      case 0:
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
          />
        )
      case 1:
        return (
          <Context
            description={tabs[tab].description}
            client={client.current}
            messages={messages}
            sessionStart={start.current}
          />
        )
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
