import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import * as perf from "./utils/perf";

// Initialize and render
const main = async () => {
  perf.mem("pre-renderer")

  const end = perf.mark("renderer-init")
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
    useMouse: true, // Enable mouse for text selection & copy-on-select
    targetFps: 60,
    gatherStats: false,
  });
  end()

  perf.mem("post-renderer")

  const root = createRoot(renderer);

  const endRender = perf.mark("first-render")
  root.render(<App />);
  endRender()

  perf.mem("post-first-render")

  // Periodic memory monitor (every 15s when PERF=1)
  perf.monitor(15_000)
};

main().catch(console.error);

export {};
