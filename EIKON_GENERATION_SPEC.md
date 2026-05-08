# Eikon Generation Spec

Target avatar: **neko-girl / nous-girl**

## Runtime constraints
- Canvas: `48 x 24` characters
- Effective dot grid: `96 x 96`
- Full runtime state set:
  - `idle`
  - `listening`
  - `thinking`
  - `speaking`
  - `working`
  - `error`
- Preferred playback target for future image generation: **12 fps**
- Max duration per state: **2 seconds**
- Loop rule: each state's **first and last frame should be visually similar** so the loop closes cleanly

## Recommended full-set frame plan
| State | Frames | Duration | Loop shape |
|---|---:|---:|---|
| `idle` | 16 | 1.33s | closed mirrored loop |
| `listening` | 16 | 1.33s | closed mirrored loop |
| `thinking` | 20 | 1.67s | closed mirrored loop |
| `speaking` | 24 | 2.00s | closed mirrored loop |
| `working` | 24 | 2.00s | closed mirrored loop |
| `error` | 12 | 1.00s | closed mirrored loop |

**Total recommended frames:** `112`

## Mirrored-loop construction rule
Use an out-and-back loop, not a one-way motion:
- `A -> B -> C -> B' -> A'`
- `A'` should be visually very close to `A`

## State pose guidance
### `idle` — 16 frames
- neutral front-facing neko-girl
- tiny breathing bob
- one blink
- slight hair/ear drift
- end near start pose

### `listening` — 16 frames
- attentive tilt
- ear perk
- micro-reactive pose
- return near start

### `thinking` — 20 frames
- upward/side glance
- hand-to-face if readable
- slight ear/bang asymmetry
- return near start

### `speaking` — 24 frames
- 3–4 mouth shapes
- mild head bob
- optional blink
- settle near start pose

### `working` — 24 frames
- strongest action state
- downward gaze
- oversized readable prop: stylus+tablet or pen+notebook
- hand/tool motion returns near start by final frame

### `error` — 12 frames
- short punchy reaction
- recoil / annoyed blink / stress cue
- recover near start so loop closes cleanly

## Key-pose prep recommendation
Generate key poses, then expand into in-betweens:
- `idle`: 4
- `listening`: 4
- `thinking`: 5
- `speaking`: 6
- `working`: 6
- `error`: 4

Total key poses: **29**

## Readability rules
Exaggerate:
- ear silhouette
- bangs / hair outline
- eye direction
- hand placement
- working prop size

Keep consistent across all source images:
- framing
- scale
- head placement
- shoulder line
- lighting / contrast style

## Current default-asset enlargement applied in repo
Regenerated from committed source using dot-grid crop/rescale:
- crop box: `left=9, top=7, width=78, height=78`
- effective scale factor: `1.230769x`
- effective size increase: `23.08%`

These files must remain synchronized:
- `src/components/avatar/default.eikon`
- `assets/eikons/default.eikon`

## Repo-native generator usage

The generator lives at `scripts/gen-eikon.ts` and supports three modes.

### Single-image mode (default)

```bash
bun run gen-eikon <image> [options]
```

Options:
- `-o, --out <path>`   Output file (default: `<image>.eikon`)
- `-w, --width <n>`    Cell width  (default: 48)
- `-h, --height <n>`   Cell height (default: 24)
- `-n, --name <name>`  Eikon name  (default: basename of image)
- `-s, --state <name>` State name  (default: `idle`)
- `--fps <n>`          FPS         (default: 12)
- `-a, --author <name>` Author     (optional)

### Single-image auto-states mode (`--auto-states`)

Generate a full multi-state, multi-frame eikon from a single reference image using deterministic mechanical transforms. No model or image API is used; the effect is placeholder animation synthesis (brightness, rotation, scale, blur, roll) that loops cleanly.

```bash
bun run gen-eikon .tmp_ava.avif --auto-states -o /tmp/ava-auto.eikon
```

Default auto-states and frame counts:

| State | Frames | FPS |
|---|---|---:|
| `idle` | 8 | 12 |
| `listening` | 8 | 12 |
| `thinking` | 10 | 12 |
| `speaking` | 12 | 12 |
| `working` | 12 | 12 |
| `error` | 8 | 12 |

The `-w`, `-h`, `-n`, `-a` options still apply. Transforms are deterministic sinusoidal loops so the first and last frames are visually similar.

