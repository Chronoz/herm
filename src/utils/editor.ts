// Suspend the renderer, open $VISUAL/$EDITOR on a tmpfile seeded with the
// current input, read it back. Returns undefined if no editor configured
// or the user emptied the file.

import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import type { CliRenderer } from "@opentui/core"

export async function editInEditor(renderer: CliRenderer, seed: string): Promise<string | undefined> {
  const cmd = process.env.VISUAL || process.env.EDITOR
  if (!cmd) return undefined

  const path = join(tmpdir(), `herm-${Date.now()}.md`)
  await Bun.write(path, seed)

  renderer.suspend()
  renderer.currentRenderBuffer.clear()
  try {
    const parts = cmd.split(" ")
    const proc = Bun.spawn([...parts, path], {
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    })
    await proc.exited
    const text = await Bun.file(path).text().catch(() => "")
    return text.trim() || undefined
  } finally {
    rm(path, { force: true }).catch(() => {})
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}
