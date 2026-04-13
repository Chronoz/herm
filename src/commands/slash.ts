/**
 * Slash command definitions for the chat input.
 *
 * Commands are either "local" (handled in the TUI) or "gateway"
 * (forwarded as /{name} to the Hermes API).
 */

export type SlashCommand = {
  readonly name: string
  readonly description: string
  readonly category: "session" | "config" | "info" | "local"
  readonly target: "local" | "gateway"
}

/**
 * All available slash commands.
 * Local commands are executed client-side.
 * Gateway commands are sent as /name to the Hermes API.
 */
export const commands: ReadonlyArray<SlashCommand> = [
  // Local (client-side)
  { name: "clear", description: "Clear chat messages", category: "local", target: "local" },
  { name: "new", description: "Start a new session", category: "local", target: "local" },
  { name: "theme", description: "Switch color theme", category: "local", target: "local" },
  { name: "help", description: "Show keyboard shortcuts", category: "local", target: "local" },

  // Session (forwarded to gateway)
  { name: "compact", description: "Compress conversation context", category: "session", target: "gateway" },
  { name: "undo", description: "Remove last exchange", category: "session", target: "gateway" },
  { name: "retry", description: "Retry last message", category: "session", target: "gateway" },
  { name: "branch", description: "Fork the current session", category: "session", target: "gateway" },
  { name: "stop", description: "Stop running processes", category: "session", target: "gateway" },

  // Config (forwarded to gateway)
  { name: "model", description: "Switch model", category: "config", target: "gateway" },
  { name: "yolo", description: "Toggle auto-approve mode", category: "config", target: "gateway" },
  { name: "reasoning", description: "Set reasoning effort level", category: "config", target: "gateway" },
  { name: "fast", description: "Toggle fast/priority mode", category: "config", target: "gateway" },

  // Info (forwarded to gateway)
  { name: "status", description: "Show session info", category: "info", target: "gateway" },
  { name: "usage", description: "Token usage and costs", category: "info", target: "gateway" },
]

/**
 * Filter commands by prefix (the text after /).
 * Empty prefix returns all commands.
 */
export function filter(prefix: string): SlashCommand[] {
  if (!prefix) return [...commands]
  const lower = prefix.toLowerCase()
  return commands.filter(c => c.name.startsWith(lower))
}

/**
 * Category display labels.
 */
export const labels: Record<SlashCommand["category"], string> = {
  local: "Client",
  session: "Session",
  config: "Config",
  info: "Info",
}
