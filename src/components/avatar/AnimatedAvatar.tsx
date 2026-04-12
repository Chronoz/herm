import { useState, useEffect, useRef } from "react";
import { AVATAR_FRAMES, FRAME_COUNT, FPS } from "./avatar-frames";

/**
 * Animation loop:
 *   1. Pause on frame 0 for 1s
 *   2. Play forward (0 → last) at FPS
 *   3. Pause on last frame for 2s
 *   4. Play reverse (last → 0) at FPS
 *   5. Goto 1
 */

export const AnimatedAvatar = () => {
  const [frame, setFrame] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAUSE_FIRST = 5000;
  const PAUSE_LAST = 1000;

  useEffect(() => {
    // Mutable state the timeout chain reads — avoids stale closures
    let idx = 0;
    let phase: "pause-first" | "forward" | "pause-last" | "reverse" =
      "pause-first";

    const tick = () => {
      switch (phase) {
        case "pause-first":
          // Sitting on frame 0 — wait, then start forward playback
          phase = "forward";
          idx = 0;
          timer.current = setTimeout(tick, PAUSE_FIRST);
          break;

        case "forward":
          idx++;
          setFrame(idx);
          if (idx >= FRAME_COUNT - 1) {
            phase = "pause-last";
          }
          timer.current = setTimeout(
            tick,
            phase === "pause-last" ? PAUSE_LAST : 1000 / FPS,
          );
          break;

        case "pause-last":
          // Sitting on last frame — wait, then start reverse playback
          phase = "reverse";
          timer.current = setTimeout(tick, 0); // already waited 2s above
          break;

        case "reverse":
          idx--;
          setFrame(idx);
          if (idx <= 0) {
            phase = "pause-first";
          }
          timer.current = setTimeout(
            tick,
            phase === "pause-first" ? PAUSE_FIRST : 1000 / FPS,
          );
          break;
      }
    };

    // Start: show frame 0 immediately, then kick off the chain
    setFrame(0);
    timer.current = setTimeout(tick, 1); // initial pause on first frame

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const lines = AVATAR_FRAMES[frame].split("\n").filter((l) => l.length > 0);

  return (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i}>
          <span fg="cyan">{line}</span>
        </text>
      ))}
    </box>
  );
};
