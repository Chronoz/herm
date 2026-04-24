import { FRAMES as idle } from "./idle";
import { FRAMES as listening } from "./listening";
import { FRAMES as thinking } from "./thinking";
import { FRAMES as speaking } from "./speaking";
import { FRAMES as working } from "./working";
import { FRAMES as error } from "./error";

export type AvatarState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "error";

const split = (frames: string[]): string[][] =>
  frames.map(f => f.split("\n").filter(l => l.length > 0));

// Pre-split once at module load so the 12Hz render loop doesn't
// re-split ~45 multi-line strings every tick.
export const STATE_FRAMES: Record<AvatarState, string[][]> = {
  idle: split(idle),
  listening: split(listening),
  thinking: split(thinking),
  speaking: split(speaking),
  working: split(working),
  error: split(error),
};

export const FPS = 12;
export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 24;
