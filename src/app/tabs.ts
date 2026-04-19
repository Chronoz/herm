export const TABS = [
  { name: "Chat",      description: "Main chat interface" },
  { name: "Context",   description: "Context and session info" },
  { name: "Sessions",  description: "Session history" },
  { name: "Agents",    description: "Profiles and running subagents" },
  { name: "Analytics", description: "Token usage and costs" },
  { name: "Skills",    description: "Installed skills browser" },
  { name: "Cron",      description: "Scheduled job manager" },
  { name: "Toolsets",  description: "Available toolsets manager" },
  { name: "Config",    description: "Configuration editor" },
  { name: "Env",       description: "API keys & env variables" },
  { name: "Memory",    description: "Agent memory browser" },
] as const

export const TAB_MAX = TABS.length - 1
export const CHAT_TAB = 0
