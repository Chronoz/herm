import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs"
import { spawnSync } from "child_process"

import { tmpdir } from "os"
import { join } from "path"
import { parseEikon, listEikons } from "../src/components/avatar/eikon"
import {
  buildEikon, buildMultiEikon, chafaFrame, loadManifest, resolveManifest, resolveFramePaths,
  generateAutoStates, extractSheetTiles, extractVideoFrames, AUTO_STATE_DEFAULTS,
} from "../scripts/gen-eikon"

const FIXTURE = [
  JSON.stringify({ eikon: 1, name: "tiny", width: 4, height: 2, author: "t", states: ["idle", "error"] }),
  JSON.stringify({ state: "idle", fps: 8, frame_count: 2 }),
  JSON.stringify({ f: 0, data: " o \n/|\\" }),
  JSON.stringify({ f: 1, data: " O \n/|\\" }),
  JSON.stringify({ state: "error", frame_count: 2 }),
  JSON.stringify({ f: 0, data: " x \n/|\\", duration_ms: 100 }),
  JSON.stringify({ f: 1, data: " X \n/|\\", duration_ms: 50 }),
].join("\n")

describe("parseEikon", () => {
  test("parses header + states + frames", () => {
    const e = parseEikon(FIXTURE)
    expect(e.meta.name).toBe("tiny")
    expect(e.meta.version).toBe(1)
    expect(e.meta.width).toBe(4)
    expect(e.meta.states).toEqual(["idle", "error"])
    expect(e.states.size).toBe(2)
    const idle = e.states.get("idle")!
    expect(idle.fps).toBe(8)
    expect(idle.frames).toHaveLength(2)
    expect(idle.frames[0]).toEqual([" o ", "/|\\"])
  })

  test("derives fps from median duration_ms when fps absent", () => {
    const e = parseEikon(FIXTURE)
    const err = e.states.get("error")!
    // median of [100, 50] = 75 → 1000/75 ≈ 13
    expect(err.fps).toBe(13)
  })

  test("falls back to 12 fps when no fps and no durations", () => {
    const txt = [
      JSON.stringify({ eikon: 1, name: "x", width: 1, height: 1 }),
      JSON.stringify({ state: "idle", frame_count: 1 }),
      JSON.stringify({ f: 0, data: "." }),
    ].join("\n")
    expect(parseEikon(txt).states.get("idle")!.fps).toBe(12)
  })

  test("throws with line number on malformed JSON", () => {
    const bad = FIXTURE.split("\n")
    bad[2] = "{not json"
    expect(() => parseEikon(bad.join("\n"))).toThrow(/line 3/)
  })

  test("tolerates unknown version and unknown fields", () => {
    const txt = [
      JSON.stringify({ eikon: 99, name: "x", width: 1, height: 1, mystery: true }),
      JSON.stringify({ state: "idle", fps: 4, frame_count: 1, extra: [1, 2] }),
      JSON.stringify({ f: 0, data: ".", weird: {} }),
    ].join("\n")
    const e = parseEikon(txt)
    expect(e.meta.version).toBe(99)
    expect(e.states.get("idle")!.frames).toHaveLength(1)
  })

  test("loop_from: absent → 0, explicit clamped to [0,count], loop:false → count", () => {
    const mk = (decl: object) => [
      JSON.stringify({ eikon: 1, name: "x", width: 1, height: 1 }),
      JSON.stringify({ state: "s", fps: 4, frame_count: 3, ...decl }),
      JSON.stringify({ f: 0, data: "." }),
      JSON.stringify({ f: 1, data: "." }),
      JSON.stringify({ f: 2, data: "." }),
    ].join("\n")
    expect(parseEikon(mk({})).states.get("s")!.loopFrom).toBe(0)
    expect(parseEikon(mk({ loop_from: 2 })).states.get("s")!.loopFrom).toBe(2)
    expect(parseEikon(mk({ loop_from: 3 })).states.get("s")!.loopFrom).toBe(3)   // hold
    expect(parseEikon(mk({ loop_from: 99 })).states.get("s")!.loopFrom).toBe(3)  // clamp
    expect(parseEikon(mk({ loop_from: -5 })).states.get("s")!.loopFrom).toBe(0)  // clamp
    expect(parseEikon(mk({ loop: false })).states.get("s")!.loopFrom).toBe(3)    // alias
    expect(parseEikon(mk({ loop: true })).states.get("s")!.loopFrom).toBe(0)
    // loop:false wins over loop_from (deprecated alias, but unambiguous intent)
    expect(parseEikon(mk({ loop: false, loop_from: 1 })).states.get("s")!.loopFrom).toBe(3)
  })
})

