// Message types for herm chat — parts-based like OpenCode

export type TextPart = {
  type: "text"
  content: string
  streaming: boolean
}

export type ToolPart = {
  type: "tool"
  id: string
  name: string
  args: string
  status: "running" | "done" | "error"
}

export type Part = TextPart | ToolPart

export type Usage = {
  input: number
  output: number
  total: number
}

export type Message = {
  id: string
  role: "user" | "assistant" | "system"
  parts: Part[]
  timestamp: number
  model?: string
  duration?: number
  usage?: Usage
  error?: string
}

// Helper to extract all text content from a message
export function text(msg: Message): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.content)
    .join("")
}

// Helper to extract tool parts
export function tools(msg: Message): ToolPart[] {
  return msg.parts.filter((p): p is ToolPart => p.type === "tool")
}

// Create a unique message ID
export function mid(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
