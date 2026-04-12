// Using OpenTUI React, not standard React
import { useEffect, useState, useRef, useCallback } from "react";
import type { HermesApiClient } from "../utils/hermes-api-client";
import type { Message } from "../components/chat/MessageItem";
import {
  readHermesHome,
  type HermesHomeSnapshot,
  type SessionRow,
} from "../utils/hermes-home";

// ─── Types ───────────────────────────────────────────────────────────

interface ContextTabProps {
  description?: string;
  client?: HermesApiClient | null;
  messages?: Message[];
  sessionStart?: number; // epoch ms
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface WireMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiCalls: number;
}

type SegmentId = "system" | "memory" | "conversation" | "free";

interface GridSegment {
  id: SegmentId;
  label: string;
  emoji: string;
  tokens: number;
  percentage: number;
}

/** A cell in the grid knows which segment it belongs to */
interface GridCell {
  emoji: string;
  segmentId: SegmentId;
}

// ─── Constants ───────────────────────────────────────────────────────

const MODEL_CONTEXT_LENGTHS: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude": 200_000,
  "gpt-4.1": 1_047_576,
  "gpt-4o": 128_000,
  "gpt-4": 128_000,
  "gemini": 1_048_576,
  "deepseek": 128_000,
  "llama": 131_072,
  "qwen": 131_072,
};

const DEFAULT_CONTEXT_LENGTH = 128_000;
const CHARS_PER_TOKEN = 4;
const GRID_SIZE = 256; // 16x16
const GRID_COLS = 16;

const THRESHOLD_GOOD = 50;
const THRESHOLD_WARN = 80;
const THRESHOLD_CRITICAL = 95;

const COMPRESSION_THRESHOLD_RATIO = 0.5;

/** Background colors for hover highlight per segment */
const SEGMENT_HIGHLIGHT: Record<SegmentId, string> = {
  system: "#1a3a5c",
  memory: "#5c4a1a",
  conversation: "#5c1a1a",
  free: "#1a1a1a",
};

// ─── Utilities ───────────────────────────────────────────────────────

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
};

const formatChars = (count: number, limit: number): string =>
  `${count.toLocaleString()} / ${limit.toLocaleString()}`;

const resolveContextLength = (model: string): number => {
  const lower = model.toLowerCase();
  const bare = lower.includes("/") ? lower.split("/").pop()! : lower;
  if (MODEL_CONTEXT_LENGTHS[bare]) return MODEL_CONTEXT_LENGTHS[bare];
  for (const [key, value] of Object.entries(MODEL_CONTEXT_LENGTHS)) {
    if (bare.startsWith(key)) return value;
  }
  return DEFAULT_CONTEXT_LENGTH;
};

const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
};