describe("listEikons", () => {
  test("scans dirs, parses header only, skips missing dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "a.eikon"), FIXTURE)
    writeFileSync(join(dir, "skip.txt"), "nope")
    const found = listEikons([dir, "/does/not/exist"])
    expect(found).toHaveLength(1)
    expect(found[0].meta.name).toBe("tiny")
    expect(found[0].meta.states).toEqual(["idle", "error"])
    expect(found[0].path).toContain("a.eikon")
  })
})

describe("buildEikon", () => {
  test("serializes single-frame static eikon parseable by parseEikon", () => {
    const ndjson = buildEikon(
      { name: "test", width: 4, height: 2, state: "idle", fps: 8, author: "a" },
      [[" ab ", " cd "]]
    )
    const e = parseEikon(ndjson)
    expect(e.meta.name).toBe("test")
    expect(e.meta.width).toBe(4)
    expect(e.meta.height).toBe(2)
    expect(e.meta.author).toBe("a")
    expect(e.meta.states).toEqual(["idle"])
    expect(e.states.size).toBe(1)
    const idle = e.states.get("idle")!
    expect(idle.fps).toBe(8)
    expect(idle.frames).toHaveLength(1)
    expect(idle.frames[0]).toEqual([" ab ", " cd "])
  })

  test("serializes multi-frame eikon with embedded newlines in data", () => {
    const ndjson = buildEikon(
      { name: "multi", width: 2, height: 1, state: "run", fps: 12 },
      [["A "], [" B"]]
    )
    const e = parseEikon(ndjson)
    expect(e.states.get("run")!.frames).toHaveLength(2)
    expect(e.states.get("run")!.frames[0]).toEqual(["A "])
    expect(e.states.get("run")!.frames[1]).toEqual([" B"])
  })
})

describe("buildMultiEikon", () => {
  test("serializes multi-state eikon parseable by parseEikon", () => {
    const ndjson = buildMultiEikon(
      { name: "multi", width: 4, height: 2 },
      [
        { name: "idle", fps: 8, frames: [[" o ", "/|\\"], [" O ", "/|\\"]] },
        { name: "run", fps: 12, loop_from: 1, frames: [[" ->", " / "], [" =>", " / "]] },
      ]
    )
    const e = parseEikon(ndjson)
    expect(e.meta.name).toBe("multi")
    expect(e.meta.width).toBe(4)
    expect(e.meta.height).toBe(2)
    expect(e.meta.states).toEqual(["idle", "run"])
    expect(e.states.size).toBe(2)

    const idle = e.states.get("idle")!
    expect(idle.fps).toBe(8)
    expect(idle.frames).toHaveLength(2)
    expect(idle.frames[0]).toEqual([" o ", "/|\\"])
    expect(idle.loopFrom).toBe(0)

    const run = e.states.get("run")!
    expect(run.fps).toBe(12)
    expect(run.frames).toHaveLength(2)
    expect(run.loopFrom).toBe(1)
  })

  test("emits state records then their frame records in order", () => {
    const ndjson = buildMultiEikon(
      { name: "order", width: 2, height: 1 },
      [
        { name: "a", fps: 1, frames: [["A1"], ["A2"]] },
        { name: "b", fps: 2, frames: [["B1"]] },
      ]
    )
    const lines = ndjson.trim().split("\n")
    expect(JSON.parse(lines[0]).states).toEqual(["a", "b"])
    expect(JSON.parse(lines[1])).toMatchObject({ state: "a", fps: 1, frame_count: 2 })
    expect(JSON.parse(lines[2])).toMatchObject({ f: 0, data: "A1" })
    expect(JSON.parse(lines[3])).toMatchObject({ f: 1, data: "A2" })
    expect(JSON.parse(lines[4])).toMatchObject({ state: "b", fps: 2, frame_count: 1 })
    expect(JSON.parse(lines[5])).toMatchObject({ f: 0, data: "B1" })
  })

  test("frame data is exactly one newline-joined string", () => {
    const ndjson = buildMultiEikon(
      { name: "nl", width: 3, height: 2 },
      [{ name: "idle", fps: 1, frames: [["abc", "def"]] }]
    )
    const lines = ndjson.trim().split("\n")
    const frame = JSON.parse(lines[2])
    expect(frame.data).toBe("abc\ndef")
    expect(frame.data.split("\n")).toEqual(["abc", "def"])
  })

  test("preserves author in header", () => {
    const ndjson = buildMultiEikon(
      { name: "auth", width: 1, height: 1, author: "me" },
      [{ name: "idle", fps: 1, frames: [["."]] }]
    )
    expect(parseEikon(ndjson).meta.author).toBe("me")
  })
})

