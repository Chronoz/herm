// Typed events and RPC responses for the tui_gateway JSON-RPC protocol.

import type { Usage } from "../types/message"

// ── Events (server → client) ────────────────────────────────────────

export type GatewayEvent =
  | { type: "gateway.ready"; payload?: { skin?: GatewaySkin } }
  | { type: "gateway.stderr"; payload: { line: string } }
  | { type: "gateway.start_timeout"; payload?: { cwd?: string; python?: string } }
  | { type: "gateway.protocol_error"; payload?: { preview?: string } }
  | { type: "session.info"; payload: SessionInfo }
  | { type: "skin.changed"; payload?: GatewaySkin }
  | { type: "message.start"; payload?: undefined }
  | { type: "message.delta"; payload?: { text?: string; rendered?: string } }
  | { type: "message.complete"; payload?: { text?: string | null; rendered?: string; reasoning?: string; status?: "complete" | "error" | "interrupted"; usage?: Usage } }
  | { type: "thinking.delta"; payload?: { text?: string } }
  | { type: "reasoning.delta"; payload?: { text?: string } }
  | { type: "reasoning.available"; payload?: { text?: string } }
  | { type: "status.update"; payload?: { text?: string; kind?: string } }
  | { type: "tool.start"; payload: { tool_id: string; name?: string; context?: string } }
  | { type: "tool.progress"; payload: { name?: string; preview?: string } }
  | { type: "tool.generating"; payload: { name?: string } }
  | { type: "tool.complete"; payload: { tool_id: string; name?: string; summary?: string; error?: string; inline_diff?: string } }
  | { type: "clarify.request"; payload: { request_id: string; question: string; choices: string[] | null } }
  | { type: "approval.request"; payload: { command: string; description: string } }
  | { type: "sudo.request"; payload: { request_id: string } }
  | { type: "secret.request"; payload: { request_id: string; prompt: string; env_var: string } }
  | { type: "background.complete"; payload: { task_id: string; text: string } }
  | { type: "btw.complete"; payload: { text: string } }
  | { type: "subagent.start"; payload: SubagentPayload }
  | { type: "subagent.thinking"; payload: SubagentPayload }
  | { type: "subagent.tool"; payload: SubagentPayload }
  | { type: "subagent.progress"; payload: SubagentPayload }
  | { type: "subagent.complete"; payload: SubagentPayload }
  | { type: "error"; payload?: { message?: string } }

export type SubagentPayload = {
  task_index: number
  goal: string
  task_count?: number
  status?: "running" | "completed" | "failed" | "interrupted"
  text?: string
  tool_name?: string
  tool_preview?: string
  summary?: string
  duration_seconds?: number
}

export type GatewaySkin = {
  colors?: Record<string, string>
  branding?: Record<string, string>
  banner_hero?: string
  banner_logo?: string
  tool_prefix?: string
  help_header?: string
}

export type McpServer = {
  name: string
  transport: string
  tools: number
  connected: boolean
  error?: string
}

export type SessionInfo = {
  model?: string
  cwd?: string
  session_id?: string
  tools?: Record<string, string[]>
  skills?: Record<string, string[]>
  version?: string
  usage?: Usage
  context_max?: number
  context_used?: number
  credential_warning?: string
  mcp_servers?: McpServer[]
}

// ── RPC responses ───────────────────────────────────────────────────

export type SessionCreateResponse = {
  session_id: string
  info?: SessionInfo & { credential_warning?: string }
}

export type SessionResumeResponse = {
  session_id: string
  resumed?: string
  messages: TranscriptMessage[]
  message_count?: number
  info?: SessionInfo
}

export type SessionListItem = {
  id: string
  title: string
  preview: string
  message_count: number
  started_at: number
  source?: string
}

export type SessionListResponse = {
  sessions?: SessionListItem[]
}

export type AgentProcess = {
  session_id: string
  command: string
  status: string
  uptime: number
}

export type AgentsListResponse = {
  processes: AgentProcess[]
}

export type SessionUsageResponse = {
  model?: string
  calls?: number
  input?: number
  output?: number
  total?: number
  cache_read?: number
  cache_write?: number
  cost_usd?: number
  cost_status?: "estimated" | "exact"
  context_used?: number
  context_max?: number
  context_percent?: number
  compressions?: number
}

export type TranscriptMessage = {
  role: "user" | "assistant" | "system" | "tool"
  text?: string
  name?: string
  context?: string
}

export type CommandsCatalogResponse = {
  categories?: Array<{ name: string; pairs?: [string, string][] }>
  pairs?: [string, string][]
  canon?: Record<string, string>
  sub?: Record<string, string[]>
  skill_count?: number
  warning?: string
}

export type CompletionResponse = {
  items?: { text: string; display: string; meta?: string }[]
  replace_from?: number
}

export type PromptSubmitResponse = {
  ok?: boolean
}

export type SessionInterruptResponse = {
  ok?: boolean
}

export type ConfigSetResponse = {
  value?: string
  info?: SessionInfo
  warning?: string
  history_reset?: boolean
}

export type ModelOptionsResponse = {
  provider?: string
  model?: string
  providers?: {
    slug: string
    name: string
    models?: string[]
    total_models?: number
    is_current?: boolean
    warning?: string
  }[]
}

export type ImageAttachResponse = {
  attached: boolean
  path?: string
  count?: number
  name?: string
  width?: number
  height?: number
  token_estimate?: number
  message?: string
}

export type ShellExecResponse = {
  stdout?: string
  stderr?: string
  code: number
}
