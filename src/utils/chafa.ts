// Parse a single line of chafa `--format=symbols --colors=full` output
// into renderable cells. chafa emits SGR escapes interleaved with cell
// characters. Each cell is a single Unicode codepoint preceded by zero or
// more SGR sequences that set fg/bg/reverse. We flatten that stream into
// { ch, fg, bg } records and let the caller build spans.
//
// Grammar (informal):
//   LINE        := (SGR* CELL)*
//   SGR         := ESC '[' PARAMS 'm'
//   PARAMS      := N (';' N)*           // e.g. "38;2;255;0;0" or "0" or "7"
//   CELL        := any single codepoint, not ESC
//
// State mutations from SGR params, reading left to right:
//   0            → fg = bg = null; reverse = false
//   7            → reverse = true (swap fg/bg for following cells)
//   38;2;R;G;B   → fg = rgb(R,G,B)
//   48;2;R;G;B   → bg = rgb(R,G,B)
//   everything else is ignored (chafa doesn't emit 256-color in full mode,
//   and basic 16-color shouldn't appear — but silent-skip is safer than
//   throw on an unexpected byte).

export type RGB = { r: number; g: number; b: number }
export type Cell = { ch: string; fg: RGB | null; bg: RGB | null }

const ESC = 0x1b
const LSQ = 0x5b // '['
const M = 0x6d   // 'm'

export function parseChafaLine(line: string): Cell[] {
  const out: Cell[] = []
  let fg: RGB | null = null
  let bg: RGB | null = null
  let reverse = false
  let i = 0
  const N = line.length

  while (i < N) {
    const code = line.charCodeAt(i)
    // SGR run
    if (code === ESC && line.charCodeAt(i + 1) === LSQ) {
      const end = line.indexOf("m", i + 2)
      if (end < 0) { i = N; break }
      const params = line.slice(i + 2, end).split(";").map(x => parseInt(x, 10) || 0)
      let p = 0
      while (p < params.length) {
        const n = params[p]
        if (n === 0) { fg = null; bg = null; reverse = false; p++; continue }
        if (n === 7) { reverse = true; p++; continue }
        if (n === 27) { reverse = false; p++; continue }
        if (n === 38 && params[p + 1] === 2) {
          fg = { r: params[p + 2] | 0, g: params[p + 3] | 0, b: params[p + 4] | 0 }
          p += 5; continue
        }
        if (n === 48 && params[p + 1] === 2) {
          bg = { r: params[p + 2] | 0, g: params[p + 3] | 0, b: params[p + 4] | 0 }
          p += 5; continue
        }
        if (n === 39) { fg = null; p++; continue }
        if (n === 49) { bg = null; p++; continue }
        p++
      }
      i = end + 1
      continue
    }
    // A cell — consume one codepoint (handles surrogate pairs)
    const cp = line.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    i += ch.length
    const efg = reverse ? bg : fg
    const ebg = reverse ? fg : bg
    out.push({ ch, fg: efg, bg: ebg })
  }
  return out
}

/** Parse a multi-line chafa output into rows. */
export function parseChafa(text: string): Cell[][] {
  return text.split("\n").filter(s => s.length > 0).map(parseChafaLine)
}

/** Hex color helper for OpenTUI fg/bg props. */
export function hex(c: RGB | null): string | undefined {
  if (!c) return undefined
  return `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`
}
