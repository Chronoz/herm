// Singleton GatewayClient exposed via React context.

import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { GatewayClient } from "../utils/gateway-client"
import type { GatewayEvent } from "../utils/gateway-types"

type Ctx = {
  client: GatewayClient
  ready: boolean
}

const Gw = createContext<Ctx | null>(null)

export const GatewayProvider = ({ children }: { children: ReactNode }) => {
  const ref = useRef<GatewayClient | null>(null)
  if (!ref.current) ref.current = new GatewayClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const c = ref.current!
    const onEvent = (ev: GatewayEvent) => {
      if (ev.type === "gateway.ready") setReady(true)
      if (ev.type === "session.info") setReady(true)
    }
    c.on("event", onEvent)
    c.start()
    c.drain()
    return () => {
      c.off("event", onEvent)
      c.removeAllListeners()
      c.kill()
    }
  }, [])

  return <Gw.Provider value={{ client: ref.current, ready }}>{children}</Gw.Provider>
}

export function useGateway(): GatewayClient {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGateway() must be inside <GatewayProvider>")
  return ctx.client
}

/** Subscribe to all gateway events. Handler is re-bound on change. */
export function useGatewayEvent(handler: (ev: GatewayEvent) => void): void {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGatewayEvent() must be inside <GatewayProvider>")
  useEffect(() => {
    ctx.client.on("event", handler)
    return () => { ctx.client.off("event", handler) }
  }, [ctx.client, handler])
}

/** True once gateway.ready or session.info has fired. */
export function useGatewayReady(): boolean {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGatewayReady() must be inside <GatewayProvider>")
  return ctx.ready
}