const buildBar = (percent: number, width: number = 20): string => {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round((safe / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}]`;
};

const getUsageStatus = (
  percent: number,
): { label: string; color: string } => {
  if (percent >= THRESHOLD_CRITICAL) return { label: "CRITICAL", color: "red" };
  if (percent >= THRESHOLD_WARN) return { label: "HIGH", color: "red" };
  if (percent >= THRESHOLD_GOOD) return { label: "MODERATE", color: "yellow" };
  return { label: "HEALTHY", color: "green" };
};

// ─── Segment Builder ─────────────────────────────────────────────────

const buildSegments = (
  contextLength: number,
  inputTokens: number,
  home: HermesHomeSnapshot | null,
  messages: Message[],
): GridSegment[] => {
  const segments: GridSegment[] = [];

  const memoryTokens = home?.memory ? estimateTokens(home.memory.content) : 0;
  const userTokens = home?.userProfile
    ? estimateTokens(home.userProfile.content)
    : 0;
  const conversationTokens = estimateTokens(
    messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join(""),
  );

  const knownSegments = memoryTokens + userTokens + conversationTokens;
  const systemOverhead = Math.max(0, inputTokens - knownSegments);
  const freeTokens = Math.max(0, contextLength - inputTokens);

  if (systemOverhead > 0) {
    segments.push({
      id: "system",
      label: "System & Tools",
      emoji: "🟦",
      tokens: systemOverhead,
      percentage: (systemOverhead / contextLength) * 100,
    });
  }

  if (memoryTokens + userTokens > 0) {
    segments.push({
      id: "memory",
      label: "Memory",
      emoji: "🟨",
      tokens: memoryTokens + userTokens,
      percentage: ((memoryTokens + userTokens) / contextLength) * 100,
    });
  }

  if (conversationTokens > 0) {
    segments.push({
      id: "conversation",
      label: "Conversation",
      emoji: "🟥",
      tokens: Math.min(conversationTokens, inputTokens),
      percentage:
        (Math.min(conversationTokens, inputTokens) / contextLength) * 100,
    });
  }

  segments.push({
    id: "free",
    label: "Free",
    emoji: "⬛",
    tokens: freeTokens,
    percentage: (freeTokens / contextLength) * 100,
  });

  return segments;
};

/** Generate grid cells with segment ownership */
const generateGrid = (segments: GridSegment[]): GridCell[] => {
  const grid: GridCell[] = [];
  for (const seg of segments) {
    const count = Math.round((seg.percentage / 100) * GRID_SIZE);
    for (let i = 0; i < count; i++)
      grid.push({ emoji: seg.emoji, segmentId: seg.id });
  }
  while (grid.length < GRID_SIZE)
    grid.push({ emoji: "⬛", segmentId: "free" });
  return grid.slice(0, GRID_SIZE);
};

// ─── Detail Panels (zoom view for each segment) ─────────────────────

const SystemDetail = ({
  home,
  segment,
}: {
  home: HermesHomeSnapshot | null;
  segment: GridSegment;
}) => (
  <box borderStyle="single" padding={1} flexGrow={1}>
    <text>
      <strong>🟦 System & Tools — {formatTokens(segment.tokens)} tokens</strong>
    </text>
    <text> </text>
    <text>
      This is everything injected before your conversation:
    </text>
    <text> </text>
    <text>
      SOUL.md{" "} — core personality & instructions
    </text>
    <text>
      Skills list — {home?.skillCount ?? "?"} skills cataloged in prompt
    </text>
    <text>
      Tool schemas — definitions for all enabled toolsets
    </text>
    <text>
      Context files — AGENTS.md, project context
    </text>
    <text> </text>
    <text fg="cyan">
      This overhead is present on every API call. It's the "fixed cost"
      of the agent's capabilities.
    </text>
    <text> </text>
    <text>
      Model: {home?.config?.model?.default ?? "unknown"}
    </text>
    <text>
      Max turns: {home?.config?.agent?.max_turns ?? "?"}
    </text>
    <text>
      Reasoning: {home?.config?.agent?.reasoning_effort ?? "?"}
    </text>
    <text>
      Personality: {home?.config?.display?.personality ?? "default"}
    </text>
  </box>
);

const MemoryDetail = ({
  home,
  segment,
}: {
  home: HermesHomeSnapshot | null;
  segment: GridSegment;
}) => {
  const mem = home?.memory;
  const user = home?.userProfile;

  // Parse § delimited entries
  const memEntries = mem?.content
    .split("§")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
  const userEntries = user?.content
    .split("§")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

  return (
    <box borderStyle="single" padding={1} flexGrow={1}>
      <text>
        <strong>🟨 Memory — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>
      {mem && (
        <>
          <text>
            <strong>Agent Notes</strong> —{" "}
            {formatChars(mem.charCount, mem.charLimit)} chars ({mem.usagePercent}
            %)
          </text>
          <text>{buildBar(mem.usagePercent, 25)}</text>
          <text> </text>
          {memEntries.slice(0, 8).map((entry, i) => (
            <text key={i} fg="white">
              · {entry.length > 70 ? entry.slice(0, 67) + "..." : entry}
            </text>
          ))}
          {memEntries.length > 8 && (
            <text fg="cyan">  ...and {memEntries.length - 8} more entries</text>
          )}
        </>
      )}
      <text> </text>
      {user && (
        <>
          <text>
            <strong>User Profile</strong> —{" "}
            {formatChars(user.charCount, user.charLimit)} chars (
            {user.usagePercent}%)
          </text>
          <text>{buildBar(user.usagePercent, 25)}</text>
          <text> </text>
          {userEntries.slice(0, 6).map((entry, i) => (
            <text key={i} fg="white">
              · {entry.length > 70 ? entry.slice(0, 67) + "..." : entry}
            </text>
          ))}
          {userEntries.length > 6 && (
            <text fg="cyan">  ...and {userEntries.length - 6} more entries</text>
          )}
        </>
      )}
      <text> </text>
      <text fg="cyan">
        Memory provider: {home?.config?.memory?.provider ?? "file"}
      </text>
    </box>
  );
};

const ConversationDetail = ({
  segment,
  messages,
  outputTokens,
}: {
  segment: GridSegment;
  messages: Message[];
  outputTokens: number;
}) => {
  const userMsgs = messages.filter((m) => m.role === "user");
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const userTokens = estimateTokens(userMsgs.map((m) => m.content).join(""));
  const assistantTokens = estimateTokens(
    assistantMsgs.map((m) => m.content).join(""),
  );

  return (
    <box borderStyle="single" padding={1} flexGrow={1}>
      <text>
        <strong>
          🟥 Conversation — {formatTokens(segment.tokens)} tokens
        </strong>
      </text>
      <text> </text>
      <text>
        User messages: {userMsgs.length} (~{formatTokens(userTokens)} tokens)
      </text>
      <text>
        Assistant messages: {assistantMsgs.length} (~
        {formatTokens(assistantTokens)} tokens)
      </text>
      {outputTokens > 0 && (
        <text>
          Output generated: {formatTokens(outputTokens)} tokens (not in context)
        </text>
      )}
      <text> </text>
      <text fg="cyan">Recent messages:</text>
      <text> </text>
      {messages
        .filter((m) => m.role !== "system")
        .slice(-10)
        .map((m, i) => {
          const prefix = m.role === "user" ? "▸ You" : "◂ Agent";
          const preview =
            m.content.length > 60
              ? m.content.slice(0, 57) + "..."
              : m.content;
          const tokens = estimateTokens(m.content);
          return (
            <text key={i}>
              <span fg={m.role === "user" ? "cyan" : "green"}>{prefix}</span>
              {" "}({formatTokens(tokens)}) {preview.replace(/\n/g, " ")}
            </text>
          );
        })}
      {messages.filter((m) => m.role !== "system").length > 10 && (
        <text fg="cyan">
          ...{messages.filter((m) => m.role !== "system").length - 10} earlier
          messages
        </text>
      )}
    </box>
  );
};

const FreeDetail = ({
  segment,
  contextLength,
  compressionThreshold,
  compressionConfig,
}: {
  segment: GridSegment;
  contextLength: number;
  compressionThreshold: number;
  compressionConfig: { enabled: boolean; threshold: number; protect_last_n: number; summary_model: string };
}) => {
  const compressionPercent = compressionThreshold > 0
    ? Math.min(100, Math.round(((contextLength - segment.tokens) / compressionThreshold) * 100))
    : 0;

  return (
    <box borderStyle="single" padding={1} flexGrow={1}>
      <text>
        <strong>⬛ Free Space — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>
      <text>
        Context window: {formatTokens(contextLength)}
      </text>
      <text>
        Used: {formatTokens(contextLength - segment.tokens)} ({Math.round(((contextLength - segment.tokens) / contextLength) * 100)}%)
      </text>
      <text>
        Available: {formatTokens(segment.tokens)} ({segment.percentage.toFixed(1)}%)
      </text>
      <text> </text>
      <text>
        <strong>Compression</strong>
      </text>
      <text>
        {compressionConfig.enabled ? "✓ Enabled" : "✗ Disabled"} · triggers at{" "}
        {Math.round(compressionConfig.threshold * 100)}% ({formatTokens(compressionThreshold)})
      </text>
      <text>
        Progress: {buildBar(compressionPercent)} {compressionPercent}%
      </text>
      <text>
        Protects last {compressionConfig.protect_last_n} messages
      </text>
      {compressionConfig.summary_model && (
        <text>
          Summary model: {compressionConfig.summary_model}
        </text>
      )}
      <text> </text>
      <text fg="cyan">
        {compressionPercent < 50
          ? "Plenty of room. Context is healthy."
          : compressionPercent < 80
            ? "Getting fuller. Compression will trigger soon."
            : compressionPercent < 100
              ? "⚠ Approaching compression threshold."
              : "⚠ Past threshold — compression should have fired."}
      </text>
    </box>
  );
};

// ─── Main Component ──────────────────────────────────────────────────

export const Context = ({
  description,
  client,
  messages = [],
  sessionStart,
}: ContextTabProps) => {
  const [home, setHome] = useState<HermesHomeSnapshot | null>(null);
  const [wire, setWire] = useState<WireMetrics>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    apiCalls: 0,
  });
  const wireRef = useRef(wire);
  const [hoveredSegment, setHoveredSegment] = useState<SegmentId | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SegmentId | null>(null);

  // ─── Read ~/.hermes/ ─────────────────────────────────────────────

  const refreshHome = useCallback(async () => {
    try {
      setHome(await readHermesHome());
    } catch {
      // show what we have
    }
  }, []);

  useEffect(() => {
    refreshHome();
    const interval = setInterval(refreshHome, 10_000);
    return () => clearInterval(interval);
  }, [refreshHome]);

  // ─── Wire metrics from SSE ───────────────────────────────────────

  useEffect(() => {
    if (!client) return;
    const onDone = (data: { reason: string; usage?: TokenUsage }) => {
      if (!data.usage) return;
      const updated: WireMetrics = {
        inputTokens: wireRef.current.inputTokens + data.usage.prompt_tokens,
        outputTokens:
          wireRef.current.outputTokens + data.usage.completion_tokens,
        totalTokens: wireRef.current.totalTokens + data.usage.total_tokens,
        apiCalls: wireRef.current.apiCalls + 1,
      };
      wireRef.current = updated;
      setWire(updated);
    };
    client.on("done", onDone);
    return () => {
      client.removeListener("done", onDone);
    };
  }, [client]);

  // ─── Derived values ──────────────────────────────────────────────

  const modelName = home?.config?.model?.default ?? "unknown";
  const contextLength = resolveContextLength(modelName);
  const compressionConfig = home?.config?.compression ?? {
    enabled: true,
    threshold: 0.5,
    target_ratio: 0.2,
    protect_last_n: 20,
    summary_model: "",
  };
  const compressionThreshold = Math.round(
    contextLength * compressionConfig.threshold,
  );

  const latestDbSession: SessionRow | undefined = home?.recentSessions?.[0];
  const inputTokens =
    wire.apiCalls > 0
      ? wire.inputTokens
      : (latestDbSession?.input_tokens ?? 0);
  const outputTokens =
    wire.apiCalls > 0
      ? wire.outputTokens
      : (latestDbSession?.output_tokens ?? 0);

  const usagePercent =
    contextLength > 0
      ? Math.round((inputTokens / contextLength) * 100)
      : 0;

  const status = getUsageStatus(usagePercent);
  const segments = buildSegments(contextLength, inputTokens, home, messages);
  const grid = generateGrid(segments);
  const elapsed = sessionStart ? Date.now() - sessionStart : 0;
  const messageCount = messages.filter((m) => m.role !== "system").length;
  const hasWireData = wire.apiCalls > 0;

  const gatewayConnected =
    home?.gateway?.platforms?.api_server?.state === "connected";

  // Find segment by id
  const findSegment = (id: SegmentId): GridSegment | undefined =>
    segments.find((s) => s.id === id);

  // ─── Render detail panel for selected segment ────────────────────

  const renderDetailPanel = () => {
    if (!selectedSegment) return null;
    const seg = findSegment(selectedSegment);
    if (!seg) return null;

    switch (selectedSegment) {
      case "system":
        return <SystemDetail home={home} segment={seg} />;
      case "memory":
        return <MemoryDetail home={home} segment={seg} />;
      case "conversation":
        return (
          <ConversationDetail
            segment={seg}
            messages={messages}
            outputTokens={outputTokens}
          />
        );
      case "free":
        return (
          <FreeDetail
            segment={seg}
            contextLength={contextLength}
            compressionThreshold={compressionThreshold}
            compressionConfig={compressionConfig}
          />
        );
      default:
        return null;
    }
  };

  // ─── Render overview panels (when no segment selected) ───────────

  const renderOverviewPanels = () => (
    <>
      {/* Breakdown Legend */}
      <box borderStyle="single" padding={1} marginBottom={1}>
        <text>
          <strong>Breakdown</strong>
          <span fg="cyan"> (click grid to inspect)</span>
        </text>
        {segments
          .filter((s) => s.tokens > 0)
          .map((s) => (
            <text key={s.id}>
              {s.emoji} {s.label} — {formatTokens(s.tokens)} (
              {s.percentage.toFixed(1)}%)
            </text>
          ))}
        {outputTokens > 0 && (
          <text fg="green">
            🟩 Output — {formatTokens(outputTokens)} tokens
          </text>
        )}
      </box>

      {/* Memory */}
      {home?.memory && home?.userProfile && (
        <box borderStyle="single" padding={1} marginBottom={1}>
          <text>
            <strong>Memory</strong>
          </text>
          <text>
            Notes: {formatChars(home.memory.charCount, home.memory.charLimit)}{" "}
            ({home.memory.usagePercent}%)
            {home.memory.usagePercent >= 95 ? " ⚠" : ""}
          </text>
          <text>
            Profile:{" "}
            {formatChars(home.userProfile.charCount, home.userProfile.charLimit)}{" "}
            ({home.userProfile.usagePercent}%)
            {home.userProfile.usagePercent >= 95 ? " ⚠" : ""}
          </text>
        </box>
      )}

      {/* Session */}
      <box borderStyle="single" padding={1}>
        <text>
          <strong>Session</strong>
        </text>
        <text>
          {modelName.split("/").pop()} · <span fg={status.color}>{status.label}</span>
          {" · "}
          <span fg={gatewayConnected ? "green" : "red"}>
            {gatewayConnected ? "●" : "○"} gateway
          </span>
        </text>
        <text>
          API: {wire.apiCalls} · Msgs: {messageCount}
          {elapsed > 0 ? ` · ${formatDuration(elapsed)}` : ""}
          {" · "}Skills: {home?.skillCount ?? "?"}
        </text>
      </box>
    </>
  );

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <box flexGrow={1} flexDirection="column" padding={1}>
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <strong>Context Window</strong>
          <span>
            {" "}
            {formatTokens(inputTokens)} / {formatTokens(contextLength)} ({usagePercent}%)
          </span>
          {selectedSegment && (
            <span fg="cyan"> · viewing {findSegment(selectedSegment)?.label ?? selectedSegment} · click grid to close</span>
          )}
          {!selectedSegment && !hasWireData && !latestDbSession && (
            <span fg="yellow"> [awaiting first response]</span>
          )}
          {!selectedSegment && !hasWireData && latestDbSession && (
            <span fg="cyan"> [from last session]</span>
          )}
        </text>
      </box>

      {/* Main layout */}
      <box flexDirection="row">
        {/* Grid - 16x16 interactive */}
        <box borderStyle="single" paddingTop={1} paddingX={2} marginRight={2}>
          {[...Array(GRID_COLS)].map((_, row) => (
            <box key={row} flexDirection="row" height={1}>
              {[...Array(GRID_COLS)].map((_, col) => {
                const idx = row * GRID_COLS + col;
                const cell = grid[idx];
                const isHovered =
                  hoveredSegment !== null &&
                  cell.segmentId === hoveredSegment;
                const isSelected =
                  selectedSegment !== null &&
                  cell.segmentId === selectedSegment;

                return (
                  <box
                    key={col}
                    backgroundColor={
                      isSelected
                        ? SEGMENT_HIGHLIGHT[cell.segmentId]
                        : isHovered
                          ? SEGMENT_HIGHLIGHT[cell.segmentId]
                          : undefined
                    }
                    onMouseOver={() => setHoveredSegment(cell.segmentId)}
                    onMouseOut={() => setHoveredSegment(null)}
                    onMouseDown={() =>
                      setSelectedSegment(
                        selectedSegment === cell.segmentId
                          ? null
                          : cell.segmentId,
                      )
                    }
                  >
                    <text>{cell.emoji}</text>
                  </box>
                );
              })}
            </box>
          ))}
        </box>

        {/* Right panel — detail or overview */}
        <box flexDirection="column" flexGrow={1}>
          {selectedSegment ? renderDetailPanel() : renderOverviewPanels()}
        </box>
      </box>
    </box>
  );
};
