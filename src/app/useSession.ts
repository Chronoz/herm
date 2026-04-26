// Session lifecycle: create, resume, switch, interrupt, branch, compress, undo.

import { useMemo, useCallback } from "react"
import * as preferences from "../utils/preferences"
import { useGateway } from "./gateway"
import { transcriptToMessages } from "./turnReducer"
import type { SessionResumeResponse, SessionCreateResponse } from "../utils/gateway-types"
import type { Message } from "../types/message"

export type SessionOps = {
  /** Resume last session from prefs, or create a new one. */
  boot: () => Promise<{ id: string; messages: Message[] }>
  create: () => Promise<string>
  resume: (sid: string) => Promise<{ id: string; messages: Message[] }>
  interrupt: () => Promise<void>
  branch: (name?: string) => Promise<string | null>
  compress: () => Promise<void>
  undo: () => Promise<void>
}

export function useSession(): SessionOps {
  const gw = useGateway()

  const resume = useCallback(async (sid: string) => {
    const res = await gw.request<SessionResumeResponse>("session.resume", { session_id: sid })
    const id = res.session_id
    gw.setSession(id)
    preferences.set("lastSessionId", res.resumed ?? sid)
    const messages = res.messages?.length ? transcriptToMessages(res.messages) : []
    return { id, messages }
  }, [gw])

  const create = useCallback(async () => {
    const res = await gw.request<SessionCreateResponse>("session.create", {})
    gw.setSession(res.session_id)
    return res.session_id
  }, [gw])

  const boot = useCallback(async () => {
    const last = preferences.get("resumeOnLaunch") !== false
      ? preferences.get("lastSessionId") : undefined
    if (last) {
      try { return await resume(last) } catch { /* fall through */ }
    }
    return { id: await create(), messages: [] }
  }, [create, resume])

  const interrupt = useCallback(async () => {
    try { await gw.request("session.interrupt") } catch {}
  }, [gw])

  const branch = useCallback(async (name?: string) => {
    try {
      const res = await gw.request<{ session_id?: string }>("session.branch", name ? { name } : {})
      return res.session_id ?? null
    } catch { return null }
  }, [gw])

  const compress = useCallback(async () => {
    try { await gw.request("session.compress") } catch {}
  }, [gw])

  const undo = useCallback(async () => {
    try { await gw.request("session.undo") } catch {}
  }, [gw])

  return useMemo(
    () => ({ boot, create, resume, interrupt, branch, compress, undo }),
    [boot, create, resume, interrupt, branch, compress, undo],
  )
}
