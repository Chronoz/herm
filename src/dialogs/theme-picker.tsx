/**
 * Theme picker dialog — live preview with DialogSelect.
 */

import { useRef, useCallback } from "react"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import type { SelectOption } from "../ui/dialog-select"

export const ThemePickerDialog = ({ onConfirm }: { onConfirm: () => void }) => {
  const ctx = useTheme()
  const dialog = useDialog()

  const options: SelectOption[] = ctx.names.map(n => ({
    title: n,
    value: n,
  }))

  const onMove = useCallback((opt: SelectOption) => {
    ctx.set(opt.value)
  }, [ctx])

  const onSelect = useCallback((opt: SelectOption) => {
    ctx.set(opt.value)
    onConfirm()
    dialog.clear()
  }, [ctx, dialog, onConfirm])

  return (
    <DialogSelect
      title="Switch Theme"
      options={options}
      current={ctx.name}
      onSelect={onSelect}
      onMove={onMove}
      placeholder="Search themes..."
    />
  )
}

/** Open the theme picker, reverting on close without selection */
export const openThemePicker = (dialog: ReturnType<typeof useDialog>, ctx: ReturnType<typeof useTheme>) => {
  const saved = ctx.name
  let confirmed = false
  dialog.replace(
    <ThemePickerDialog onConfirm={() => { confirmed = true }} />,
    () => { if (!confirmed) ctx.set(saved) }
  )
}
