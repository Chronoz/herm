/**
 * open-file.ts — Open files and URLs using the OS default handler.
 *
 * Uses the `open` package (cross-platform: xdg-open on Linux, open on macOS, start on Windows).
 * Fire-and-forget — does not block the TUI.
 */

import open from "open";
import { hermesPath } from "./hermes-home";

/** Open a URL in the default browser */
export function openUrl(url: string): void {
  open(url).catch(() => {});
}

/** Open a file in the OS default handler for its type */
export function openFile(path: string): void {
  open(path).catch(() => {});
}

/** Open a file relative to ~/.hermes/ */
export function openHermesFile(relative: string): void {
  openFile(hermesPath(relative));
}
