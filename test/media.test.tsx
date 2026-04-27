import { describe, expect, test } from "bun:test"
import { mountNode, until } from "./harness"
import { splitMedia, classify, MEDIA_LINE_RE } from "../src/components/chat/MediaChip"
import { MessageItem } from "../src/components/chat/MessageItem"
import type { Message } from "../src/types/message"

describe("MediaChip > splitMedia", () => {
  test("no-media fast path returns input verbatim", () => {
    const s = splitMedia("plain text\nno directives")
    expect(s).toEqual([{ md: "plain text\nno directives" }])
  })

  test("splits on MEDIA lines, preserving order and adjacency", () => {
    const s = splitMedia("before\nMEDIA:/tmp/a.png\nafter")
    expect(s).toEqual([
      { md: "before" },
      { media: "/tmp/a.png" },
      { md: "after" },
    ])
  })

  test("adjacent MEDIA lines and quoted/backticked paths", () => {
    const s = splitMedia("`MEDIA: /tmp/a.png`\n\"MEDIA:/tmp/b.mp3\"")
    expect(s).toEqual([
      { media: "/tmp/a.png" },
      { media: "/tmp/b.mp3" },
    ])
  })

  test("MEDIA inside fenced code is literal, not a directive", () => {
    const text = "```sh\nMEDIA:/tmp/x.png\n```\nMEDIA:/tmp/y.png"
    const s = splitMedia(text)
    expect(s).toEqual([
      { md: "```sh\nMEDIA:/tmp/x.png\n```" },
      { media: "/tmp/y.png" },
    ])
  })

  test("MEDIA mid-line is not a directive", () => {
    expect("see MEDIA:/tmp/x.png here".match(MEDIA_LINE_RE)).toBeNull()
    expect(splitMedia("see MEDIA:/tmp/x.png here")).toEqual([
      { md: "see MEDIA:/tmp/x.png here" },
    ])
  })
})

describe("MediaChip > classify", () => {
  test("extension → kind", () => {
    expect(classify("/tmp/a.png")).toBe("img")
    expect(classify("/tmp/a.JPG")).toBe("img")
    expect(classify("/tmp/a.mp3")).toBe("audio")
    expect(classify("/tmp/a.mp4")).toBe("video")
    expect(classify("/tmp/a.pdf")).toBe("file")
    expect(classify("https://x.co/a.png")).toBe("url")
  })
})

describe("MessageItem > media rendering", () => {
  const msg = (content: string): Message => ({
    id: "a1", role: "assistant", timestamp: 0, model: "test",
    parts: [{ type: "text", content, streaming: false }],
  })

  test("renders MEDIA: as badge chip, not literal text", async () => {
    const t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageItem message={msg("result:\nMEDIA:/tmp/screenshot.png\ndone.")} streaming={false} />
      </box>,
      { width: 100, height: 20 },
    )
    await until(t, () => t.frame().includes("result:") && t.frame().includes("done."))
    const f = t.frame()
    expect(f).toContain(" img ")
    expect(f).toContain("screenshot.png")
    // Directive itself not rendered as literal
    expect(f).not.toContain("MEDIA:/tmp")
    t.destroy()
  })
})
