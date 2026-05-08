#!/usr/bin/env bun
// Reference-image -> .eikon NDJSON generator.
// Static single-frame by default; manifest mode for multi-state, multi-frame.
// Single-image auto-states via deterministic mechanical transforms.

import { spawnSync } from "child_process"
import { existsSync, readdirSync, statSync, mkdirSync, mkdtempSync } from "fs"
import { basename, dirname, join } from "path"
import { tmpdir } from "os"
import { Glob } from "bun"

const CHAFA_PATHS = [
  "/usr/sbin/chafa",
  "/usr/bin/chafa",
  "/usr/local/bin/chafa",
  "/opt/homebrew/bin/chafa",
  "/home/linuxbrew/.linuxbrew/bin/chafa",
]

function findChafa(): string | null {
  const viaPath = spawnSync("which", ["chafa"], { encoding: "utf8" })
  if (viaPath.status === 0 && viaPath.stdout.trim()) return viaPath.stdout.trim()
  for (const p of CHAFA_PATHS) if (existsSync(p)) return p
  return null
}

function findMagick(): string | null {
  const viaPath = spawnSync("which", ["magick"], { encoding: "utf8" })
  if (viaPath.status === 0 && viaPath.stdout.trim()) return viaPath.stdout.trim()
  const viaConvert = spawnSync("which", ["convert"], { encoding: "utf8" })
  if (viaConvert.status === 0 && viaConvert.stdout.trim()) return viaConvert.stdout.trim()
  return null
}

function findFfmpeg(): string | null {
  const viaPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" })
  if (viaPath.status === 0 && viaPath.stdout.trim()) return viaPath.stdout.trim()
  return null
}

export type GenOpts = {
  name: string
  width: number
  height: number
  state: string
  fps: number
  author?: string
}

/** Render one frame with chafa as exact-width row strings. */
export function chafaFrame(path: string, w: number, h: number): string[] | { err: string } {
  const bin = findChafa()
  if (!bin) return { err: "chafa not found on PATH or in known install locations" }
  if (!existsSync(path)) return { err: `image not found: ${path}` }

  const r = spawnSync(bin, [
    `--size=${w}x${h}`,
    "--format=symbols",
    "--symbols=braille",
    "--colors=none",
    "--fg-only",
    "--stretch",
    path,
  ], { encoding: "utf8" })

  if (r.status !== 0) return { err: `chafa failed: ${(r.stderr || r.stdout || "").trim()}` }

  const lines = r.stdout.split("\n").filter(l => l.length)
  while (lines.length < h) lines.push("")
  return lines.slice(0, h).map(l => [...l].slice(0, w).join("").padEnd(w))
}

/** Build NDJSON from meta + frame rows. */
export function buildEikon(opts: GenOpts, frames: string[][]): string {
  const states = [opts.state]
  const head = JSON.stringify({
    eikon: 1,
    name: opts.name,
    width: opts.width,
    height: opts.height,
    ...(opts.author ? { author: opts.author } : {}),
    states,
  })

  const stateLine = JSON.stringify({
    state: opts.state,
    fps: opts.fps,
    frame_count: frames.length,
  })

  const frameLines = frames.map((rows, i) =>
    JSON.stringify({ f: i, data: rows.join("\n") })
  )

  return [head, stateLine, ...frameLines].join("\n") + "\n"
}

// ------------------------------------------------------------------
// Multi-state manifest support
// ------------------------------------------------------------------

export type SpriteSource = {
  type: "sheet"
  path: string
  tile_width: number
  tile_height: number
  indices?: number[]
  cols?: number
  rows?: number
}

export type VideoSource = {
  type: "video"
  path: string
  start?: number
  duration?: number
  sample_fps?: number
  max_frames?: number
}

export type ManifestState = {
  name: string
  fps: number
  loop_from?: number
  frames?: string | string[]
  source?: SpriteSource | VideoSource
}

export type Manifest = {
  name: string
  width: number
  height: number
  author?: string
  states: ManifestState[]
}

export type StateSpec = {
  name: string
  fps: number
  loop_from?: number
  frames: string[][]
}

const IMG_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"])

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of IMG_EXTS) if (lower.endsWith(ext)) return true
  return false
}

