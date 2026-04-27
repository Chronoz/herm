// Per-tool dispatch — oc's `<Switch>` over part.tool. Each hermes
// tool name maps to either an InlineTool row or a BlockTool card.
//
// Data constraint: the stock tui_gateway emits only
//   tool.start    {name, context: build_tool_preview() string ≤80ch}
//   tool.complete {summary, inline_diff?, error?, duration_s}
// — NOT the raw args JSON or the tool result body. So per-tool
// *bodies* (bash stdout, todo checklist, grep matches) are blocked
// on the wire carrying more (→ docs/UPSTREAM.md). The dispatch and
// frame grammar here are ready for them.

import { memo } from "react"
import type { ToolPart as Part } from "../../../types/message"
import type { DetailMode } from "../../../utils/preferences"
import { InlineTool, BlockTool } from "./frame"
import { DiffBlock, isDiff } from "../DiffBlock"
import { Subagent } from "./Subagent"
import { spec, label } from "./preview"
import { useTheme } from "../../../theme"

const FILE = new Set(["write_file", "patch"])

function short(s: string | undefined, n = 120): string {
  if (!s) return ""
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > n ? one.slice(0, n - 1) + "…" : one
}

/** "← Edit path/to/file" — oc's title convention with a leading glyph. */
function title(tool: Part): string {
  const s = spec(tool.name)
  const body = tool.preview ? ` ${short(tool.preview, 80)}` : ""
  return `${s.icon} ${label(tool.name)}${body}`
}

const Inline = memo(({ tool }: { tool: Part }) => {
  const s = spec(tool.name)
  const body = tool.preview ? short(tool.preview) : ""
  return (
    <InlineTool part={tool} complete={!!body || tool.status !== "running"}>
      {s.verb ? `${s.verb} ${body}` : body || tool.name}
    </InlineTool>
  )
})

const FileEdit = memo(({ tool, detail }: { tool: Part; detail: DetailMode }) => {
  const theme = useTheme().theme
  const diff = tool.diff ?? (isDiff(tool.result) ? tool.result : undefined)
  if (!diff) return <Inline tool={tool} />
  const lines = diff.split("\n")
  const add = lines.filter(l => /^\+(?!\+\+)/.test(l)).length
  const del = lines.filter(l => /^-(?!--)/.test(l)).length
  const delta = (
    <>
      <span fg={theme.success}>+{add}</span>
      <span fg={theme.textMuted}> / </span>
      <span fg={theme.error}>-{del}</span>
    </>
  )
  if (detail === "collapsed") {
    return (
      <InlineTool part={tool}>
        {label(tool.name)} {short(tool.preview, 60)}  {delta}
      </InlineTool>
    )
  }
  return (
    <BlockTool part={tool} title={title(tool)}>
      <box><DiffBlock text={diff} /></box>
      <box height={1}><text>{delta}</text></box>
    </BlockTool>
  )
})

export const Tool = memo(({ tool, detail = "expanded" }: { tool: Part; detail?: DetailMode }) => {
  if (detail === "hidden" && tool.status !== "running") return null
  if (tool.trail || tool.name === "delegate_task") return <Subagent tool={tool} />
  if (FILE.has(tool.name) || tool.diff || isDiff(tool.result)) return <FileEdit tool={tool} detail={detail} />
  return <Inline tool={tool} />
})
