// Shared string formatters for tab panels.
//
// Timestamps in this codebase are unix seconds unless otherwise noted
// (gateway RPCs and state.db both store seconds). `ago`/`when`/`span`
// take seconds; `dur` takes an already-computed delta in seconds.

export const trunc = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…"

// abbreviate large counts: 12.3k / 1.23M
export const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n)

export const cost = (c: number | null | undefined): string =>
  c == null ? "—" : `$${c.toFixed(2)}`

export const ago = (ts: number): string => {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Future counterpart to `ago`. Past → "due".
export const until = (ts: number): string => {
  const s = Math.floor(ts - Date.now() / 1000)
  if (s <= 0) return "due"
  if (s < 60) return `in ${s}s`
  if (s < 3600) return `in ${Math.floor(s / 60)}m`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`
  return `in ${Math.floor(s / 86400)}d`
}

export const when = (ts: number): string => {
  const d = new Date(ts * 1000)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
}

export const span = (start: number, end: number): string => {
  const s = Math.round(end - start)
  if (s < 0) return "—"
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

// compact duration for uptime columns (no spaces, always two units ≥1m)
export const dur = (s: number): string =>
  s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  : s >= 60 ? `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`
  : `${Math.floor(s)}s`
