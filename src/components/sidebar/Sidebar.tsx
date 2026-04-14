import { useState, useEffect, useCallback } from "react";
import { AnimatedAvatar } from "../avatar/AnimatedAvatar";
import { useTheme } from "../../theme";
import {
  readHermesHome,
  type HermesHomeSnapshot,
} from "../../utils/hermes-home";
import type { AvatarState } from "../avatar/states";

export const Sidebar = ({
  activeTools,
  memoryCount,
  agentState = "idle",
}: {
  activeTools: string[];
  memoryCount: number;
  agentState?: AvatarState;
}) => {
  const { theme } = useTheme();
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHome(await readHermesHome());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Real data from hermes-home
  const skills = home?.skills ?? [];
  const memNotes = home?.memory;
  const memUser = home?.userProfile;
  const notesCount = memNotes
    ? memNotes.content.split("§").filter((s) => s.trim()).length
    : 0;
  const userCount = memUser
    ? memUser.content.split("§").filter((s) => s.trim()).length
    : 0;
  const skillCount = skills.length;

  return (
    <box width={48} flexDirection="column">
      {/* Avatar (bust) */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar state={agentState} />
      </box>

      {/* Body (pillar) */}
      <box
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.hermBody}
      >
        <box justifyContent="center">
          <text fg={theme.hermBodyText}>{agentState}</text>
        </box>
      </box>
    </box>
  );
};
