import { describe, expect, test } from "bun:test"
import * as prefs from "../src/utils/preferences"

describe("preferences", () => {
  test("mouse capture defaults off", () => {
    prefs.reset()
    expect(prefs.load().mouse).toBe(false)
  })
})