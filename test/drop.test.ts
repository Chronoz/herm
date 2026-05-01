import { describe, expect, test } from "bun:test"
import { looksLikePath } from "../src/utils/drop"

describe("looksLikePath", () => {
  const yes = [
    "/Users/kaio/Desktop/Screenshot 2026-04-30 at 1.13.42 PM.png",
    "/tmp/a.pdf",
    "~/Downloads/x.jpg",
    "./relative.txt",
    "../up/one.png",
    "file:///var/folders/zz/T/screencap.png",
    "  /tmp/leading-ws.png  ",
    '"/Users/kaio/My Files/a b.png"',
    "'/tmp/q.png'",
    '"~/q.png"',
    "C:\\Users\\kaio\\Pictures\\x.png",
    "c:/Users/kaio/x.png",
    '"C:\\Program Files\\x.png"',
    "/tmp/pic.png what is this?",
  ]
  const no = [
    "",
    "   ",
    "hello /tmp/a.png",
    "consider using file:// here",
    "a\n/tmp/b.png",
    "/tmp/a.png\n/tmp/b.png",
    "C: drive is full",
    "'plain quoted text'",
    "src/app.tsx",
  ]
  for (const s of yes) test(`yes: ${JSON.stringify(s)}`, () => expect(looksLikePath(s)).toBe(true))
  for (const s of no) test(`no: ${JSON.stringify(s)}`, () => expect(looksLikePath(s)).toBe(false))
})
