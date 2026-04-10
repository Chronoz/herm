import { createCliRenderer, Box, Text } from "@opentui/core";

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});

renderer.root.add(
  Box(
    {
      borderStyle: "rounded",
      padding: 1,
      flexDirection: "column",
      gap: 1,
      backgroundColor: "#00509F",
    },
    Text({ content: "Angelia", fg: "#FFFF00" }),
    Text({ content: "Press Ctrl+C to exit" }),
  ),
);
