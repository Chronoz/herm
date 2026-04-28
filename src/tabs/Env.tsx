import { useState, useCallback, memo } from "react"
import { useKeyboard } from "@opentui/react"
import { useKeys, handleListKey } from "../keys"
import { writeEnvVar, removeEnvVar, ENV_CATALOG } from "../utils/hermes-home"
import { useHome, home } from "../home"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { openTextPrompt } from "../dialogs/text-prompt"
import { openConfirm } from "../dialogs/confirm"

// ─── Types ────────────────────────────────────────────────────────

type Row =
  | { type: "header"; category: string; collapsed: boolean }
  | { type: "var"; key: string; value: string | undefined }

const mask = (val: string) => "•".repeat(Math.min(val.length, 12))

// ─── Var Row ──────────────────────────────────────────────────────

const VarRow = memo((props: {
  name: string
  value: string | undefined
  shown: boolean
  selected: boolean
  onSelect: () => void
}) => {
  const theme = useTheme().theme
  const set = props.value !== undefined
  const bg = props.selected ? theme.backgroundElement : undefined
  return (
    <box backgroundColor={bg} onMouseDown={props.onSelect} onMouseOver={props.onSelect}>
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>
          {props.selected ? "▸ " : "  "}
        </span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {props.name.padEnd(28)}
        </span>
        <span fg={set ? theme.success : theme.textMuted}>
          {(set ? " SET " : "UNSET").padEnd(8)}
        </span>
        <span fg={props.shown ? theme.text : theme.textMuted}>
          {set ? (props.shown ? props.value! : mask(props.value!)) : "—"}
        </span>
      </text>
    </box>
  )
})

// ─── Main Component ───────────────────────────────────────────────

export const Env = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const toast = useToast()

  const vars = useHome("env") ?? {}
  const [sel, setSel] = useState(0)
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")

  // Catalog keys plus any extras present in .env that aren't catalogued.
  const known = new Set(ENV_CATALOG.flatMap(g => g.keys))
  const extra = Object.keys(vars).filter(k => !known.has(k)).sort()
  const groups = extra.length > 0
    ? [...ENV_CATALOG, { category: "Other", keys: extra }]
    : ENV_CATALOG

  const rows: Row[] = groups.flatMap((g) => {
    const keys = searching && query.trim()
      ? g.keys.filter(k => k.toLowerCase().includes(query.toLowerCase()))
      : g.keys
    if (keys.length === 0) return []
    const hide = collapsed[g.category] ?? false
    const header: Row = { type: "header", category: g.category, collapsed: hide }
    if (hide) return [header]
    return [header, ...keys.map((key): Row => ({ type: "var", key, value: vars[key] }))]
  })

  const count = rows.length
  const cur = rows[sel]
  const setKeys = rows.flatMap(r => r.type === "var" && r.value !== undefined ? [r.key] : [])

  const edit = useCallback(async (key: string, initial: string) => {
    const val = await openTextPrompt(dialog, { title: `Edit ${key}`, label: "Value", initial })
    if (val == null) return
    await writeEnvVar(key, val)
    home.invalidate("env")
    toast.show({ variant: "success", message: `${key} saved` })
  }, [dialog, toast])

  const add = useCallback(async () => {
    const key = await openTextPrompt(dialog, { title: "New Variable", label: "Name (e.g. FOO_API_KEY)" })
    if (!key) return
    const val = await openTextPrompt(dialog, { title: `Set ${key}`, label: "Value" })
    if (val == null) return
    await writeEnvVar(key, val)
    home.invalidate("env")
    toast.show({ variant: "success", message: `${key} added` })
  }, [dialog, toast])

  const del = useCallback(async (key: string) => {
    const ok = await openConfirm(dialog, {
      title: "Delete Variable",
      body: `Remove ${key} from .env?`,
      yes: "delete", danger: true,
    })
    if (!ok) return
    await removeEnvVar(key)
    home.invalidate("env")
    toast.show({ variant: "success", message: `${key} removed` })
  }, [dialog, toast])

  const revealAll = useCallback(() =>
    setReveal(s => s.size === setKeys.length && setKeys.length > 0
      ? new Set()
      : new Set(setKeys)), [setKeys])

  const activate = useCallback(() => {
    if (cur?.type === "header")
      return setCollapsed(p => ({ ...p, [cur.category]: !p[cur.category] }))
    if (cur?.type === "var") {
      if (cur.value !== undefined && !reveal.has(cur.key))
        return setReveal(s => new Set(s).add(cur.key))
      return void edit(cur.key, cur.value ?? "")
    }
  }, [cur, reveal, edit])

  const keys = useKeys()
  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return

    if (searching) {
      if (key.name === "escape") { setSearching(false); setQuery(""); setSel(0); return }
      if (key.name === "backspace") { setQuery(q => q.slice(0, -1)); setSel(0); return }
      if (key.name === "up") return setSel(p => Math.max(0, p - 1))
      if (key.name === "down") return setSel(p => Math.min(count - 1, p + 1))
      if (key.name === "return") { setSearching(false); return activate() }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery(q => q + key.raw); setSel(0); return
      }
      return
    }

    handleListKey(keys, key, {
      count, setSel,
      onActivate: activate,
      onToggle: revealAll,
      onNew: add,
      onDelete: () => { if (cur?.type === "var" && cur.value !== undefined) del(cur.key) },
      onSearch: () => { setSearching(true); setQuery(""); setSel(0) },
      onRefresh: () => home.invalidate("env"),
    })
  })

  return (
    <TabShell
      title={searching ? "Env (searching)" : "Env / API Keys"}
      hint={searching
        ? "↑↓ move  Enter reveal/edit  Esc cancel"
        : `↑↓ move  ${keys.print("list.activate")} reveal/edit  ${keys.print("list.toggle")} show-all  ${keys.print("list.new")} new  ${keys.print("list.delete")} delete  ${keys.print("list.search")} search  ${keys.print("list.refresh")} reload`}
    >
      {searching ? (
        <box height={1}>
          <text>
            <span fg={theme.accent}>/ </span>
            <span fg={theme.text}>{query}</span>
            <span fg={theme.accent}>█</span>
          </text>
        </box>
      ) : null}

      <box height={1}>
        <text fg={theme.textMuted}>
          {"  "}{"Name".padEnd(28)}{"Status".padEnd(8)}Value
        </text>
      </box>
      <box height={1}>
        <text fg={theme.borderSubtle}>
          {"  "}{"─".repeat(26)}{"  "}{"─".repeat(6)}{"  "}{"─".repeat(30)}
        </text>
      </box>

      {count === 0 ? (
        <box key="empty" flexGrow={1} padding={2}>
          <text fg={theme.textMuted}>
            {searching ? "No matching variables" : "No variables configured"}
          </text>
        </box>
      ) : (
        <scrollbox key="list" scrollY flexGrow={1}>
          <box flexDirection="column" width="100%">
            {rows.map((row, i) => row.type === "header" ? (
              <box
                key={`h-${row.category}`}
                marginTop={i > 0 ? 1 : 0}
                backgroundColor={i === sel ? theme.backgroundElement : undefined}
                onMouseDown={() => setSel(i)}
              >
                <text fg={theme.info}>
                  <strong>{`${row.collapsed ? "▸" : "▾"} ${row.category}`}</strong>
                </text>
              </box>
            ) : (
              <VarRow
                key={row.key}
                name={row.key}
                value={row.value}
                shown={reveal.has(row.key)}
                selected={i === sel}
                onSelect={() => setSel(i)}
              />
            ))}
          </box>
        </scrollbox>
      )}
    </TabShell>
  )
})
