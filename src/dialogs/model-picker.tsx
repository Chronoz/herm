// Pick provider then model, persisting both via config.set.

import { useEffect, useState, useCallback } from "react"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import type { GatewayClient } from "../utils/gateway-client"
import type { ModelOptionsResponse } from "../utils/gateway-types"

type Step = "provider" | "model"

const ModelPickerDialog = ({ gw }: { gw: GatewayClient }) => {
  const dialog = useDialog()
  const [data, setData] = useState<ModelOptionsResponse | null>(null)
  const [step, setStep] = useState<Step>("provider")
  const [provider, setProvider] = useState<string | null>(null)

  useEffect(() => {
    gw.request<ModelOptionsResponse>("model.options")
      .then(setData)
      .catch(() => setData({ providers: [] }))
  }, [gw])

  const set = useCallback((key: string, value: string) => {
    gw.request("config.set", { key, value }).catch(() => {})
  }, [gw])

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
        placeholder="Search providers..."
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
        if (provider) set("provider", provider)
        set("model", o.value)
        dialog.clear()
      }}
      placeholder="Search models..."
    />
  )
}

export const openModelPicker = (dialog: ReturnType<typeof useDialog>, gw: GatewayClient) => {
  dialog.replace(<ModelPickerDialog gw={gw} />)
}