export function resolveFramePaths(manifestDir: string, frames: string | string[]): string[] {
  const inputs = Array.isArray(frames) ? frames : [frames]
  const out: string[] = []

  for (const raw of inputs) {
    const abs = join(manifestDir, raw)
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      const files = readdirSync(abs)
        .filter(isImageFile)
        .sort()
        .map(f => join(abs, f))
      out.push(...files)
      continue
    }

    if (raw.includes("*") || raw.includes("?")) {
      const cwd = manifestDir
      const glob = new Glob(raw)
      const files: string[] = []
      for (const file of glob.scanSync({ cwd, absolute: true })) files.push(file)
      files.sort()
      if (files.length === 0) throw new Error(`glob matched no files: ${raw} (cwd: ${cwd})`)
      out.push(...files)
      continue
    }

    const direct = existsSync(raw) ? raw : abs
    out.push(direct)
  }

  return out
}

/** Extract tiles from a sprite sheet into temp files; return sorted paths. */
export function extractSheetTiles(source: SpriteSource, tmpDir: string): string[] {
  const magick = findMagick()
  if (!magick) throw new Error("ImageMagick (magick/convert) not found")

  const src = source.path
  if (!existsSync(src)) throw new Error(`sheet not found: ${src}`)

  const id = spawnSync(magick, ["identify", "-format", "%w %h", src], { encoding: "utf8" })
  if (id.status !== 0) throw new Error(`identify failed for ${src}`)
  const [imgW, imgH] = id.stdout.trim().split(" ").map(Number)

  const tw = source.tile_width
  const th = source.tile_height
  if (!tw || !th) throw new Error("sheet requires tile_width and tile_height")

  const cols = source.cols ?? Math.floor(imgW / tw)
  const rows = source.rows ?? Math.floor(imgH / th)
  const total = cols * rows

  const indices = source.indices ?? Array.from({ length: total }, (_, i) => i)

  const out: string[] = []
  for (const idx of indices) {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = col * tw
    const y = row * th
    const dst = join(tmpDir, `sheet_${idx}.png`)
    const r = spawnSync(magick, [
      src,
      "-crop", `${tw}x${th}+${x}+${y}`,
      "+repage",
      dst,
    ], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`crop failed for tile ${idx}: ${r.stderr}`)
    out.push(dst)
  }

  return out
}

/** Extract frames from a video/GIF into temp files; return sorted paths. */
export function extractVideoFrames(source: VideoSource, tmpDir: string): string[] {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) throw new Error("ffmpeg not found")

  const src = source.path
  if (!existsSync(src)) throw new Error(`video not found: ${src}`)

  const start = source.start ?? 0
  const duration = source.duration
  const sampleFps = source.sample_fps ?? 12
  const maxFrames = source.max_frames

  const fpsFilter = `fps=${sampleFps}`
  const vf = [fpsFilter]

  const args = ["-ss", String(start), "-i", src]
  if (typeof duration === "number") args.push("-t", String(duration))
  args.push("-vf", vf.join(","), "-q:v", "2")
  if (typeof maxFrames === "number") args.push("-frames:v", String(maxFrames))
  args.push(join(tmpDir, "frame_%04d.png"))

  const r = spawnSync(ffmpeg, args, { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)

  const files = readdirSync(tmpDir)
    .filter(f => f.startsWith("frame_") && f.endsWith(".png"))
    .sort()
    .map(f => join(tmpDir, f))

  return files
}

export function buildMultiEikon(meta: { name: string; width: number; height: number; author?: string }, states: StateSpec[]): string {
  const head = JSON.stringify({
    eikon: 1,
    name: meta.name,
    width: meta.width,
    height: meta.height,
    ...(meta.author ? { author: meta.author } : {}),
    states: states.map(s => s.name),
  })

  const lines: string[] = [head]

  for (const state of states) {
    const payload: Record<string, unknown> = {
      state: state.name,
      fps: state.fps,
      frame_count: state.frames.length,
    }
    if (typeof state.loop_from === "number") payload.loop_from = state.loop_from
    lines.push(JSON.stringify(payload))

    for (let i = 0; i < state.frames.length; i++) {
      lines.push(JSON.stringify({ f: i, data: state.frames[i].join("\n") }))
    }
  }

  return lines.join("\n") + "\n"
}

export async function loadManifest(path: string): Promise<Manifest> {
  return await Bun.file(path).json() as Manifest
}

