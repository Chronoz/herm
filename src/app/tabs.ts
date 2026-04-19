export const TABS = [
  { name: "Overview",  description: "Dashboard" },
  { name: "Chat",      description: "Main chat interface" },
  { name: "Context",   description: "Context and session info" },
  { name: "Sessions",  description: "Session history" },
  { name: "Analytics", description: "Token usage and costs" },
  { name: "Skills",    description: "Installed skills browser" },
  { name: "Cron",      description: "Scheduled job manager" },
  { name: "Toolsets",  description: "Available toolsets manager" },
  { name: "Config",    description: "Configuration editor" },
  { name: "Env",       description: "API keys & env variables" },
  { name: "Memory",    description: "Agent memory browser" },
] as const

export const TAB_MAX = TABS.length - 1
