import { describe, expect, test } from "bun:test"
import { filter, matchSub, resolve, sort, LOCAL_COMMANDS, type SlashCommand } from "../src/commands/slash"

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

  describe("resolve", () => {
    const list = [
      cmd({ name: "status" }),
      cmd({ name: "statusbar" }),
      cmd({ name: "help", aliases: ["h", "?"] }),
      cmd({ name: "history" }),
      cmd({ name: "new", aliases: ["reset"] }),
    ]
    const hit = (n: string) => {
      const r = resolve(list, n)
      return "hit" in r ? r.hit.name : r
    }

    test("exact name beats longer prefix sibling", () => {
      expect(hit("status")).toBe("status")
      expect(hit("statusbar")).toBe("statusbar")
    })
    test("exact alias wins even when prefix of other names", () => {
      // `h` is an exact alias of help, and a prefix of history — help wins.
      expect(hit("h")).toBe("help")
    })
    test("unique prefix resolves", () => {
      expect(hit("statu")).toEqual({ ambiguous: ["/status", "/statusbar"] })
      expect(hit("statusb")).toBe("statusbar")
      expect(hit("Re")).toBe("new")   // via alias "reset", case-insensitive
    })
    test("ambiguous and miss", () => {
      const r = resolve(list, "hi")
      expect("hit" in r && r.hit.name).toBe("history")
      expect(resolve(list, "zzz")).toEqual({ miss: true })
    })
  })
})
