// Singleton GatewayClient exposed via React context.

import { createContext, useContext, useEffect, useRef, useState, useMemo } from "react"
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
      if (ev.type === "gateway.ready" || ev.type === "session.info") setReady(true)
    }
    c.on("event", onEvent)
    c.start()
    return () => {
      c.off("event", onEvent)
      c.removeAllListeners()
      c.kill()
    }
  }, [])

  const value = useMemo<Ctx>(() => ({ client: ref.current!, ready }), [ready])
  return <Gw.Provider value={value}>{children}</Gw.Provider>
}

export function useGateway(): GatewayClient {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGateway() must be inside <GatewayProvider>")
  return ctx.client
}

/**
 * Subscribe to all gateway events. The first subscription drains any
 * events buffered before React mounted, so nothing is lost between
 * `client.start()` and component wiring.
 */
export function useGatewayEvent(handler: (ev: GatewayEvent) => void): void {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGatewayEvent() must be inside <GatewayProvider>")
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const c = ctx.client
    const fn = (ev: GatewayEvent) => ref.current(ev)
    c.on("event", fn)
    c.drain()
    return () => { c.off("event", fn) }
  }, [ctx.client])
}

/** True once gateway.ready or session.info has fired. */
export function useGatewayReady(): boolean {
  const ctx = useContext(Gw)
  if (!ctx) throw new Error("useGatewayReady() must be inside <GatewayProvider>")
  return ctx.ready
}
