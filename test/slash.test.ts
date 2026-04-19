import { describe, expect, test } from "bun:test"
import { filter, matchSub, sort, LOCAL_COMMANDS, type SlashCommand } from "../src/commands/slash"

const cmd = (over: Partial<SlashCommand>): SlashCommand => ({
  name: "x", description: "", category: "Session", aliases: [], argsHint: "",
  subcommands: [], source: "command", target: "gateway", ...over,
})

describe("slash", () => {
  test("filter matches name and alias by prefix, case-insensitive", () => {
    const list = [cmd({ name: "model" }), cmd({ name: "memory", aliases: ["mem"] })]
    expect(filter(list, "mo").map(c => c.name)).toEqual(["model"])
    expect(filter(list, "MEM").map(c => c.name)).toEqual(["memory"])
    expect(filter(list, "")).toHaveLength(2)
  })

  test("matchSub returns synthetic entries for declared subcommands", () => {
    const list = [cmd({ name: "reasoning", subcommands: ["high", "low", "none"] })]
    const r = matchSub(list, "/reasoning h")
    expect(r?.map(c => c.name)).toEqual(["reasoning high"])
    expect(matchSub(list, "/reasoning ")).toHaveLength(3)
    expect(matchSub(list, "/unknown x")).toBeNull()
    expect(matchSub([cmd({ name: "foo" })], "/foo x")).toBeNull() // no subcommands
  })

  test("sort orders by CATEGORY_ORDER then name", () => {
    const r = sort([
      cmd({ name: "b", category: "Info" }),
      cmd({ name: "a", category: "Client" }),
      cmd({ name: "c", category: "Client" }),
    ])
    expect(r.map(c => c.name)).toEqual(["a", "c", "b"])
  })

  test("LOCAL_COMMANDS includes logs", () => {
    expect(LOCAL_COMMANDS.some(c => c.name === "logs")).toBe(true)
  })
})