**Limitation:** These are mechanical transforms, not semantic poses. The result is a stylized "living" placeholder rather than accurate state-specific animation.

### Manifest mode (multi-state, multi-frame)

Pass a `.json` manifest instead of an image:

```bash
bun run gen-eikon manifest.json -o out.eikon
```

Manifest format:

```json
{
  "name": "neko-girl",
  "width": 48,
  "height": 24,
  "author": "artist",
  "states": [
    {
      "name": "idle",
      "fps": 12,
      "loop_from": 0,
      "frames": ["idle/frame_01.png", "idle/frame_02.png"]
    },
    {
      "name": "speaking",
      "fps": 12,
      "frames": "speaking/*.png"
    },
    {
      "name": "working",
      "fps": 12,
      "frames": "working"
    }
  ]
}
```

Field description:
- `name`, `width`, `height`, `author` — global eikon metadata.
- `states` — ordered array of state definitions.
  - `name` — state identifier.
  - `fps` — playback frames per second.
  - `loop_from` — optional; first frame of the loop segment (0 = loop whole sequence, frame_count = play once and hold).
  - `frames` — string or string array. Each entry may be:
    - A literal image file path (resolved relative to the manifest file).
    - A glob pattern (`*.png`, `run/frame_*.png`, etc.) expanded relative to the manifest directory.
    - A directory path; all image files inside are collected and sorted alphabetically.

#### Manifest with sprite-sheet source

A state can be sourced from a sprite sheet instead of explicit frame files:

```json
{
  "name": "sheet-avatar",
  "width": 48,
  "height": 24,
  "states": [
    {
      "name": "run",
      "fps": 12,
      "source": {
        "type": "sheet",
        "path": "sprites/run.png",
        "tile_width": 32,
        "tile_height": 32,
        "cols": 4,
        "rows": 2,
        "indices": [0, 1, 2, 3, 2, 1]
      }
    }
  ]
}
```

Sheet fields:
- `path` — image file (resolved relative to the manifest).
- `tile_width`, `tile_height` — size of each tile in pixels.
- `cols`, `rows` — optional; auto-calculated from image size if omitted.
- `indices` — optional; which tiles to extract in order. Defaults to all tiles left-to-right, top-to-bottom.

**Limitation:** All tiles must be the same size and arranged on a regular grid.

#### Manifest with video/GIF source

A state can be sourced from a video or GIF segment:

```json
{
  "name": "video-avatar",
  "width": 48,
  "height": 24,
  "states": [
    {
      "name": "idle",
      "fps": 12,
      "source": {
        "type": "video",
        "path": "clips/idle.mp4",
        "start": 0,
        "duration": 2,
        "sample_fps": 12,
        "max_frames": 24
      }
    }
  ]
}
```

Video fields:
- `path` — video file (resolved relative to the manifest).
- `start` — optional; segment start in seconds (default: 0).
- `duration` — optional; segment length in seconds.
- `sample_fps` — optional; target frame sampling rate (default: 12).
- `max_frames` — optional; hard cap on extracted frames.

**Limitation:** Frame extraction shells out to `ffmpeg`. Very short or low-frame-rate sources may yield fewer frames than requested.

#### Mixed manifest

A manifest may mix state sources. A single state can even combine `source` and `frames`; explicit frames are appended after sourced frames:

```json
{
  "name": "mixed",
  "width": 48,
  "height": 24,
  "states": [
    {
      "name": "combo",
      "fps": 12,
      "source": { "type": "sheet", "path": "a.png", "tile_width": 16, "tile_height": 16 },
      "frames": ["extra.png"]
    }
  ]
}
```

### Output format

Frame images are processed in order with `chafa` and emitted as one NDJSON record per frame. The output order is:

1. Header line (`eikon`, `name`, `width`, `height`, `author`, `states`)
2. For each state:
   - State declaration line (`state`, `fps`, `frame_count`, optional `loop_from`)
   - Frame lines (`f`, `data`) where `data` is a single newline-joined string of rows

Dependencies:
- `chafa` must be installed and on PATH (or in a known location such as `/opt/homebrew/bin/chafa`).
- `magick` (ImageMagick 7+) or `convert` for sprite-sheet cropping and auto-state transforms.
- `ffmpeg` for video/GIF frame extraction.

The script shells out to chafa with the same braille-symbol settings used by `scripts/bake-splash.ts`, producing parser-compatible NDJSON.
