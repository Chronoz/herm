import { FRAMES as idle } from "./idle";
import { FRAMES as listening } from "./listening";
import { FRAMES as thinking } from "./thinking";
import { FRAMES as speaking } from "./speaking";
import { FRAMES as working } from "./working";
import { FRAMES as error } from "./error";
import type { EikonState } from "../eikon";

export type AvatarState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "error";

// The driver is forward-only (intro → loop). Mirror the tail so these
// legacy baked clips keep their original ping-pong motion: [0,1,2,3]
// becomes [0,1,2,3,2,1] with loopFrom=0.
const pingpong = (frames: string[], fps: number): EikonState => {
  const f = frames.map(s => s.split("\n").filter(l => l.length > 0))
  const mirrored = f.length > 2 ? [...f, ...f.slice(1, -1).reverse()] : f
  return { frames: mirrored, fps, loopFrom: 0 }
}

// Pre-split once at module load so the 16Hz render loop doesn't
// re-split ~45 multi-line strings every tick.
export const STATE_FRAMES: Record<AvatarState, EikonState> = {
  idle: pingpong(idle, 12),
  listening: pingpong(listening, 12),
  thinking: pingpong(thinking, 12),
  speaking: pingpong(speaking, 12),
  working: pingpong(working, 12),
  error: pingpong(error, 12),
};