export async function resolveManifest(manifest: Manifest, manifestPath: string): Promise<StateSpec[]> {
  const dir = dirname(manifestPath)
  const resolved: StateSpec[] = []
  const tmpRoot = mkdtempSync(join(tmpdir(), "eikon-"))

  for (let si = 0; si < manifest.states.length; si++) {
    const state = manifest.states[si]
    const frames: string[][] = []
    let paths: string[] = []

    if (state.source) {
      const stTmp = mkdtempSync(join(tmpRoot, `state_${si}_`))
      const srcPath = join(dir, state.source.path)
      if (state.source.type === "sheet") {
        paths = extractSheetTiles({ ...state.source, path: srcPath }, stTmp)
      } else if (state.source.type === "video") {
        paths = extractVideoFrames({ ...state.source, path: srcPath }, stTmp)
      } else {
        throw new Error(`unknown source type for state ${state.name}`)
      }
    }

    if (state.frames) {
      const explicit = resolveFramePaths(dir, state.frames)
      paths.push(...explicit)
    }

    if (paths.length === 0) throw new Error(`state ${state.name} has no frames`)

    for (const p of paths) {
      const rows = chafaFrame(p, manifest.width, manifest.height)
      if ("err" in rows) throw new Error(`chafa failed for ${p}: ${rows.err}`)
      frames.push(rows)
    }
    resolved.push({ name: state.name, fps: state.fps, loop_from: state.loop_from, frames })
  }

  return resolved
}

// ------------------------------------------------------------------
// Auto-states: deterministic mechanical transforms
// ------------------------------------------------------------------

export const AUTO_STATE_DEFAULTS = [
  { name: "idle", frames: 8, fps: 12 },
  { name: "listening", frames: 8, fps: 12 },
  { name: "thinking", frames: 10, fps: 12 },
  { name: "speaking", frames: 12, fps: 12 },
  { name: "working", frames: 12, fps: 12 },
  { name: "error", frames: 8, fps: 12 },
] as const

/** Deterministic looped transform parameters for a given state/frame. */
function transformParams(state: string, frame: number, total: number): Record<string, any> {
  const t = total > 1 ? frame / total : 0
  const angle = Math.sin(t * Math.PI * 2)
  const angle2 = Math.cos(t * Math.PI * 2)

  switch (state) {
    case "idle":
      return {
        modulate: 100 + angle * 8,
      }
    case "listening":
      return {
        rotate: angle * 1,
      }
    case "thinking":
      return {
        modulate: 100 + angle * 12,
        blur: Math.abs(angle * 0.6),
      }
    case "speaking":
      return {
        scaleY: 1 + angle * 0.05,
      }
    case "working":
      return {
        rotate: angle2 * 1,
      }
    case "error":
      return {
        contrast: 30 + Math.abs(angle) * 20,
        modulate: 100 + Math.abs(angle) * 15,
      }
    default:
      return {}
  }
}

