// Slash command catalog + live completion over RPC. Falls back to
// LOCAL_COMMANDS when the gateway catalog is unavailable.

import { useCallback, useEffect, useState } from "react"
import { useGateway, useGatewayReady } from "./gateway"
import {
  LOCAL_COMMANDS,
  sort,
  type SlashCommand,
} from "../commands/slash"
import type { CommandsCatalogResponse } from "../utils/gateway-types"

export function useSlashCommands() {
  const gw = useGateway()
  const ready = useGatewayReady()
  const [cmds, setCmds] = useState<ReadonlyArray<SlashCommand>>(LOCAL_COMMANDS)

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await gw.request<CommandsCatalogResponse>("commands.catalog")
      const remote: SlashCommand[] = (res.pairs ?? []).map(([name, desc]) => ({
        name,
        description: desc,
        category: "Command",
        aliases: [] as string[],
        argsHint: "",
        subcommands: [] as string[],
        source: "command" as const,
        target: "gateway" as const,
      }))

      if (res.categories) {
        const byName = new Map(remote.map(r => [r.name, r]))
        for (const cat of res.categories) {
          for (const c of cat.commands) {
            const entry = byName.get(c.name)
            if (!entry) continue
            const idx = remote.indexOf(entry)
            if (idx >= 0) {
              remote[idx] = {
                ...entry,
                category: cat.name,
                aliases: c.aliases ?? [],
                argsHint: c.args_hint ?? "",
                subcommands: res.sub?.[c.name] ?? [],
              }
            }
          }
        }
      }

      const names = new Set(remote.map(c => c.name))
      const locals = LOCAL_COMMANDS.filter(c => !names.has(c.name))
      setCmds(sort([...locals, ...remote]))
    } catch {
      setCmds(LOCAL_COMMANDS)
    }
  }, [gw])

  useEffect(() => {
    if (ready) fetchCatalog()
  }, [ready, fetchCatalog])

  return { cmds, refresh: fetchCatalog }
}
