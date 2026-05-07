export type OpenCodeStatus = "running" | "blocked" | "error" | "done"

export type OpenCodeActivity = {
  stage: string
  task: string
  model: string
  startedAt: number
  seen: string[]
  status: OpenCodeStatus
  blockedReason?: string
  fallbackUsed?: boolean
  result?: string
}

export function parseModel(cmd: string): string | undefined {
  const m = cmd.match(/--model\s+(\S+)/)
  return m ? m[1] : undefined
}

export function parseTask(cmd: string): string {
  const m = cmd.match(/opencode\s+run\s+(.*)/)
  const raw = m ? m[1].trim() : ""
  if (!raw) return "OpenCode task"
  return raw.length > 60 ? raw.slice(0, 59) + "…" : raw
}

export function deriveStage(name: string, context: string): string {
  const c = context
  if (name === "terminal") {
    if (/\bopencode\b/.test(c)) return "starting"
    if (/\b(bun test|pytest|run_tests\.sh|npm test)\b/.test(c)) return "testing"
    if (/\b(bun run build|npm run build|tsc|make|cargo build)\b/.test(c)) return "building"
    if (/\b(git diff|git status|git log)\b/.test(c)) return "verifying"
    if (/\b(bunx tsc|ruff|eslint|prettier|flake8)\b/.test(c)) return "verifying"
  }
  if (name === "search_files" || name === "read_file" || name === "glob") return "reviewing"
  if (name === "write_file" || name === "apply_diff" || name === "edit_file") return "editing"
  return "running"
}

export function buildResult(seen: string[], opts?: { fallback?: boolean; status?: OpenCodeStatus }): string {
  const labels: Record<string, string> = {
    starting: "",
    reviewing: "reviewed",
    editing: "edited",
    building: "built",
    testing: "tested",
    verifying: "verified",
  }
  const parts = seen.map(s => labels[s]).filter(Boolean)
  const uniq = parts.filter((x, i) => parts.indexOf(x) === i)
  const clean = opts?.status === undefined || opts.status === "done"
  const prefix = !clean && opts?.fallback
    ? `OpenCode ${opts.status}; Hermes `
    : !clean
      ? `OpenCode ${opts.status}`
      : ""
  if (uniq.length === 0) return prefix || "done"
  return prefix + uniq.join(" + ")
}

export async function readDefaultModel(): Promise<string | undefined> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE
    const cfg = await Bun.file(`${home}/.config/opencode/opencode.json`).json()
    return cfg?.model
  } catch {
    return undefined
  }
}
