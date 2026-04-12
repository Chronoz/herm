import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";

// Initialize and render
const main = async () => {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
    useMouse: true, // Enable mouse for text selection & copy-on-select
  });

  const root = createRoot(renderer);
  root.render(<App />);
};

main().catch(console.error);

export {};
