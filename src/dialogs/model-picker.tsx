// Pick provider → model. Default scope is the *current session* (the
// gateway applies the switch to the live agent when `session_id` is
// passed); Tab toggles to global persist. The gateway's `config.set`
// accepts a single space-separated arg string with `--provider` /
// `--global` flags (same grammar as the `/model` slash command) and
// routes through `_apply_model_switch`, so we send one request rather
// than a provider/model pair.

import { useEffect, useState, useCallback } from "react"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import { useTheme } from "../theme"
import { useToast } from "../ui/toast"
import type { Gateway } from "../app/gateway"
import type { ConfigSetResponse, ModelOptionsResponse } from "../utils/gateway-types"

type Step = "provider" | "model"

const ModelPickerDialog = ({ gw }: { gw: Gateway }) => {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().theme
  const [data, setData] = useState<ModelOptionsResponse | null>(null)
  const [step, setStep] = useState<Step>("provider")
  const [provider, setProvider] = useState<string | null>(null)
  const [global, setGlobal] = useState(false)

  useEffect(() => {
    gw.request<ModelOptionsResponse>("model.options")
      .then(setData)
      .catch(() => setData({ providers: [] }))
  }, [gw])

  const apply = useCallback((model: string, prov: string) => {
    const value = `${model} --provider ${prov}${global ? " --global" : ""}`
    gw.request<ConfigSetResponse>("config.set", global
      ? { key: "model", value, session_id: undefined }
      : { key: "model", value })
      .then(r => {
        toast.show({ variant: "success", message: `model → ${r.value ?? model}${global ? " (global)" : ""}` })
        if (r.warning) toast.show({ variant: "warning", message: r.warning })
      })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, global, toast])

  const onKey = useCallback((k: { name: string }) => {
    if (k.name === "tab") { setGlobal(g => !g); return true }
    if (k.name === "left" && step === "model") { setStep("provider"); return true }
    return false
  }, [step])

  const footer = (
    <text fg={theme.textMuted}>
      <span>Scope: </span>
      <span fg={global ? theme.warning : theme.accent}>
        {global ? "global (persists to config)" : "this session"}
      </span>
      <span> · Tab: toggle{step === "model" ? " · ←: providers" : ""}</span>
    </text>
  )

  if (!data) return <box width={50} padding={1}><text>Loading models…</text></box>

  if (step === "provider") {
    const options: SelectOption[] = (data.providers ?? []).map(p => ({
      title: p.name,
      value: p.slug,
      description: p.total_models ? `${p.total_models} models` : undefined,
      category: p.is_current ? "Current" : "Available",
    }))
    return (
      <DialogSelect
        title="Switch Provider"
        options={options}
        current={data.provider}
        onSelect={(o) => { setProvider(o.value); setStep("model") }}
        onKey={onKey}
        placeholder="Search providers..."
        footer={footer}
      />
    )
  }

  const p = data.providers?.find(pp => pp.slug === provider)
  const options: SelectOption[] = (p?.models ?? []).map(m => ({
    title: m,
    value: m,
  }))

  return (
    <DialogSelect
      title={`Switch Model (${p?.name ?? provider})`}
      options={options}
      current={data.model}
      onSelect={(o) => {
        if (provider) apply(o.value, provider)
        dialog.clear()
      }}
      onKey={onKey}
      placeholder="Search models..."
      footer={footer}
    />
  )
}

export const openModelPicker = (dialog: ReturnType<typeof useDialog>, gw: Gateway) => {
  dialog.replace(<ModelPickerDialog gw={gw} />)
}
