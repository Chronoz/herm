// Using OpenTUI React, not standard React
import { useEffect, useState } from "react";

interface ContextTabProps {
  description?: string;
}

interface ContextSegment {
  type:
    | "system"
    | "context"
    | "memory"
    | "skills"
    | "tools"
    | "conversation"
    | "compression"
    | "free";
  tokens: number;
  percentage: number;
  content?: string;
}

interface ContextData {
  totalTokens: number;
  usedTokens: number;
  contextLength: number;
  compressionThreshold: number;
  compressionEnabled: boolean;
  segments: ContextSegment[];
}

// Color mapping for each segment type - using ANSI color codes
const SEGMENT_COLORS = {
  system: "blue",
  context: "magenta",
  memory: "yellow",
  skills: "yellow", // orange not available in ANSI
  tools: "green",
  conversation: "red",
  compression: "white",
  free: undefined, // no background
} as const;

const SEGMENT_LABELS = {
  system: "🟦 System",
  context: "🟪 Context",
  memory: "🟨 Memory",
  skills: "🟧 Skills",
  tools: "🟩 Tools",
  conversation: "🟥 Conversation",
  compression: "⬜ Compression",
  free: "⬛ Free",
} as const;

// Mock data generator - will be replaced with actual API call
const getMockContextData = (): ContextData => {
  const contextLength = 200000; // 200k tokens
  const compressionThreshold = 100000; // 100k tokens

  // Mock token usage
  const systemTokens = 24000;
  const contextTokens = 6000;
  const memoryTokens = 4000;
  const skillsTokens = 2000;
  const toolsTokens = 4000;
  const conversationTokens = 6000;
  const compressionTokens = 0;

  const usedTokens =
    systemTokens +
    contextTokens +
    memoryTokens +
    skillsTokens +
    toolsTokens +
    conversationTokens +
    compressionTokens;
  const freeTokens = contextLength - usedTokens;

  return {
    totalTokens: contextLength,
    usedTokens,
    contextLength,
    compressionThreshold,
    compressionEnabled: true,
    segments: [
      {
        type: "system",
        tokens: systemTokens,
        percentage: (systemTokens / contextLength) * 100,
      },
      {
        type: "context",
        tokens: contextTokens,
        percentage: (contextTokens / contextLength) * 100,
      },
      {
        type: "memory",
        tokens: memoryTokens,
        percentage: (memoryTokens / contextLength) * 100,
      },
      {
        type: "skills",
        tokens: skillsTokens,
        percentage: (skillsTokens / contextLength) * 100,
      },
      {
        type: "tools",
        tokens: toolsTokens,
        percentage: (toolsTokens / contextLength) * 100,
      },
      {
        type: "conversation",
        tokens: conversationTokens,
        percentage: (conversationTokens / contextLength) * 100,
      },
      {
        type: "compression",
        tokens: compressionTokens,
        percentage: (compressionTokens / contextLength) * 100,
      },
      {
        type: "free",
        tokens: freeTokens,
        percentage: (freeTokens / contextLength) * 100,
      },
    ],
  };
};

// Format token count for display
const formatTokens = (tokens: number): string => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return tokens.toString();
};

// Generate grid cells based on segments
const generateGrid = (
  segments: ContextSegment[],
  gridSize: number = 256,
): Array<ContextSegment["type"]> => {
  const grid: Array<ContextSegment["type"]> = [];

  for (const segment of segments) {
    // More precise calculation for 16x16 grid
    const cellCount = Math.round((segment.percentage / 100) * gridSize);
    for (let i = 0; i < cellCount; i++) {
      grid.push(segment.type);
    }
  }

  // Fill any remaining cells with 'free'
  while (grid.length < gridSize) {
    grid.push("free");
  }

  return grid;
};

// Map segment types to emoji squares
const SEGMENT_EMOJIS = {
  system: "🟦",
  context: "🟪",
  memory: "🟨",
  skills: "🟧",
  tools: "🟩",
  conversation: "🟥",
  compression: "⬜",
  free: "⬛",
} as const;

export const Context = ({ description }: ContextTabProps) => {
  const [contextData, setContextData] = useState<ContextData | null>(null);

  useEffect(() => {
    // Initial load
    const data = getMockContextData();
    setContextData(data);

    // TODO: Replace with actual API polling
    // const interval = setInterval(() => {
    //   const data = getMockContextData();
    //   setContextData(data);
    // }, 5000);

    // return () => clearInterval(interval);
  }, []);

  if (!contextData) {
    return (
      <box flexGrow={1} padding={2}>
        <text>Loading context data...</text>
      </box>
    );
  }

  const grid = generateGrid(contextData.segments);
  const usagePercent = Math.round(
    (contextData.usedTokens / contextData.contextLength) * 100,
  );
  const compressionPercent = Math.round(
    (contextData.usedTokens / contextData.compressionThreshold) * 100,
  );

  return (
    <box flexGrow={1} flexDirection="column" padding={1}>
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <strong>Context Usage</strong>
          <span>
            {" "}
            - Total: {formatTokens(contextData.usedTokens)} /{" "}
            {formatTokens(contextData.contextLength)} tokens ({usagePercent}%)
          </span>
          <span>
            {" "}
            - Compression:{" "}
            {contextData.compressionEnabled ? "Enabled" : "Disabled"} (triggers
            at {formatTokens(contextData.compressionThreshold)})
          </span>
        </text>
      </box>

      {/* Main content area with grid on left, info on right */}
      <box flexDirection="row">
        {/* Grid Visualization - 64x8 grid */}
        <box borderStyle="single" paddingTop={1} paddingX={2} marginRight={2}>
          {[...Array(16)].map((_, rowIndex) => (
            <box key={rowIndex} flexDirection="row" height={1}>
              {[...Array(16)].map((_, colIndex) => {
                const cellIndex = rowIndex * 16 + colIndex;
                const cellType = grid[cellIndex];
                const bgColor = SEGMENT_COLORS[cellType];

                const emoji = SEGMENT_EMOJIS[cellType];
                return <text key={colIndex}>{emoji}</text>;
              })}
            </box>
          ))}
        </box>

        {/* Right side info panel */}
        <box flexDirection="column">
          {/* Breakdown Legend */}
          <box borderStyle="single" padding={1} marginBottom={1}>
            <text>
              <strong>Breakdown</strong>
            </text>
            {contextData.segments
              .filter((segment) => segment.tokens > 0)
              .map((segment) => (
                <text key={segment.type}>
                  {SEGMENT_LABELS[segment.type]} {segment.percentage.toFixed(0)}
                  % ({formatTokens(segment.tokens)} tokens)
                </text>
              ))}
          </box>

          {/* Pressure Indicator */}
          <box borderStyle="single" padding={1}>
            <text>
              <strong>Compression Progress</strong>
            </text>
            <text>
              {"▰".repeat(Math.floor(compressionPercent / 5))}
              {"▱".repeat(20 - Math.floor(compressionPercent / 5))}
            </text>
            <text>{compressionPercent}% to compaction</text>
          </box>
        </box>
      </box>
    </box>
  );
};
