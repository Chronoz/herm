// Interactive prompt dialogs: approval, clarify, sudo, secret.
//
// Every prompt guarantees a response is sent back to the gateway exactly
// once, regardless of how the dialog is dismissed (Enter, Escape, click-
// outside, or another dialog replacing it). The unmount cleanup sends the
// cancel/deny response if the user didn't answer explicitly.

import { useState, useRef, useEffect } from "react"
import type { SubmitEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { useDialog } from "./dialog"
import { useGateway } from "../app/gateway"

// ── Shared ───────────────────────────────────────────────────────────

function digit(name: string): number | null {
  const n = parseInt(name, 10)
  return Number.isFinite(n) ? n : null
}

/** Send `fn()` exactly once; on unmount send `cancel()` if never fired. */
function useRespondOnce(cancel: () => void) {
  const done = useRef(false)
  const ref = useRef(cancel)
  ref.current = cancel
  useEffect(() => () => { if (!done.current) ref.current() }, [])
  return (fn: () => void) => {
    if (done.current) return
    done.current = true
    fn()
  }
}

// ── Approval ─────────────────────────────────────────────────────────
//
// oc permission.tsx grammar: ┃-bar panel (warning-tinted), a
// "△ Permission required" head, indented title row, command body,
// and a horizontal pill footer navigated with ←/→. hermes' approval
// event is always a shell command, so this is oc's `bash` case only.

const CHOICES = ["once", "session", "always", "deny"] as const
type Choice = typeof CHOICES[number]
const LABELS: Record<Choice, string> = {
  once: "Allow once",
  session: "Allow this session",
  always: "Always allow",
  deny: "Deny",
}

const Pill = (p: { on: boolean; hot: string; label: string; onPick: () => void }) => {
  const theme = useTheme().theme
  return (
    <box
      height={1}
      paddingX={1}
      backgroundColor={p.on ? theme.primary : undefined}
      onMouseDown={p.onPick}
    >
      <text>
        <span fg={p.on ? theme.background : theme.textMuted}>{p.hot} </span>
        <span fg={p.on ? theme.background : theme.text}>{p.label}</span>
      </text>
    </box>
  )
}

export type ApprovalReq = { command: string; description: string }

export const ApprovalPrompt = ({ req }: { req: ApprovalReq }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const gw = useGateway()
  const [sel, setSel] = useState(0)

  const send = (choice: Choice) =>
    void gw.request("approval.respond", { choice }).catch(() => {})

  const once = useRespondOnce(() => send("deny"))
  const answer = (c: Choice) => { once(() => send(c)); dialog.clear() }

  useKeyboard((key) => {
    if (key.name === "left" || key.name === "h")
      return setSel(s => (s + CHOICES.length - 1) % CHOICES.length)
    if (key.name === "right" || key.name === "l")
      return setSel(s => (s + 1) % CHOICES.length)
    if (key.name === "return") return answer(CHOICES[sel])
    if (key.name === "escape") return answer("deny")
    const n = digit(key.name)
    if (n !== null && n >= 1 && n <= CHOICES.length) answer(CHOICES[n - 1])
  })

  return (
    <box
      flexDirection="column"
      width={84}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={{
        topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
        horizontal: "", vertical: "┃", topT: "", bottomT: "", leftT: "", rightT: "", cross: "",
      }}
      backgroundColor={theme.backgroundPanel}
    >
      <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={2} paddingY={1}>
        <box flexDirection="row" gap={1} height={1}>
          <text fg={theme.warning}>△</text>
          <text fg={theme.text}>Permission required</text>
        </box>
        <box flexDirection="row" gap={1} paddingLeft={2} minHeight={1}>
          <text fg={theme.textMuted}>#</text>
          <text fg={theme.text} wrapMode="word">{req.description || "Shell command"}</text>
        </box>
        <box paddingLeft={2} minHeight={1}>
          <text fg={theme.text} wrapMode="word">$ {req.command}</text>
        </box>
      </box>
      <box
        flexDirection="row"
        gap={2}
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        paddingY={1}
        backgroundColor={theme.backgroundElement}
      >
        {CHOICES.map((c, i) => (
          <Pill key={c} on={sel === i} hot={String(i + 1)} label={LABELS[c]}
                onPick={() => answer(c)} />
        ))}
        <box flexGrow={1} />
        <box height={1}>
          <text fg={theme.textMuted}>←/→ · enter · esc deny</text>
        </box>
      </box>
    </box>
  )
}

// ── Clarify ──────────────────────────────────────────────────────────

export type ClarifyReq = { request_id: string; question: string; choices: string[] | null }

export const ClarifyPrompt = ({ req }: { req: ClarifyReq }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const gw = useGateway()
  const choices = req.choices ?? []
  const [sel, setSel] = useState(0)
  const [custom, setCustom] = useState("")
  const [typing, setTyping] = useState(choices.length === 0)

  const send = (answer: string) =>
    void gw.request("clarify.respond", { request_id: req.request_id, answer }).catch(() => {})

  const once = useRespondOnce(() => send(""))
  const answer = (v: string) => { once(() => send(v)); dialog.clear() }

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (typing && choices.length) { setTyping(false); key.stopPropagation(); return }
      return answer("")
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
    const n = digit(key.name)
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
            onInput={setCustom}
            onSubmit={answer as unknown as (e: SubmitEvent) => void}
            focused
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
      <text fg={theme.textMuted}>↑/↓ select · Enter confirm · 1-{choices.length} quick · Esc cancel</text>
    </box>
  )
}

