import { describe, test, expect, beforeAll } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

const home = process.env.HERMES_HOME!

beforeAll(() => {
  // Seed the sandboxed hermes home with the fixtures we need.
  mkdirSync(home, { recursive: true })

  // SOUL.md
  writeFileSync(join(home, "SOUL.md"), "# Identity\n\nYou are a test agent.")

  // A skill with frontmatter
  const skillDir = join(home, "skills", "testcat", "alpha")
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: alpha\ndescription: A test skill\ntags: [t1, t2]\n---\n\nbody content here",
  )

  // Another skill, no tags
  const skill2 = join(home, "skills", "beta")
  mkdirSync(skill2, { recursive: true })
  writeFileSync(
    join(skill2, "SKILL.md"),
    "---\nname: beta\ndescription: Another\n---\n",
  )

  // config.yaml with a memory provider set
  writeFileSync(
    join(home, "config.yaml"),
    "memory:\n  provider: mem0\n  memory_char_limit: 2200\n  user_char_limit: 1375\n",
  )

  // mem0.json with a redactable secret
  writeFileSync(
    join(home, "mem0.json"),
    JSON.stringify({ api_key: "sk-abcdef12345", user_id: "test", foo: 42 }),
  )
})

describe("hermes-home snapshot additions (herm-krb)", () => {
  test("SoulInfo.content exposes raw SOUL.md body", async () => {
    const { readSoul } = await import("../src/utils/hermes-home")
    const s = await readSoul()
    expect(s).not.toBeNull()
    expect(s!.content).toContain("You are a test agent")
    expect(s!.charCount).toBe(s!.content.length)
    expect(s!.tokenEstimate).toBe(Math.ceil(s!.content.length / 4))
  })

  test("SkillInfo.tokenEstimate computed from index-entry shape", async () => {
    const { listSkills } = await import("../src/utils/hermes-home")
    const sk = await listSkills()
    const alpha = sk.find(s => s.name === "alpha")
    expect(alpha).toBeDefined()
    expect(alpha!.tokenEstimate).toBeGreaterThan(0)
    // Index entry ~= "alpha: A test skill [t1,t2]" → 27 chars → 7 tokens
    const expected = Math.ceil(`${alpha!.name}: ${alpha!.description} [${alpha!.tags.join(",")}]`.length / 4)
    expect(alpha!.tokenEstimate).toBe(expected)

    // Skill without tags should not include the brackets in its estimate
    const beta = sk.find(s => s.name === "beta")
    expect(beta).toBeDefined()
    const betaExpected = Math.ceil(`${beta!.name}: ${beta!.description}`.length / 4)
    expect(beta!.tokenEstimate).toBe(betaExpected)
  })

  test("HermesHomeSnapshot.memoryProviders populated by readHermesHome", async () => {
    const { readHermesHome } = await import("../src/utils/hermes-home")
    const snap = await readHermesHome()
    expect(Array.isArray(snap.memoryProviders)).toBe(true)
    // builtin is always pushed
    expect(snap.memoryProviders.find(p => p.name === "builtin")).toBeDefined()
    // mem0.json exists → mem0 entry present and marked active (config sets provider: mem0)
    const mem0 = snap.memoryProviders.find(p => p.name === "mem0")
    expect(mem0).toBeDefined()
    expect(mem0!.active).toBe(true)
    // api_key redacted
    expect(typeof mem0!.config.api_key).toBe("string")
    expect(mem0!.config.api_key as string).not.toContain("abcdef12345")
    expect(mem0!.config.api_key as string).toContain("sk-a")
  })
})
