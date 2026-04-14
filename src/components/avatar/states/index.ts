import { FRAMES as idle } from "./idle"
import { FRAMES as listening } from "./listening"
import { FRAMES as thinking } from "./thinking"
import { FRAMES as speaking } from "./speaking"
import { FRAMES as working } from "./working"
import { FRAMES as error } from "./error"

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "working" | "error"

export const STATE_FRAMES: Record<AvatarState, string[]> = {
  idle,
  listening,
  thinking,
  speaking,
  working,
  error,
}

export const FPS = 12
export const FRAME_WIDTH = 48
export const FRAME_HEIGHT = 24