// ── Masked (sudo / secret) ───────────────────────────────────────────
//
// The <input> owns focus and editing; its text is painted in the background
// color so the raw value never renders. A bullet overlay sits on top.

const Masked = (props: {
  title: string
  note: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const [value, setValue] = useState("")

  const once = useRespondOnce(props.onCancel)
  const submit = (v: string) => { once(() => props.onSubmit(v)); dialog.clear() }

  useKeyboard((key) => {
    if (key.name === "escape") { once(props.onCancel); dialog.clear() }
  })

  return (
    <box flexDirection="column" width={60}>
      <text fg={theme.warning}><strong>{props.title}</strong></text>
      <text fg={theme.text}>{props.note}</text>
      <box height={1} />
      <box flexDirection="row" height={1} position="relative">
        <text fg={theme.textMuted}>{"> "}</text>
        <input
          value={value}
          onInput={setValue}
          onSubmit={submit as unknown as (e: SubmitEvent) => void}
          focused
          flexGrow={1}
          textColor={theme.backgroundElement}
          cursorColor={theme.accent}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
        />
        <box position="absolute" left={2} top={0} height={1}>
          <text fg={theme.text} bg={theme.backgroundElement}>{"•".repeat(value.length)}</text>
        </box>
      </box>
      <text fg={theme.textMuted}>Enter submit · Esc cancel</text>
    </box>
  )
}

export const SudoPrompt = ({ req }: { req: { request_id: string } }) => {
  const gw = useGateway()
  const send = (password: string) =>
    void gw.request("sudo.respond", { request_id: req.request_id, password }).catch(() => {})
  return (
    <Masked
      title="🔒 Sudo required"
      note="Enter your password to elevate privileges."
      onSubmit={send}
      onCancel={() => send("")}
    />
  )
}

export const SecretPrompt = ({ req }: { req: { request_id: string; prompt: string; env_var: string } }) => {
  const gw = useGateway()
  const send = (value: string) =>
    void gw.request("secret.respond", { request_id: req.request_id, value }).catch(() => {})
  return (
    <Masked
      title={`🔑 Secret: ${req.env_var}`}
      note={req.prompt}
      onSubmit={send}
      onCancel={() => send("")}
    />
  )
}
