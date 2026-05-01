// Cheap client-side sniff for "this paste is probably a local file path".
// Mirrors the starts_like_path gate in hermes cli._detect_file_drop — the
// gateway's input.detect_drop RPC is the authority (it stats the file and
// handles quoting/escapes/file://); this only decides whether to bother
// asking. Kept deliberately narrow so prose that happens to start with `/`
// (e.g. a pasted regex) still falls through to verbatim insert on miss.

/** Windows drive prefix (`C:\` or `C:/`), optionally behind a quote. */
const winDrive = (s: string, off = 0) =>
  s.length >= off + 3 && /[A-Za-z]/.test(s[off]!) && s[off + 1] === ":" && (s[off + 2] === "\\" || s[off + 2] === "/")

export function looksLikePath(s: string): boolean {
  const t = s.trim()
  if (!t || t.includes("\n")) return false
  if (t.startsWith("file://")) return true
  if (t.startsWith("/") || t.startsWith("~") || t.startsWith("./") || t.startsWith("../")) return true
  if (winDrive(t)) return true
  const q = t[0]
  if (q === '"' || q === "'") {
    const inner = t[1]
    if (inner === "/" || inner === "~") return true
    if (winDrive(t, 1)) return true
  }
  return false
}
