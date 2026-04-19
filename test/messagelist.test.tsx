import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until, type Harness } from "./harness"
import { MessageList } from "../src/components/chat/MessageList"
import { isDiff } from "../src/components/chat/DiffBlock"
import type { Message } from "../src/types/message"

const turn: Message[] = [
  {
    id: "u1", role: "user", timestamp: 0,
    parts: [{ type: "text", content: "run the build", streaming: false }],
  },
  {
    id: "a1", role: "assistant", timestamp: 0, model: "test-model",
    usage: { input: 12, output: 34, total: 46 }, duration: 250,
    parts: [
      { type: "text", content: "On it.", streaming: false },
      {
        type: "tool", id: "t1", name: "terminal",
        args: JSON.stringify({ command: "bun run build", workdir: "/tmp" }),
        status: "done", duration: 87,
        result: "line-one\nline-two\nline-three\nline-four\nline-five\nline-six",
      },
    ],
  },
]

async function setup() {
  const t: Harness = await mountNode(
    <box flexDirection="column" width="100%" height="100%">
      <MessageList messages={turn} streaming={false} />
    </box>,
    { width: 100, height: 30 },
  )
  // scrollbox + sticky-bottom needs two settle passes to lay out
  await t.settle()
  await until(t, () => t.frame().includes("▸ you"))
  return t
}

function locate(t: Harness, needle: string) {
  const rows = t.frame().split("\n")
  const y = rows.findIndex(l => l.includes(needle))
  return { x: rows[y].indexOf(needle), y }
}

describe("MessageList", () => {
  test("empty-state shows splash, keybind help, and a tip", async () => {
    const t: Harness = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={[]} streaming={false} />
      </box>,
      { width: 100, height: 30 },
    )
    await until(t, () => t.frame().includes("H E R M"))
    const f = t.frame()
    expect(f).toContain("Type a message below to begin.")
    expect(f).toContain("Prompt history")
    expect(f).toContain("─── tip ───")
    t.destroy()
  })

  test("renders gutter + header + collapsed tool row", async () => {
    const t = await setup()
    const f = t.frame()

    // user prefix + body
    expect(f).toContain("▸ you")
    expect(f).toContain("run the build")

    // assistant gutter bar + header line
    expect(f).toContain("│")
    expect(f).toContain("test-model · 12→34 tok · 250ms")

    // tool row: collapsed glyph, name, summary, duration
    expect(f).toContain("▸ terminal")
    expect(f).toContain("bun run build")
    expect(f).toContain("87ms")

    // collapsed: args KV + result body hidden
    expect(f).not.toContain("workdir")
    expect(f).not.toContain("line-one")
    t.destroy()
  })

  test("clicking tool row expands to show args KV + first 5 result lines", async () => {
    const t = await setup()
    const p = locate(t, "▸ terminal")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▾ terminal"))

    const f = t.frame()
    expect(f).toContain("command")
    expect(f).toContain("workdir")
    expect(f).toContain("line-one")
    expect(f).toContain("line-five")
    expect(f).not.toContain("line-six")  // capped at 5

    // collapse again
    const q = locate(t, "▾ terminal")
    await act(async () => { await t.mouse.pressDown(q.x, q.y) })
    await until(t, () => t.frame().includes("▸ terminal"))
    expect(t.frame()).not.toContain("workdir")
    t.destroy()
  })
})

const UDIFF = [
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old line",
  "+new line",
].join("\n")

describe("diff detection", () => {
  test("isDiff matches unified headers and hunk markers", () => {
    expect(isDiff(UDIFF)).toBe(true)
    expect(isDiff("@@ -1 +1 @@\n-a\n+b")).toBe(true)
    expect(isDiff("diff --git a/x b/x\n@@ -1 +1 @@")).toBe(true)
    expect(isDiff("plain text\nno markers")).toBe(false)
    expect(isDiff("prefix --- a/not-at-line-start")).toBe(false)
    expect(isDiff(undefined)).toBe(false)
  })

  test("tool result that looks like a diff renders as DiffBlock on expand", async () => {
    const msgs: Message[] = [{
      id: "a2", role: "assistant", timestamp: 0,
      parts: [{
        type: "tool", id: "t2", name: "patch", args: "",
        status: "done", duration: 42, result: UDIFF,
      }],
    }]
    const t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={msgs} streaming={false} />
      </box>,
      { width: 100, height: 30 },
    )
    await t.settle()
    await until(t, () => t.frame().includes("▸ patch"))

    // collapsed row shows ± hint
    expect(t.frame()).toContain("±")

    const p = locate(t, "▸ patch")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("@@ -1,3 +1,3 @@"))

    const f = t.frame()
    expect(f).toContain("--- a/foo.ts")
    expect(f).toContain("+new line")
    expect(f).toContain("-old line")
    t.destroy()
  })
})
