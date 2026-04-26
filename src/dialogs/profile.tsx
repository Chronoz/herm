// Per-profile action menu. All mutations route through the hermes CLI
// via `shell.exec` so herm doesn't duplicate validation/cleanup logic.
// "Open …" actions use the OS handler (openFile) rather than an
// in-TUI editor — SOUL.md and config.yaml are multi-hundred-line
// files, not composer-sized inputs.

import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import type { DialogContext } from "../ui/dialog"
import type { ProfileInfo } from "../utils/hermes-profiles"
import { openFile } from "../utils/open-file"

export type ProfileOps = {
  sticky: (p: ProfileInfo) => void
  unsticky: () => void
  export: (p: ProfileInfo) => void
  remove: (p: ProfileInfo) => void
}

export function openProfileMenu(dialog: DialogContext, p: ProfileInfo, ops: ProfileOps) {
  const opts: SelectOption[] = [
    { category: "Open", value: "soul", title: "SOUL.md", description: "edit persona/system prompt" },
    { category: "Open", value: "config", title: "config.yaml", description: "model, provider, toolsets" },
    ...(p.has_env
      ? [{ category: "Open", value: "env", title: ".env", description: "API keys + secrets" }] : []),
    { category: "Open", value: "dir", title: "Directory", description: p.path },
    ...(p.is_sticky
      ? [{ category: "Default", value: "unsticky", title: "Clear sticky default",
           description: "hermes profile use --clear" }]
      : [{ category: "Default", value: "sticky", title: "Set as sticky default",
           description: `hermes profile use ${p.name}` }]),
    { category: "Manage", value: "export", title: "Export",
      description: `hermes profile export ${p.name}` },
    ...(p.is_default || p.is_active ? []
      : [{ category: "Manage", value: "delete", title: "Delete",
           description: "irreversible — removes config, env, memory, sessions" }]),
  ]

  dialog.replace(
    <DialogSelect
      title={`Profile · ${p.name}${p.is_active ? " (active)" : ""}`}
      options={opts}
      onSelect={(o) => {
        dialog.clear()
        if (o.value === "soul") return openFile(p.sources.soul.file)
        if (o.value === "config") return openFile(p.sources.config.file)
        if (o.value === "env") return openFile(p.sources.env.file)
        if (o.value === "dir") return openFile(p.path)
        if (o.value === "sticky") return ops.sticky(p)
        if (o.value === "unsticky") return ops.unsticky()
        if (o.value === "export") return ops.export(p)
        if (o.value === "delete") return ops.remove(p)
      }}
    />,
  )
}
