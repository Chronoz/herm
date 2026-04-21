import { describe, expect, test } from "bun:test"
import { turnReducer, initialTurn, type Action, type TurnState } from "../src/app/turnReducer"
import type { Part, ToolPart } from "../src/types/message"

function run(actions: Action[]): TurnState {
  return actions.reduce(turnReducer, initialTurn)
}

function last(s: TurnState) { return s.messages[s.messages.length - 1] }
function kinds(parts: Part[]) { return parts.map(p => p.type) }

describe("turnReducer", () => {
  test("delta accumulates into one streaming text part", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "message.delta", chunk: "hel" },
      { kind: "message.delta", chunk: "lo" },
    ])
    expect(s.streaming).toBe(true)
    const m = last(s)
    expect(m.role).toBe("assistant")
    expect(m.parts).toHaveLength(1)
    expect(m.parts[0]).toMatchObject({ type: "text", content: "hello", streaming: true })
  })

  test("tool.start seals open text; text→tool→text yields three parts in order", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "message.delta", chunk: "before " },
      { kind: "tool.start", id: "t1", name: "read_file" },
      { kind: "tool.complete", id: "t1", summary: "ok" },
      { kind: "message.delta", chunk: "after" },
    ])
    const parts = last(s).parts
    expect(kinds(parts)).toEqual(["text", "tool", "text"])
    expect(parts[0]).toMatchObject({ content: "before ", streaming: false })
    expect(parts[1]).toMatchObject({ id: "t1", status: "done", preview: "ok" })
    expect(parts[2]).toMatchObject({ content: "after", streaming: true })
  })

  test("complete seals trailing stream and attaches usage", () => {
    const usage = { input: 10, output: 5, total: 15 }
    const s = run([
      { kind: "message.start" },
      { kind: "message.delta", chunk: "hi" },
      { kind: "message.complete", usage },
    ])
    expect(s.streaming).toBe(false)
    const m = last(s)
    expect(m.usage).toEqual(usage)
    expect(m.parts[0]).toMatchObject({ content: "hi", streaming: false })
  })

  test("complete with no prior delta creates assistant from final text", () => {
    const s = run([
      { kind: "user", text: "q" },
      { kind: "message.start" },
      { kind: "message.complete", text: "answer" },
    ])
    expect(last(s).role).toBe("assistant")
    expect(last(s).parts[0]).toMatchObject({ type: "text", content: "answer", streaming: false })
  })

  test("tool.progress updates most-recently-started running tool", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "tool.start", id: "a", name: "terminal" },
      { kind: "tool.start", id: "b", name: "terminal" },
      { kind: "tool.progress", name: "terminal", preview: "running b" },
    ])
    const tools = last(s).parts.filter((p): p is ToolPart => p.type === "tool")
    expect(tools[0].preview).toBeUndefined()
    expect(tools[1].preview).toBe("running b")
  })

  test("tool.complete error → status=error", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "tool.start", id: "t1", name: "x" },
      { kind: "tool.complete", id: "t1", error: "boom" },
    ])
    expect((last(s).parts[0] as ToolPart).status).toBe("error")
  })

  test("thinking deltas win; reasoning.available is fallback-only", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "thinking", text: "hmm ", final: false },
      { kind: "thinking", text: "more", final: false },
      { kind: "thinking", text: "summary", final: true },
    ])
    expect(last(s).parts[0]).toMatchObject({ type: "thinking", content: "hmm more", streaming: false })
  })

  test("reasoning.available used when no deltas streamed", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "thinking", text: "recovered from last_reasoning", final: true },
    ])
    expect(last(s).parts[0]).toMatchObject({ type: "thinking", content: "recovered from last_reasoning", streaming: false })
  })

  test("interrupt.notice dedupes consecutive identical notices", () => {
    const s = run([
      { kind: "interrupt.notice", text: "press esc" },
      { kind: "interrupt.notice", text: "press esc" },
    ])
    expect(s.messages).toHaveLength(1)
  })

  test("error aborts streaming and appends system message", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "message.delta", chunk: "partial" },
      { kind: "error", text: "gateway died" },
    ])
    expect(s.streaming).toBe(false)
    expect(last(s).role).toBe("system")
    const p = last(s).parts[0]
    expect(p.type === "text" && p.content).toContain("gateway died")
  })

  test("reset clears everything", () => {
    const s = run([
      { kind: "user", text: "x" },
      { kind: "message.delta", chunk: "y" },
      { kind: "reset" },
    ])
    expect(s).toEqual(initialTurn)
  })
})
