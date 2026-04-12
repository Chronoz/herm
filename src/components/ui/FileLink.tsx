/**
 * FileLink — Generic clickable file reference.
 *
 * Wraps content in an inline box for mouse hit-testing, renders cyan
 * text that opens the source file in the OS default handler when clicked.
 * Underlines on hover.
 */

import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import type { Source } from "../../utils/hermes-home";
import { openFile } from "../../utils/open-file";

interface FileLinkProps {
  source: Source;
  children?: string;
}

export const FileLink = ({ source, children }: FileLinkProps) => {
  const [hovered, setHovered] = useState(false);

  return (
    <box
      height={1}
      onMouseDown={() => openFile(source.file)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text
        fg="cyan"
        attributes={hovered ? TextAttributes.UNDERLINE : TextAttributes.NONE}
      >
        {children ?? source.label}
      </text>
    </box>
  );
};
