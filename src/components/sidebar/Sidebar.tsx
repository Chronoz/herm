import { useState, useEffect, useCallback } from "react"
import { AnimatedAvatar } from "../avatar/AnimatedAvatar"
import { useTheme } from "../../theme"
import { readHermesHome, type HermesHomeSnapshot } from "../../utils/hermes-home"

export const Sidebar = ({ activeTools, memoryCount }: { activeTools: string[]; memoryCount: number }) => {
  const { theme } = useTheme()
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null)

  const refresh = useCallback(async () => {
    try { setHome(await readHermesHome()) } catch {}
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  // Real data from hermes-home
  const skills = home?.skills ?? []
  const memNotes = home?.memory
  const memUser = home?.userProfile
  const notesCount = memNotes ? memNotes.content.split("§").filter(s => s.trim()).length : 0
  const userCount = memUser ? memUser.content.split("§").filter(s => s.trim()).length : 0
  const skillCount = skills.length

  return (
    <box width={48} flexDirection="column">
      {/* Avatar (bust) */}
      <box flexDirection="column" height={24} overflow="hidden">
        <AnimatedAvatar />
      </box>

      {/* Body (pillar) */}
      <box
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.hermBody}
      >
        {/* Memory section */}
        <text fg={theme.hermBodyText}>
          <strong>Memory</strong>
        </text>
        <text fg={theme.hermBodyText}>
          Notes: {notesCount} entries
          {memNotes ? ` (${memNotes.content.length}/${2200} chars)` : ""}
        </text>
        <text fg={theme.hermBodyText}>
          Profile: {userCount} entries
          {memUser ? ` (${memUser.content.length}/${1375} chars)` : ""}
        </text>

        <text> </text>

        {/* Skills */}
        <text fg={theme.hermBodyText}>
          <strong>Skills</strong>
        </text>
        <text fg={theme.hermBodyText}>
          {skillCount} loaded
        </text>

        <text> </text>

        {/* Tools */}
        <text fg={theme.hermBodyText}>
          <strong>Tools</strong>
        </text>
        {activeTools.map(tool => (
          <text key={tool} fg={theme.hermBodyText}>
            · {tool}
          </text>
        ))}
      </box>
    </box>
  )
}
