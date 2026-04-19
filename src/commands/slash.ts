/**
 * Slash command definitions for the chat input.
 *
 * Commands are fetched dynamically from Hermes `GET /api/commands` — the
 * unified registry of built-ins + skills + plugins + MCP prompts. There is
 * no static fallback: if the gateway is unreachable, no slash commands are
 * available (the popover simply won't open).
 *
 * `target` is derived: "local" if the name is a client-handled command,
 * otherwise "gateway" (forwarded as /{name} to the Hermes API).
 */

export type SlashSource = "command" | "skill" | "plugin" | "mcp" | "local"

export type SlashCommand = {
  readonly name: string
  readonly description: string
  readonly category: string
  readonly aliases: ReadonlyArray<string>
  readonly argsHint: string
  readonly subcommands: ReadonlyArray<string>
  readonly source: SlashSource
  readonly target: "local" | "gateway"
  readonly keybind?: string
}

/**
 * Names of purely client-side commands — intercepted before gateway dispatch.
 * These are always treated as local regardless of what the gateway returns.
 */
export const LOCAL_NAMES = new Set(["clear", "new", "theme", "help", "logs", "eikon", "title", "rollback", "save", "history", "status", "usage", "profile"])

/**
 * Descriptions for locally-handled commands. Used to render them in the
 * popover when the gateway registry doesn't include them (or to override
 * the gateway's description for things like /new, which we intercept).
 */
export const LOCAL_COMMANDS: ReadonlyArray<SlashCommand> = [
  { name: "clear", description: "Clear chat messages",       category: "Client", aliases: [],       argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "new",   description: "Start a new session",        category: "Client", aliases: ["reset"], argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "theme", description: "Switch color theme",         category: "Client", aliases: [],       argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "help",  description: "Show keyboard shortcuts",    category: "Client", aliases: [],       argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "logs",  description: "Show gateway stderr log",    category: "Client", aliases: [],       argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "eikon", description: "Pick sidebar avatar",        category: "Client", aliases: [],       argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "title", description: "Set session title",          category: "Client", aliases: [],       argsHint: "[text]", subcommands: [], source: "local", target: "local" },
  { name: "rollback", description: "Browse & restore checkpoints", category: "Client", aliases: [], argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "history",  description: "Server-side transcript viewer", category: "Info",   aliases: [], argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "status",  description: "Version, model, paths",       category: "Info",   aliases: [], argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "usage",   description: "Tokens, context fill, cost",   category: "Info",   aliases: [], argsHint: "", subcommands: [], source: "local", target: "local" },
  { name: "profile", description: "Active profile details",       category: "Info",   aliases: [], argsHint: "", subcommands: [], source: "local", target: "local" },
]

/** Filter commands by prefix (text after `/`). Searches names + aliases. */
export function filter(list: ReadonlyArray<SlashCommand>, prefix: string): SlashCommand[] {
  if (!prefix) return [...list]
  const q = prefix.toLowerCase()
  return list.filter(c =>
    c.name.toLowerCase().startsWith(q) ||
    c.aliases.some(a => a.toLowerCase().startsWith(q))
  )
}

/**
 * If input matches `/cmd <sub>` (with space) and the command has declared
 * subcommands, return synthetic entries for subcommand completion.
 */
export function matchSub(list: ReadonlyArray<SlashCommand>, input: string): SlashCommand[] | null {
  const m = input.match(/^\/(\w+)\s+(\S*)$/)
  if (!m) return null
  const name = m[1]
  const sub = m[2]
  const cmd = list.find(c => c.name === name || c.aliases.includes(name))
  if (!cmd || cmd.subcommands.length === 0) return null
  const q = sub.toLowerCase()
  const matches = cmd.subcommands.filter(s => s.toLowerCase().startsWith(q))
  if (matches.length === 0) return null
  return matches.map(s => ({
    ...cmd,
    name: `${cmd.name} ${s}`,
    description: `${cmd.name} → ${s}`,
    argsHint: "",
    subcommands: [],
  }))
}

/** Category ordering for display. Unknown categories fall to the end. */
export const CATEGORY_ORDER = [
  "Client",
  "Session",
  "Configuration",
  "Config",
  "Tools & Skills",
  "Skills",
  "Plugins",
  "MCP",
  "Info",
  "Exit",
] as const

export function sort(list: ReadonlyArray<SlashCommand>): SlashCommand[] {
  const idx = (c: string) => {
    const i = (CATEGORY_ORDER as readonly string[]).indexOf(c)
    return i < 0 ? 999 : i
  }
  return [...list].sort((a, b) => {
    const ca = idx(a.category) - idx(b.category)
    return ca !== 0 ? ca : a.name.localeCompare(b.name)
  })
}