describe("manifest", () => {
  test("loadManifest parses manifest JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const path = join(dir, "manifest.json")
    writeFileSync(path, JSON.stringify({
      name: "test",
      width: 4,
      height: 2,
      author: "a",
      states: [
        { name: "idle", fps: 8, frames: ["f1.txt", "f2.txt"] },
        { name: "run", fps: 12, loop_from: 0, frames: "run/*.txt" },
      ]
    }))
    const m = await loadManifest(path)
    expect(m.name).toBe("test")
    expect(m.states).toHaveLength(2)
    expect(m.states[1].loop_from).toBe(0)
  })

  test("resolveFramePaths expands globs and directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "a.png"), "dummy")
    writeFileSync(join(dir, "b.png"), "dummy")
    writeFileSync(join(dir, "c.txt"), "dummy")

    const sub = join(dir, "run")
    mkdirSync(sub)
    writeFileSync(join(sub, "r1.png"), "dummy")
    writeFileSync(join(sub, "r2.png"), "dummy")

    const paths = resolveFramePaths(dir, ["*.png", "run"])
    expect(paths).toHaveLength(4)
    expect(paths[0]).toContain("a.png")
    expect(paths[1]).toContain("b.png")
    expect(paths[2]).toContain("r1.png")
    expect(paths[3]).toContain("r2.png")
  })

  test("resolveManifest with real images produces frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const src = join(process.cwd(), "image.png")
    copyFileSync(src, join(dir, "f1.png"))
    copyFileSync(src, join(dir, "f2.png"))

    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({
      name: "test",
      width: 4,
      height: 2,
      states: [
        { name: "idle", fps: 8, frames: ["*.png"] },
      ]
    }))

    const manifest = await loadManifest(manifestPath)
    const states = await resolveManifest(manifest, manifestPath)
    expect(states).toHaveLength(1)
    expect(states[0].frames).toHaveLength(2)
    expect(states[0].frames[0]).toHaveLength(2)
    expect(states[0].frames[0][0]).toHaveLength(4)
  })
})

describe("chafaFrame", () => {
  test("returns exact dimensions when chafa is installed", () => {
    const rows = chafaFrame("docs/splash/frame/nine/2-tl.png", 8, 4)
    if ("err" in rows) {
      console.warn("skipping chafaFrame test:", rows.err)
      return
    }
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveLength(8)
  })
})

describe("generateAutoStates", () => {
  const tinyStates = [
    { name: "idle", frames: 2, fps: 12 },
    { name: "error", frames: 2, fps: 12 },
  ]

  test("produces expected state count and frame counts from a single image", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const img = join(dir, "fixture.png")
    const r = spawnSync("magick", ["-size", "20x20", "xc:blue", img], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping auto-states test: magick not available")
      return
    }

    const ndjson = generateAutoStates(img, { name: "auto", width: 16, height: 8, states: tinyStates })
    const e = parseEikon(ndjson)
    expect(e.meta.name).toBe("auto")
    expect(e.meta.states).toEqual(["idle", "error"])
    expect(e.states.size).toBe(2)
    expect(e.states.get("idle")!.frames).toHaveLength(2)
    expect(e.states.get("error")!.frames).toHaveLength(2)
  })

  test("output is parser-compatible NDJSON with newline-joined frame data", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const img = join(dir, "fixture.png")
    const r = spawnSync("magick", ["-size", "20x20", "xc:blue", img], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping auto-states test: magick not available")
      return
    }

    const ndjson = generateAutoStates(img, { name: "auto", width: 8, height: 4, states: tinyStates })
    const lines = ndjson.trim().split("\n")
    expect(lines.length).toBeGreaterThan(1)
    const head = JSON.parse(lines[0])
    expect(head.eikon).toBe(1)
    expect(head.states).toBeInstanceOf(Array)
    for (let i = 1; i < lines.length; i++) {
      const obj = JSON.parse(lines[i])
      if (obj.f !== undefined) {
        expect(typeof obj.data).toBe("string")
        expect(obj.data.split("\n").length).toBe(4)
      }
    }
  })
})

