// Interactive prompt dialogs: approval, clarify, sudo, secret.

import { useState, useCallback } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { useDialog } from "./dialog"
import { useGateway } from "../app/gateway"

// ── Shared helpers ───────────────────────────────────────────────────

function digit(key: { name: string }): number | null {
  const n = parseInt(key.name, 10)
  return Number.isFinite(n) ? n : null
}

// ── Approval ─────────────────────────────────────────────────────────

const APPROVAL_OPTS = ["once", "session", "always", "deny"] as const
type ApprovalChoice = typeof APPROVAL_OPTS[number]
const APPROVAL_LABELS: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow this session",
  always: "Always allow",
  deny: "Deny",
}

export type ApprovalReq = { command: string; description: string }

export const ApprovalPrompt = ({ req }: { req: ApprovalReq }) => {
  const [sel, setSel] = useState(0)
  const { theme } = useTheme()
  const dialog = useDialog()
  const gw = useGateway()

  const answer = useCallback((choice: ApprovalChoice) => {
    gw.request("approval.respond", { choice }).catch(() => {})
    dialog.clear()
  }, [gw, dialog])

  useKeyboard((key) => {
    if (key.name === "up") return setSel(s => Math.max(0, s - 1))
    if (key.name === "down") return setSel(s => Math.min(APPROVAL_OPTS.length - 1, s + 1))
    const n = digit(key)
    if (n !== null && n >= 1 && n <= APPROVAL_OPTS.length) return answer(APPROVAL_OPTS[n - 1])
    if (key.name === "return") return answer(APPROVAL_OPTS[sel])
  })

  return (
    <box flexDirection="column" width={70}>
      <text fg={theme.warning}><strong>⚠ Approval required — {req.description}</strong></text>
      <text fg={theme.text}> {req.command}</text>
      <box height={1} />
      {APPROVAL_OPTS.map((o, i) => (
        <text key={o} fg={sel === i ? theme.text : theme.textMuted}>
          {sel === i ? "▸ " : "  "}{i + 1}. {APPROVAL_LABELS[o]}
        </text>
      ))}
      <box height={1} />
      <text fg={theme.textMuted}>↑/↓ select · Enter confirm · 1-4 quick pick · Esc deny</text>
    </box>
  )
}

// ── Clarify ──────────────────────────────────────────────────────────

export type ClarifyReq = { request_id: string; question: string; choices: string[] | null }

export const ClarifyPrompt = ({ req }: { req: ClarifyReq }) => {
  const { theme } = useTheme()
  const dialog = useDialog()
  const gw = useGateway()
  const choices = req.choices ?? []
  const [sel, setSel] = useState(0)
  const [custom, setCustom] = useState("")
  const [typing, setTyping] = useState(choices.length === 0)

  const answer = useCallback((answer: string) => {
    gw.request("clarify.respond", { request_id: req.request_id, answer }).catch(() => {})
    dialog.clear()
  }, [gw, dialog, req.request_id])

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (typing && choices.length) { setTyping(false); return }
      dialog.clear()
      return
    }
    if (typing) return
    if (key.name === "up") return setSel(s => Math.max(0, s - 1))
    if (key.name === "down") return setSel(s => Math.min(choices.length, s + 1))
    if (key.name === "return") {
      if (sel === choices.length) return setTyping(true)
      const c = choices[sel]
      if (c) answer(c)
      return
    }
    const n = digit(key)
    if (n !== null && n >= 1 && n <= choices.length) answer(choices[n - 1])
  })

  const head = (
    <text><strong><span fg={theme.accent}>ask</span> <span fg={theme.text}>{req.question}</span></strong></text>
  )

  if (typing) {
    return (
      <box flexDirection="column" width={70}>
        {head}
        <box flexDirection="row">
          <text fg={theme.textMuted}>{"> "}</text>
          <input
            value={custom}
            onChange={setCustom}
            onSubmit={answer as any}
            focused={true}
            textColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
        </box>
        <text fg={theme.textMuted}>Enter send · Esc {choices.length ? "back" : "cancel"}</text>
      </box>
    )
  }

  return (
    <box flexDirection="column" width={70}>
      {head}
      {[...choices, "Other (type your answer)"].map((c, i) => (
        <text key={i} fg={sel === i ? theme.text : theme.textMuted}>
          {sel === i ? "▸ " : "  "}{i + 1}. {c}
        </text>
      ))}
      <box height={1} />
      <text fg={theme.textMuted}>↑/↓ select · Enter confirm · 1-{choices.length} quick pick · Esc cancel</text>
    </box>
  )
}

// ── Masked prompt (sudo / secret) ────────────────────────────────────

type MaskedProps = {
  title: string
  description: string
  onSubmit: (value: string) => void
}

const MaskedPrompt = ({ title, description, onSubmit }: MaskedProps) => {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [value, setValue] = useState("")

  const submit = useCallback((v: string) => {
    onSubmit(v)
    dialog.clear()
  }, [onSubmit, dialog])

  useKeyboard((key) => {
    if (key.name === "escape") dialog.clear()
  })

  const mask = "*".repeat(value.length)

  return (
    <box flexDirection="column" width={60}>
      <text fg={theme.warning}><strong>{title}</strong></text>
      <text fg={theme.text}>{description}</text>
      <box height={1} />
      <box flexDirection="row">
        <text fg={theme.textMuted}>{"> "}</text>
        <input
          value={value}
          onChange={setValue}
          onSubmit={submit as any}
          focused={true}
          textColor={theme.text}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
          placeholder={mask}
        />
      </box>
      <text fg={theme.textMuted}>Enter submit · Esc cancel</text>
    </box>
  )
}

export const SudoPrompt = ({ req }: { req: { request_id: string } }) => {
  const gw = useGateway()
  return (
    <MaskedPrompt
      title="🔒 Sudo required"
      description="Enter your password to elevate privileges."
      onSubmit={(password) =>
        void gw.request("sudo.respond", { request_id: req.request_id, password }).catch(() => {})
      }
    />
  )
}

export const SecretPrompt = ({ req }: { req: { request_id: string; prompt: string; env_var: string } }) => {
  const gw = useGateway()
  return (
    <MaskedPrompt
      title={`🔑 Secret: ${req.env_var}`}
      description={req.prompt}
      onSubmit={(value) =>
        void gw.request("secret.respond", { request_id: req.request_id, value }).catch(() => {})
      }
    />
  )
}
