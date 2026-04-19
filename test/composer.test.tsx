import { describe, expect, test } from "bun:test"
import { act, createRef } from "react"
import { mountNode, until, type Harness } from "./harness"
import { Composer, type ComposerHandle } from "../src/components/chat/Composer"
import type { SlashCommand } from "../src/commands/slash"

async function setup() {
  const ref = createRef<ComposerHandle>()
  const sent: string[] = []
  const slashed: SlashCommand[] = []
  const t: Harness = await mountNode(
    <Composer
      ref={ref}
      focused ready streaming={false}
      model="test" onSend={m => sent.push(m)} onSlash={c => slashed.push(c)}
    />,
    { width: 120, height: 30 },
  )
  await until(t, () => t.frame().includes("Ready"))
  return { t, ref, sent, slashed }
}

describe("composer", () => {
  test("type + Enter sends and clears", async () => {
    const { t, ref, sent } = await setup()
    await act(async () => { await t.keys.typeText("hello there") })
    await t.settle()
    expect(ref.current?.value()).toBe("hello there")
    expect(t.frame()).toContain("hello there")

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toEqual(["hello there"])
    expect(ref.current?.value()).toBe("")
    t.destroy()
  })

  test("blank submit is ignored", async () => {
    const { t, sent } = await setup()
    await act(async () => { await t.keys.typeText("   ") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toEqual([])
    t.destroy()
  })

  test("history up/down cycles previous sends", async () => {
    const { t, ref } = await setup()
    for (const msg of ["first", "second"]) {
      await act(async () => { await t.keys.typeText(msg) })
      act(() => t.keys.pressEnter())
      await t.settle()
    }
    act(() => ref.current?.historyUp())
    await t.settle()
    expect(ref.current?.value()).toBe("second")
    act(() => ref.current?.historyUp())
    await t.settle()
    expect(ref.current?.value()).toBe("first")
    act(() => ref.current?.historyDown())
    await t.settle()
    expect(ref.current?.value()).toBe("second")
    t.destroy()
  })

  test("ghost completion appears after 2 chars and Tab accepts", async () => {
    const { t, ref } = await setup()
    await act(async () => { await t.keys.typeText("/cl") })
    await t.settle()
    // ghost = "ear" (completes to /clear)
    expect(t.frame()).toContain("/clear")    // popover shows it
    expect(t.frame()).toMatch(/\/cl\s*ear/)   // input + ghost overlay

    act(() => ref.current?.popAccept())
    await t.settle()
    expect(ref.current?.value()).toBe("/clear")
    t.destroy()
  })

  test("popover Enter dispatches onSlash and clears input", async () => {
    const { t, ref, slashed } = await setup()
    await act(async () => { await t.keys.typeText("/help") })
    await t.settle()
    expect(ref.current?.popOpen()).toBe(true)

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(slashed.map(c => c.name)).toEqual(["help"])
    expect(ref.current?.value()).toBe("")
    t.destroy()
  })

  test("popCancel clears input", async () => {
    const { t, ref } = await setup()
    await act(async () => { await t.keys.typeText("/th") })
    await t.settle()
    act(() => ref.current?.popCancel())
    await t.settle()
    expect(ref.current?.value()).toBe("")
    expect(ref.current?.popOpen()).toBe(false)
    t.destroy()
  })
})
