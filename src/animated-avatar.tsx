import { useState, useEffect } from "react";
import { AVATAR_FRAMES, FRAME_COUNT, FPS } from "./avatar-frames";

export const AnimatedAvatar = () => {
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    const intervalMs = 1000 / FPS;
    const interval = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % FRAME_COUNT);
    }, intervalMs);

    return () => clearInterval(interval);
  }, []);

  const frameContent = AVATAR_FRAMES[currentFrame];
  const lines = frameContent.split("\n").filter(line => line.length > 0);

  return (
    <box flexDirection="column">
      {lines.map((line, index) => (
        <text key={index}>
          <span fg="cyan">{line}</span>
        </text>
      ))}
    </box>
  );
};