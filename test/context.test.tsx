import { describe, test, expect } from "bun:test"
import { mountNode } from "./harness"
import { Context } from "../src/tabs/Context"
import type { SessionInfo } from "../src/utils/gateway-types"

// Strip ANSI so regex matches the visual text, not escape codes.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")

describe("Context tab", () => {
  // Regression: Context used to infinite-loop when mounted without a stable
  // `messages` prop — the `= []` default on every render triggered a
  // messages-dep useEffect → setWire → re-render storm. Now guarded via a
  // module-level frozen NO_MESSAGES reference (herm-cf8).
  test("mounts without infinite-loop when messages prop absent", async () => {
    const t = await mountNode(<Context />)
    expect(t.frame().length).toBeGreaterThan(0)
    t.destroy()
  })

  // herm-sre: info.context_max (from gateway session.usage) overrides the
  // hardcoded CTX table fallback, so contexts on models not in CTX render
  // proportionally correctly.
  test("uses info.context_max for ctxLen", async () => {
    const info: SessionInfo = { model: "gpt-4.1", context_max: 500_000 }
    const t = await mountNode(<Context info={info} />)
    // 500_000 formatted by fmt() → "500k"; surfaces in the status header
    // and the Free-space breakdown row.
    expect(strip(t.frame())).toContain("500k")
    t.destroy()
  })

  test("info.context_max overrides CTX table entry for known model", async () => {
    // gpt-4o in CTX table = 128k; info claims 1M. Gateway must win.
    const info: SessionInfo = { model: "gpt-4o", context_max: 1_000_000 }
    const t = await mountNode(<Context info={info} />)
    const f = strip(t.frame())
    // 1_000_000 formats as "1.0M" via fmt()
    expect(f).toContain("1.0M")
    // Guard: must NOT fall back to the 128k table value
    expect(f).not.toContain("128k")
    t.destroy()
  })

  test("falls back to CTX table when info absent", async () => {
    // No info, no session → DEFAULT_CTX (128k). Verify no crash.
    const t = await mountNode(<Context />)
    expect(strip(t.frame())).toContain("Context")
    t.destroy()
  })
})
