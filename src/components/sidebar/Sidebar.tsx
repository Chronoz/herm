import { useState, memo } from "react";
import { AnimatedAvatar } from "../avatar/AnimatedAvatar";
import { useTheme } from "../../theme";
import type { AvatarState } from "../avatar/states";

const STATES: AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "error"];

export const Sidebar = memo(({
  agentState = "idle",
}: {
  agentState?: AvatarState;
}) => {
  const theme = useTheme().theme;
  const [override, setOverride] = useState<AvatarState | null>(null);
  const active = override ?? agentState;

  return (
    <box width={48} flexDirection="column">
      {/* Avatar (bust) */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar state={active} />
      </box>

      {/* Body (pillar) */}
      <box
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.hermBody}
      >
        <box justifyContent="center">
          <text fg={theme.hermBodyText}>{active}{override ? " (debug)" : ""}</text>
        </box>
        <text> </text>
        {STATES.map(s => (
          <box
            key={s}
            height={1}
            onMouseDown={() => setOverride(s === override ? null : s)}
          >
            <text fg={s === active ? theme.primary : theme.hermBodyText}>
              {s === active ? "▸ " : "  "}{s}
            </text>
          </box>
        ))}
      </box>
    </box>
  );
});
