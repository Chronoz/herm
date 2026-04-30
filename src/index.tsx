#!/usr/bin/env bun
// NOTE: CPU usage at idle (~40-80% of one core) comes from OpenTUI's render loop,
// not React's scheduler. The TUI framework renders frames at targetFps (30) to the
// terminal, which is an inherent cost of continuous TUI rendering. The scheduler
// override (MessageChannel/setImmediate = undefined) was a red herring — verified
// via per-thread profiling that the main JS thread drives the render loop.

// OpenTUI's tree-sitter worker opens its wasm at a relative path that
// emscripten resolves against the worker's process.cwd(). In dev Bun's
// asset loader handles that; in the bundle we redirect to a shim sibling
// that chdirs into dist/ before loading the real worker. The shim is
// emitted alongside index.js at build time, so import.meta.dirname of
// THIS file is its directory.
import { dirname } from "path"
import { fileURLToPath } from "url"
const here = dirname(fileURLToPath(import.meta.url))
// Only override when the shim actually exists next to the bundle. In
// dev runs the shim isn't emitted and we fall through to OpenTUI's
// default node_modules-relative resolution.
import { existsSync } from "fs"
import { join } from "path"
const shim = join(here, "parser.worker.shim.js")
if (existsSync(shim)) process.env.OTUI_TREE_SITTER_WORKER_PATH = shim

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import * as perf from "./utils/perf";
import * as control from "./utils/control";
import * as preferences from "./utils/preferences";

// Initialize and render
const main = async () => {
  perf.mem("pre-renderer")

  const prefs = preferences.load()

  const end = perf.mark("renderer-init")
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
    useMouse: prefs.mouse ?? true,
    targetFps: prefs.targetFps ?? 30,
    gatherStats: false,
  });
  end()

  perf.mem("post-renderer")

  const root = createRoot(renderer);

  const endRender = perf.mark("first-render")
  root.render(<App initialTheme={prefs.theme} />);
  endRender()

  perf.mem("post-first-render")

  // Periodic memory monitor (every 15s when PERF=1)
  perf.monitor(15_000)

  // Control server for headless interaction (CONTROL=1)
  control.start()
};

main().catch(console.error);

export {};
