/**
 * Fetches slash commands from the Hermes gateway `/api/commands` endpoint.
 *
 * Returns the unified registry: built-in commands, skills, plugins, and MCP
 * prompts. Local-only commands (clear, new, theme, help) are prepended
 * client-side since the gateway either doesn't know about them or we want
 * to override their dispatch target.
 *
 * If the fetch fails, returns an empty list. No hard-coded fallback.
 */

import type { SlashCommand, SlashSource } from "./slash"
import { LOCAL_NAMES, LOCAL_COMMANDS, sort } from "./slash"

type ApiRow = {
  name: string
  description: string
  category: string
  aliases?: string[]
  args_hint?: string
  subcommands?: string[]
  source: "command" | "skill" | "plugin" | "mcp"
  cli_only?: boolean
  gateway_only?: boolean
}

/**
 * Fetch commands from the gateway. Merges local-only entries on top.
 * Returns an empty list on error.
 *
 * @param base  e.g. "http://localhost:8642/v1" or "http://localhost:8642"
 * @param key   optional bearer token
 * @param signal optional AbortSignal
 */
export async function fetch_commands(
  base: string,
  key?: string,
  signal?: AbortSignal,
): Promise<SlashCommand[]> {
  const root = base.replace(/\/v1\/?$/, "")
  const headers: HeadersInit = {}
  if (key) headers["Authorization"] = `Bearer ${key}`

  const res = await fetch(`${root}/api/commands`, { headers, signal }).catch(() => null)
  if (!res || !res.ok) return []

  const body = await res.json().catch(() => null) as { commands: ApiRow[] } | null
  if (!body?.commands) return []

  const remote: SlashCommand[] = body.commands.map(r => ({
    name: r.name,
    description: LOCAL_NAMES.has(r.name)
      ? (LOCAL_COMMANDS.find(l => l.name === r.name)?.description ?? r.description)
      : r.description,
    category: LOCAL_NAMES.has(r.name) ? "Client" : (r.category || "Info"),
    aliases: r.aliases ?? [],
    argsHint: r.args_hint ?? "",
    subcommands: r.subcommands ?? [],
    source: LOCAL_NAMES.has(r.name) ? "local" : (r.source as SlashSource),
    target: LOCAL_NAMES.has(r.name) ? "local" : "gateway",
  }))

  // Prepend any local-only commands not already in the gateway registry.
  const names = new Set(remote.map(c => c.name))
  const locals = LOCAL_COMMANDS.filter(c => !names.has(c.name))
  return sort([...locals, ...remote])
}