describe("extractSheetTiles", () => {
  test("crops tiles from a sprite sheet deterministically", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const sheet = join(dir, "sheet.png")
    // 40x20 image: 4 tiles of 20x10
    const r = spawnSync("magick", [
      "-size", "40x20", "xc:red",
      "-fill", "blue", "-draw", "rectangle 20,0 40,10",
      "-fill", "green", "-draw", "rectangle 0,10 20,20",
      "-fill", "yellow", "-draw", "rectangle 20,10 40,20",
      sheet,
    ], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping sheet test: magick not available")
      return
    }

    const tiles = extractSheetTiles({ type: "sheet", path: sheet, tile_width: 20, tile_height: 10 }, dir)
    expect(tiles).toHaveLength(4)
    for (const p of tiles) expect(existsSync(p)).toBe(true)

    const id = spawnSync("magick", ["identify", "-format", "%w %h", tiles[0]], { encoding: "utf8" })
    expect(id.stdout.trim()).toBe("20 10")
  })

  test("obeys explicit indices", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const sheet = join(dir, "sheet.png")
    const r = spawnSync("magick", ["-size", "40x20", "xc:black", sheet], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping sheet test: magick not available")
      return
    }

    const tiles = extractSheetTiles({
      type: "sheet", path: sheet, tile_width: 20, tile_height: 10, indices: [1, 3]
    }, dir)
    expect(tiles).toHaveLength(2)
  })
})

describe("extractVideoFrames", () => {
  test("extracts frames from a video using ffmpeg", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const vid = join(dir, "test.mp4")
    const r = spawnSync("ffmpeg", [
      "-f", "lavfi", "-i", "testsrc=duration=2:size=10x10:rate=1",
      "-pix_fmt", "yuv420p", vid,
    ], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping video test: ffmpeg not available")
      return
    }

    const frames = extractVideoFrames({ type: "video", path: vid, sample_fps: 2 }, dir)
    expect(frames.length).toBeGreaterThanOrEqual(2)
    for (const p of frames) expect(existsSync(p)).toBe(true)
  })

  test("respects max_frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const vid = join(dir, "test.mp4")
    const r = spawnSync("ffmpeg", [
      "-f", "lavfi", "-i", "testsrc=duration=3:size=10x10:rate=1",
      "-pix_fmt", "yuv420p", vid,
    ], { encoding: "utf8" })
    if (r.status !== 0) {
      console.warn("skipping video test: ffmpeg not available")
      return
    }

    const frames = extractVideoFrames({ type: "video", path: vid, sample_fps: 10, max_frames: 2 }, dir)
    expect(frames.length).toBeLessThanOrEqual(2)
  })
})

describe("mixed manifest sources", () => {
  test("manifest with sheet source and explicit frames resolves both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    const sheet = join(dir, "sheet.png")
    const magick = spawnSync("magick", ["-size", "20x10", "xc:black", sheet], { encoding: "utf8" })
    if (magick.status !== 0) {
      console.warn("skipping mixed manifest test: magick not available")
      return
    }

    const src = join(process.cwd(), "image.png")
    copyFileSync(src, join(dir, "extra.png"))

    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({
      name: "mixed",
      width: 4,
      height: 2,
      states: [
        {
          name: "sheet",
          fps: 8,
          source: { type: "sheet", path: "sheet.png", tile_width: 10, tile_height: 10 }
        },
        {
          name: "extra",
          fps: 8,
          frames: ["extra.png"]
        },
      ]
    }))

    const manifest = await loadManifest(manifestPath)
    const states = await resolveManifest(manifest, manifestPath)
    expect(states).toHaveLength(2)
    expect(states[0].frames.length).toBeGreaterThanOrEqual(1)
    expect(states[1].frames.length).toBe(1)
  })
})


