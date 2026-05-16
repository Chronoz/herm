import { memo, useState } from "react"
import type { BorderCharacters } from "@opentui/core"
import { useTheme } from "../../theme"
import type { ProfileInfo } from "../../utils/hermes-profiles"

type Props = {
  profiles: ProfileInfo[]
  active: string
  onSwitch: (home: string, name: string) => void
}

const W = 12
const H = 9

const trunc = (s: string, n: number) => s.length <= n ? s : s.slice(0, n - 1) + "…"

const BUBBLE: BorderCharacters = {
  topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯",
  horizontal: "┅", vertical: "┇",
  topT: "┅", bottomT: "┅", leftT: "┇", rightT: "┇", cross: "╋",
}

export const ProfileRail = memo((props: Props) => {
  const theme = useTheme().theme
  const cur = props.profiles.find(p => p.is_active)
    ?? props.profiles.find(p => p.name === props.active)
  const rest = props.profiles.filter(p => p.name !== cur?.name)
  const [hover, setHover] = useState<number | null>(null)
  const i1 = cur?.provider ?? "provider —"
  const i2 = cur?.model ?? "model —"

  const colors = [
    theme.primary,
    theme.success,
    theme.warning,
    theme.error,
    theme.hermAvatar,
    theme.info,
    theme.secondary,
    theme.accent,
  ]

  return (
    <box width={W + 4} flexDirection="column" paddingX={1} paddingTop={1}
         backgroundColor={theme.background}>
      <box width={W} height={H} flexDirection="column" marginLeft={1}
            backgroundColor={theme.backgroundElement}
            border borderColor={theme.primary} customBorderChars={BUBBLE}>
        <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={1}>
          <box height={1}>
            <text>
              <span fg={theme.text}><strong>{trunc(cur?.name ?? "default", W - 2)}</strong></span>
            </text>
          </box>
          <box height={1} />
          <box height={1}>
            <text><span fg={theme.textMuted}>{trunc(i1, W - 2)}</span></text>
          </box>
          <box height={1}>
            <text><span fg={theme.textMuted}>{trunc(i2, W - 2)}</span></text>
          </box>
        </box>
      </box>

      <box height={1} />

      <box flexDirection="column" flexGrow={1} overflow="hidden">
        {rest.map((p, i) => (
          <box key={p.name} height={2} flexDirection="column"
               backgroundColor={hover === i ? theme.backgroundElement : undefined}
               onMouseOver={() => setHover(i)}
               onMouseOut={() => setHover(null)}
               onMouseDown={() => props.onSwitch(p.path, p.name)}>
            <box height={1} flexDirection="row">
              <text>
                <span fg={colors[i % colors.length]}>{"● "}</span>
                <span fg={hover === i ? theme.primary : theme.text}>{trunc(p.name, W - 2)}</span>
              </text>
            </box>
            <box height={1} flexDirection="row">
              <text>
                <span fg={theme.textMuted}>
                  {trunc(`${p.provider ?? "—"}/${p.model ?? "—"}`, W + 2)}
                </span>
              </text>
            </box>
          </box>
        ))}
      </box>
    </box>
  )
})