/** Generate one mechanically-transformed temp image for a state/frame. */
function synthesizeFrame(src: string, dst: string, state: string, frame: number, total: number) {
  const magick = findMagick()
  if (!magick) throw new Error("ImageMagick (magick/convert) not found")

  const p = transformParams(state, frame, total)
  const args: string[] = [src]

  if (typeof p.modulate === "number") args.push("-modulate", String(p.modulate))
  if (typeof p.contrast === "number") args.push("-brightness-contrast", `0x${p.contrast}`)
  if (typeof p.blur === "number" && p.blur > 0.05) args.push("-blur", `0x${p.blur.toFixed(2)}`)
  if (typeof p.rotate === "number") {
    args.push("-background", "black", "-virtual-pixel", "background")
    args.push("-rotate", String(p.rotate))
    args.push("+repage")
  }
  if (typeof p.scaleY === "number") {
    args.push("-distort", "SRT", `0,0 1,${p.scaleY.toFixed(4)} 0`)
  }
  if (typeof p.rollX === "number" || typeof p.rollY === "number") {
    const rx = p.rollX ?? 0
    const ry = p.rollY ?? 0
    if (rx !== 0 || ry !== 0) args.push("-roll", `${rx >= 0 ? '+' : ''}${rx}${ry >= 0 ? '+' : ''}${ry}`)
  }

  args.push(dst)
  const r = spawnSync(magick, args, { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`magick failed for ${state} frame ${frame}: ${r.stderr}`)
}

/** Generate full multi-state eikon from a single reference image via deterministic transforms. */
export function generateAutoStates(
  src: string,
  opts: { width: number; height: number; name: string; author?: string; states?: { name: string; frames: number; fps: number }[] }
): string {
  const states = opts.states ?? AUTO_STATE_DEFAULTS.map(s => ({ ...s }))
  const tmp = mkdtempSync(join(tmpdir(), "eikon-auto-"))

  const specs: StateSpec[] = []
  for (const st of states) {
    const frameRows: string[][] = []
    for (let i = 0; i < st.frames; i++) {
      const dst = join(tmp, `${st.name}_${i}.png`)
      synthesizeFrame(src, dst, st.name, i, st.frames)
      const rows = chafaFrame(dst, opts.width, opts.height)
      if ("err" in rows) throw new Error(`chafa failed for ${st.name} frame ${i}: ${rows.err}`)
      frameRows.push(rows)
    }
    specs.push({ name: st.name, fps: st.fps, loop_from: 0, frames: frameRows })
  }

  return buildMultiEikon({ name: opts.name, width: opts.width, height: opts.height, author: opts.author }, specs)
}

/** CLI entry. */
async function run() {
  const args = process.argv.slice(2)
  const input = args[0]
  if (!input || input.startsWith("-")) {
    console.error(`Usage: bun scripts/gen-eikon.ts <image|manifest.json> [options]`)
    console.error(`Options:`)
    console.error(`  -o, --out <path>     Output file (default: <image>.eikon)`)
    console.error(`  -w, --width <n>      Cell width  (default: 48)`)
    console.error(`  -h, --height <n>     Cell height (default: 24)`)
    console.error(`  -n, --name <name>    Eikon name  (default: basename of image)`)
    console.error(`  -s, --state <name>   State name  (default: idle)`)
    console.error(`  --fps <n>            FPS         (default: 12)`)
    console.error(`  -a, --author <name>  Author      (optional)`)
    console.error(`  --auto-states        Generate multistate multiframe from a single image`)
    console.error(`                       using deterministic mechanical transforms.`)
    console.error(`                       (default states: idle/listening/thinking/speaking/working/error)`)
    console.error(`
Manifest mode (input is a .json file):`)
    console.error(`  The JSON file describes states and frame image paths/globs.`)
    console.error(`  In manifest mode, -w/-h/-n/-s/--fps are ignored; values come from the manifest.`)
    console.error(`
Manifest state sources:`)
    console.error(`  frames: string|string[] — explicit image paths, globs, or directories.`)
    console.error(`  source.type=sheet       — sprite sheet with tile_width/tile_height.`)
    console.error(`  source.type=video       — video/GIF with optional start/duration/sample_fps/max_frames.`)
    process.exit(1)
  }

  let out: string | undefined
  let autoStates = false
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    const next = () => { const v = args[++i]; if (!v) throw new Error(`missing value for ${a}`); return v }
    if (a === "-o" || a === "--out") out = next()
    else if (a === "--auto-states") autoStates = true
  }

  if (input.endsWith(".json")) {
    const manifest = await loadManifest(input)
    const states = await resolveManifest(manifest, input)
    const ndjson = buildMultiEikon({
      name: manifest.name,
      width: manifest.width,
      height: manifest.height,
      author: manifest.author,
    }, states)
    const dest = out || `${manifest.name}.eikon`
    await Bun.write(dest, ndjson)
    const total = states.reduce((s, st) => s + st.frames.length, 0)
    console.log(`wrote ${dest} (${manifest.width}x${manifest.height}, ${states.length} states, ${total} frames)`)
    return
  }

  let w = 48
  let h = 24
  let name = basename(input).replace(/\.[^.]+$/, "")
  let state = "idle"
  let fps = 12
  let author: string | undefined

  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    const next = () => { const v = args[++i]; if (!v) throw new Error(`missing value for ${a}`); return v }
    if (a === "-o" || a === "--out") out = next()
    else if (a === "-w" || a === "--width") w = parseInt(next(), 10)
    else if (a === "-h" || a === "--height") h = parseInt(next(), 10)
    else if (a === "-n" || a === "--name") name = next()
    else if (a === "-s" || a === "--state") state = next()
    else if (a === "--fps") fps = parseInt(next(), 10)
    else if (a === "-a" || a === "--author") author = next()
  }

  if (autoStates) {
    const ndjson = generateAutoStates(input, { width: w, height: h, name, author })
    const dest = out || `${input}.eikon`
    await Bun.write(dest, ndjson)
    const parsed = JSON.parse(ndjson.split("\n")[0])
    const total = ndjson.split("\n").filter(l => l.trim() && JSON.parse(l).f !== undefined).length
    console.log(`wrote ${dest} (${w}x${h}, ${parsed.states.length} auto-states, ${total} frames)`)
    return
  }

  const rows = chafaFrame(input, w, h)
  if ("err" in rows) { console.error(rows.err); process.exit(1) }

  const ndjson = buildEikon({ name, width: w, height: h, state, fps, author }, [rows])
  const dest = out || `${input}.eikon`
  await Bun.write(dest, ndjson)
  console.log(`wrote ${dest} (${w}x${h}, 1 frame, state="${state}")`)
}

if (import.meta.main) await run()
