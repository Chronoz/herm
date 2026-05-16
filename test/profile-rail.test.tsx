import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode } from "./harness"
import { ProfileRail } from "../src/components/profile/ProfileRail"
import type { ProfileInfo } from "../src/utils/hermes-profiles"

const src = { file: "/tmp/x", relative: "~/x", label: "x" }

const prof = (name: string, active = false): ProfileInfo => ({
  name,
  path: `/tmp/${name}`,
  is_default: name === "default",
  is_active: active,
  is_sticky: false,
  gateway_running: active,
  model: name === "default" ? "gpt-5.5" : "kimi-k2.6",
  provider: name === "default" ? "openai" : "moonshot",
  has_env: false,
  skill_count: 0,
  has_alias: false,
  soul_preview: "",
  sources: { dir: src, config: src, soul: src, env: src },
})

describe("ProfileRail", () => {
  test("renders a compact active card and profile switch list", async () => {
    const seen: string[] = []
    const t = await mountNode(
      <ProfileRail profiles={[prof("default", true), prof("terry"), prof("kat")]} active="default"
                   onSwitch={(_, name) => seen.push(name)} />,
      { width: 48, height: 28 },
    )
    await act(async () => {})

    const f = t.frame()
    expect(f).toContain("default")
    expect(f).toContain("openai")
    expect(f).toContain("gpt-5.5")
    expect(f).toContain("terry")
    expect(f).toContain("kat")
    expect(f).toContain("●")
    expect(f).toContain("moonshot")
    expect(f).toContain("/")

    t.destroy()
  })
})
