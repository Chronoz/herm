/**
 * open-file.ts — Open files and URLs using the OS default handler.
 *
 * Uses the `open` package (cross-platform: xdg-open on Linux, open on macOS, start on Windows).
 * Fire-and-forget — does not block the TUI.
 */

import open from "open";

/** Open a file in the OS default handler for its type */
export function openFile(path: string): void {
  open(path).catch(() => {});
}
