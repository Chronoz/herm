/**
 * FileLink — Generic clickable file reference.
 *
 * Wraps in a box for mouse hit-testing. Opens the source file
 * in the OS default handler when clicked. Underlines on hover.
 */

import { useState, memo } from "react";
import { TextAttributes } from "@opentui/core";
import type { Source } from "../../utils/hermes-home";
import { openFile } from "../../utils/open-file";
import { useTheme } from "../../theme";

interface FileLinkProps {
  source: Source;
  children?: string;
}

export const FileLink = memo(({ source, children }: FileLinkProps) => {
  const theme = useTheme().theme;
  const [hovered, setHovered] = useState(false);

  return (
    <box
      height={1}
      onMouseDown={() => openFile(source.file)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text
        fg={theme.info}
        attributes={hovered ? TextAttributes.UNDERLINE : TextAttributes.NONE}
      >
        {children ?? source.label}
      </text>
    </box>
  );
});
