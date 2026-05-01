// Throwaway demo dialog — `/chafa <path>` renders an image inline via
// chafa's symbol mode + our SGR parser (src/utils/chafa.ts). Proof that
// 24-bit colored image rendering in OpenTUI works end-to-end. Will be
// superseded by inline rendering in MessageItem (herm-mzb.7).

import { useEffect, useMemo, useState } from "react"
import { spawnSync } from "child_process"
import { existsSync } from "fs"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { parseChafa, hex, type Cell } from "../utils/chafa"

const CHAFA = ["/usr/sbin/chafa", "/usr/bin/chafa", "/usr/local/bin/chafa", "/opt/homebrew/bin/chafa"]

function whichChafa(): string | null {
  for (const p of CHAFA) if (existsSync(p)) return p
  return null
}

function render(path: string, w: number, h: number): { rows?: Cell[][]; err?: string } {
  const bin = whichChafa()
  if (!bin) return { err: "chafa not installed (brew/apt install chafa)" }
  const full = path.startsWith("~") ? path.replace(/^~/, process.env.HOME ?? "") : path
  if (!existsSync(full)) return { err: `file not found: ${full}` }
  const r = spawnSync(bin, [
    `--size=${w}x${h}`,
    "--format=symbols",
    "--symbols=block",
    "--colors=full",
    full,
  ], { encoding: "utf8" })
  if (r.status !== 0) return { err: r.stderr || `chafa exit ${r.status}` }
  return { rows: parseChafa(r.stdout) }
}

const ChafaDialog = ({ path }: { path: string }) => {
  const theme = useTheme().theme
  const [w] = useState(80)
  const [h] = useState(28)
  const result = useMemo(() => render(path, w, h), [path, w, h])

  return (
    <box flexDirection="column" minWidth={w + 4} gap={1}>
      <box height={1}>
        <text fg={theme.primary}><strong>chafa demo · {path}</strong></text>
      </box>
      {result.err
        ? <box height={1}><text fg={theme.error}>{result.err}</text></box>
        : (
          <box flexDirection="column">
            {result.rows!.map((row, i) => (
              <text key={i}>
                {row.map((c, j) => (
                  <span key={j} fg={hex(c.fg)} bg={hex(c.bg)}>{c.ch}</span>
                ))}
              </text>
            ))}
          </box>
        )}
      <box height={1}>
        <text fg={theme.borderSubtle}>
          {result.rows ? `${result.rows.length} rows · ${result.rows.reduce((a, r) => a + r.length, 0)} cells · ` : ""}
          Esc to close
        </text>
      </box>
    </box>
  )
}

export function openChafa(dialog: DialogContext, path: string) {
  dialog.replace(<ChafaDialog path={path} />)
}
