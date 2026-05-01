// ChafaImage: inline image rendering with graceful degradation.
// These tests don't exercise real chafa output — the parser and shell
// pipeline are covered in test/chafa.test.ts and test/chafa-integration.test.tsx.
// What we test here is the fallback contract: any render failure (missing
// file, chafa absent) collapses to the plain MediaChip, no error chrome.

import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { mountNode } from "./harness"
import { ChafaImage } from "../src/ui/ChafaImage"

const IMG = `${process.env.HOME}/Pictures/ko-fi_banner.png`

describe("ChafaImage fallback", () => {
  test("nonexistent path → MediaChip badge, no error chrome in frame", async () => {
    const t = await mountNode(
      <ChafaImage path="/tmp/definitely-does-not-exist-xyz.png" width={40} />,
      { width: 80, height: 10 },
    )
    const f = t.frame()
    expect(f).toContain("img")
    expect(f).toContain("definitely-does-not-exist-xyz.png")
    expect(f).not.toContain("not found")
    expect(f).not.toContain("chafa")
    expect(f).not.toContain("exit")
    t.destroy()
  })

  test.skipIf(!existsSync(IMG))("real image → grid of unicode blocks + footer line", async () => {
    const t = await mountNode(
      <ChafaImage path={IMG} width={40} />,
      { width: 80, height: 20 },
    )
    const f = t.frame()
    // Footer with basename + hint
    expect(f).toContain("ko-fi_banner.png")
    expect(f).toContain("collapse")
    // Some half-block glyph from chafa's output — not a fixed string because
    // chafa's exact character pick varies by content, but at least one of
    // these should show up on any non-trivial image.
    const hasBlock = /[▀▄█▌▐░▒▓]/.test(f)
    expect(hasBlock).toBe(true)
    t.destroy()
  })
})
