// Using OpenTUI React, not standard React
import { useEffect, useState, useRef, useCallback } from "react";
import type { HermesApiClient } from "../utils/hermes-api-client";
import type { Message } from "../components/chat/MessageItem";
import {
  readHermesHome,
  type HermesHomeSnapshot,
  type SessionRow,
} from "../utils/hermes-home";
import { FileLink } from "../components/ui/FileLink";

// ─── Types ───────────────────────────────────────────────────────────

interface ContextTabProps {
  description?: string;
  client?: HermesApiClient | null;
  messages?: Message[];
  sessionStart?: number;
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
const GRID_SIZE = 256;
const GRID_COLS = 16;
const THRESHOLD_GOOD = 50;
const THRESHOLD_WARN = 80;
const THRESHOLD_CRITICAL = 95;

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

const estimateTokens = (text: string): number =>
  text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;

const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
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

// ─── Segments ────────────────────────────────────────────────────────

const buildSegments = (
  contextLength: number,
  inputTokens: number,
  home: HermesHomeSnapshot | null,
  messages: Message[],
): GridSegment[] => {
  const segments: GridSegment[] = [];
  const memoryTokens = home?.memory ? estimateTokens(home.memory.content) : 0;
  const userTokens = home?.userProfile ? estimateTokens(home.userProfile.content) : 0;
  const conversationTokens = estimateTokens(
    messages.filter((m) => m.role !== "system").map((m) => m.content).join(""),
  );
  const knownSegments = memoryTokens + userTokens + conversationTokens;
  const systemOverhead = Math.max(0, inputTokens - knownSegments);
  const freeTokens = Math.max(0, contextLength - inputTokens);

  if (systemOverhead > 0)
    segments.push({ id: "system", label: "System & Tools", emoji: "🟦", tokens: systemOverhead, percentage: (systemOverhead / contextLength) * 100 });
  if (memoryTokens + userTokens > 0)
    segments.push({ id: "memory", label: "Memory", emoji: "🟨", tokens: memoryTokens + userTokens, percentage: ((memoryTokens + userTokens) / contextLength) * 100 });
  if (conversationTokens > 0)
    segments.push({ id: "conversation", label: "Conversation", emoji: "🟥", tokens: Math.min(conversationTokens, inputTokens), percentage: (Math.min(conversationTokens, inputTokens) / contextLength) * 100 });
  segments.push({ id: "free", label: "Free", emoji: "⬛", tokens: freeTokens, percentage: (freeTokens / contextLength) * 100 });

  return segments;
};

const generateGrid = (segments: GridSegment[]): GridCell[] => {
  const grid: GridCell[] = [];
  for (const seg of segments) {
    const count = Math.round((seg.percentage / 100) * GRID_SIZE);
    for (let i = 0; i < count; i++) grid.push({ emoji: seg.emoji, segmentId: seg.id });
  }
  while (grid.length < GRID_SIZE) grid.push({ emoji: "⬛", segmentId: "free" });
  return grid.slice(0, GRID_SIZE);
};

// ─── Detail Panels (data-driven from ~/.hermes/) ─────────────────────

const SystemDetail = ({
  home,
  segment,
}: {
  home: HermesHomeSnapshot | null;
  segment: GridSegment;
}) => {
  // Group skills by category
  const skillsByCategory: Record<string, number> = {};
  for (const skill of home?.skills ?? []) {
    const cat = skill.category || "(uncategorized)";
    skillsByCategory[cat] = (skillsByCategory[cat] ?? 0) + 1;
  }
  const sortedCategories = Object.entries(skillsByCategory).sort(
    (a, b) => b[1] - a[1],
  );

  // Tool schema overhead
  const tools = home?.toolsInfo?.tools ?? [];
  const toolChars = tools.reduce(
    (sum: number, t: { descriptionLength: number; paramsLength: number }) =>
      sum + t.descriptionLength + t.paramsLength,
    0,
  );
  const toolTokens = Math.ceil(toolChars / CHARS_PER_TOKEN);

  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong>🟦 System & Tools — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>

      {/* System prompt */}
      {home?.systemPrompt && (
        <>
          <text>
            <strong>System Prompt</strong> — ~{formatTokens(home.systemPrompt.tokenEstimate)} tokens ({home.systemPrompt.totalChars.toLocaleString()} chars)
          </text>
          {home.soul && (
            <box flexDirection="row" height={1}>
              <text>· </text>
              <FileLink source={home.soul.source} />
              <text> — ~{formatTokens(home.soul.tokenEstimate)} tokens ({home.soul.charCount.toLocaleString()} chars)</text>
            </box>
          )}
        </>
      )}
      <text> </text>

      {/* Tools */}
      {tools.length > 0 && (
        <>
          <text>
            <strong>Tools</strong> — {tools.length} registered (~{formatTokens(toolTokens)} tokens in schemas)
          </text>
          {tools.map((t) => (
            <text key={t.name} fg="white">
              · {t.name}
            </text>
          ))}
        </>
      )}
      <text> </text>

      {/* Skills */}
      {(home?.skills ?? []).length > 0 && (
        <>
          <text>
            <strong>Skills</strong> — {home!.skills.length} installed
          </text>
          {sortedCategories.map(([cat, count]) => (
            <text key={cat} fg="white">
              · {cat} ({count})
            </text>
          ))}
        </>
      )}
    </scrollbox>
  );
};

const MemoryDetail = ({
  home,
  segment,
}: {
  home: HermesHomeSnapshot | null;
  segment: GridSegment;
}) => {
  const parseEntries = (content: string | undefined) =>
    (content ?? "").split("§").map((s) => s.trim()).filter(Boolean);

  const memEntries = parseEntries(home?.memory?.content);
  const userEntries = parseEntries(home?.userProfile?.content);

  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong>🟨 Memory — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>

      {home?.memory && (
        <>
          <box flexDirection="row" height={1}>
            <text><strong>Agent Notes</strong> (</text>
            <FileLink source={home.memory.source} />
            <text>) — {formatChars(home.memory.charCount, home.memory.charLimit)} chars ({home.memory.usagePercent}%)</text>
          </box>
          <text>{buildBar(home.memory.usagePercent, 25)}{home.memory.usagePercent >= 95 ? " ⚠ near limit" : ""}</text>
          <text> </text>
          {memEntries.map((entry, i) => (
            <text key={i} fg="white">
              · {entry}
            </text>
          ))}
        </>
      )}
      <text> </text>

      {home?.userProfile && (
        <>
          <box flexDirection="row" height={1}>
            <text><strong>User Profile</strong> (</text>
            <FileLink source={home.userProfile.source} />
            <text>) — {formatChars(home.userProfile.charCount, home.userProfile.charLimit)} chars ({home.userProfile.usagePercent}%)</text>
          </box>
          <text>{buildBar(home.userProfile.usagePercent, 25)}{home.userProfile.usagePercent >= 95 ? " ⚠ near limit" : ""}</text>
          <text> </text>
          {userEntries.map((entry, i) => (
            <text key={i} fg="white">
              · {entry}
            </text>
          ))}
        </>
      )}
      <text> </text>
      <box flexDirection="row" height={1}>
        <text fg="cyan">Provider: {home?.config?.memory?.provider ?? "unknown"}</text>
        {home?.config?.source && (
          <>
            <text> · </text>
            <FileLink source={home.config.source} />
          </>
        )}
      </box>
    </scrollbox>
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
  const assistantTokens = estimateTokens(assistantMsgs.map((m) => m.content).join(""));
  const nonSystem = messages.filter((m) => m.role !== "system");

  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong>🟥 Conversation — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>
      <text>User: {userMsgs.length} messages (~{formatTokens(userTokens)} tokens)</text>
      <text>Assistant: {assistantMsgs.length} messages (~{formatTokens(assistantTokens)} tokens)</text>
      {outputTokens > 0 && (
        <text>Output generated: {formatTokens(outputTokens)} tokens</text>
      )}
      <text> </text>
      {nonSystem.length > 0 && (
        <>
          <text fg="cyan">Messages:</text>
          <text> </text>
          {nonSystem.map((m, i) => {
            const prefix = m.role === "user" ? "▸ You" : "◂ Agent";
            return (
              <text key={i}>
                <span fg={m.role === "user" ? "cyan" : "green"}>{prefix}</span>
                {" "}({formatTokens(estimateTokens(m.content))}) {m.content.replace(/\n/g, " ")}
              </text>
            );
          })}
        </>
      )}
      {nonSystem.length === 0 && (
        <text fg="yellow">No messages yet</text>
      )}
    </scrollbox>
  );
};

const FreeDetail = ({
  segment,
  contextLength,
  compressionThreshold,
  home,
}: {
  segment: GridSegment;
  contextLength: number;
  compressionThreshold: number;
  home: HermesHomeSnapshot | null;
}) => {
  const used = contextLength - segment.tokens;
  const compressionPercent = compressionThreshold > 0
    ? Math.min(100, Math.round((used / compressionThreshold) * 100))
    : 0;
  const comp = home?.config?.compression;

  return (
    <scrollbox borderStyle="single" padding={1} flexGrow={1} scrollY>
      <text>
        <strong>⬛ Free Space — {formatTokens(segment.tokens)} tokens</strong>
      </text>
      <text> </text>
      <text>Context window: {formatTokens(contextLength)}</text>
      <text>Used: {formatTokens(used)} ({Math.round((used / contextLength) * 100)}%)</text>
      <text>Available: {formatTokens(segment.tokens)} ({segment.percentage.toFixed(1)}%)</text>
      <text> </text>
      {comp && (
        <>
          <text><strong>Compression</strong></text>
          <text>{comp.enabled ? "✓ Enabled" : "✗ Disabled"} · threshold {Math.round(comp.threshold * 100)}% ({formatTokens(compressionThreshold)})</text>
          <text>{buildBar(compressionPercent)} {compressionPercent}%</text>
          <text>Protect last {comp.protect_last_n} messages · target ratio {Math.round(comp.target_ratio * 100)}%</text>
          {comp.summary_model && <text>Summary model: {comp.summary_model}</text>}
        </>
      )}
    </scrollbox>
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
  const [wire, setWire] = useState<WireMetrics>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, apiCalls: 0 });
  const wireRef = useRef(wire);
  const [hoveredSegment, setHoveredSegment] = useState<SegmentId | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SegmentId | null>(null);

  // Read ~/.hermes/
  const refreshHome = useCallback(async () => {
    try { setHome(await readHermesHome()); } catch { /* show what we have */ }
  }, []);

  useEffect(() => {
    refreshHome();
    const interval = setInterval(refreshHome, 10_000);
    return () => clearInterval(interval);
  }, [refreshHome]);

  // Wire metrics from SSE
  useEffect(() => {
    if (!client) return;
    const onDone = (data: { reason: string; usage?: TokenUsage }) => {
      if (!data.usage) return;
      const updated: WireMetrics = {
        inputTokens: wireRef.current.inputTokens + data.usage.prompt_tokens,
        outputTokens: wireRef.current.outputTokens + data.usage.completion_tokens,
        totalTokens: wireRef.current.totalTokens + data.usage.total_tokens,
        apiCalls: wireRef.current.apiCalls + 1,
      };
      wireRef.current = updated;
      setWire(updated);
    };
    client.on("done", onDone);
    return () => { client.removeListener("done", onDone); };
  }, [client]);

  // Derived values
  const modelName = home?.config?.model?.default ?? "unknown";
  const contextLength = resolveContextLength(modelName);
  const compressionThreshold = Math.round(
    contextLength * (home?.config?.compression?.threshold ?? 0.5),
  );

  const latestDbSession: SessionRow | undefined = home?.recentSessions?.[0];
  const inputTokens = wire.apiCalls > 0 ? wire.inputTokens : (latestDbSession?.input_tokens ?? 0);
  const outputTokens = wire.apiCalls > 0 ? wire.outputTokens : (latestDbSession?.output_tokens ?? 0);
  const usagePercent = contextLength > 0 ? Math.round((inputTokens / contextLength) * 100) : 0;

  const status = getUsageStatus(usagePercent);
  const segments = buildSegments(contextLength, inputTokens, home, messages);
  const grid = generateGrid(segments);
  const elapsed = sessionStart ? Date.now() - sessionStart : 0;
  const messageCount = messages.filter((m) => m.role !== "system").length;
  const hasWireData = wire.apiCalls > 0;
  const gatewayConnected = home?.gateway?.platforms?.api_server?.state === "connected";

  const findSegment = (id: SegmentId) => segments.find((s) => s.id === id);

  // Detail panel router
  const renderDetailPanel = () => {
    if (!selectedSegment) return null;
    const seg = findSegment(selectedSegment);
    if (!seg) return null;
    switch (selectedSegment) {
      case "system": return <SystemDetail home={home} segment={seg} />;
      case "memory": return <MemoryDetail home={home} segment={seg} />;
      case "conversation": return <ConversationDetail segment={seg} messages={messages} outputTokens={outputTokens} />;
      case "free": return <FreeDetail segment={seg} contextLength={contextLength} compressionThreshold={compressionThreshold} home={home} />;
    }
  };

  // Overview panels
  const renderOverview = () => (
    <>
      <box borderStyle="single" padding={1} marginBottom={1}>
        <text><strong>Breakdown</strong><span fg="cyan"> (click grid to inspect)</span></text>
        {segments.filter((s) => s.tokens > 0).map((s) => (
          <text key={s.id}>{s.emoji} {s.label} — {formatTokens(s.tokens)} ({s.percentage.toFixed(1)}%)</text>
        ))}
        {outputTokens > 0 && <text fg="green">🟩 Output — {formatTokens(outputTokens)} tokens</text>}
      </box>

      {home?.memory && home?.userProfile && (
        <box borderStyle="single" padding={1} marginBottom={1}>
          <text><strong>Memory</strong></text>
          <text>Notes: {formatChars(home.memory.charCount, home.memory.charLimit)} ({home.memory.usagePercent}%){home.memory.usagePercent >= 95 ? " ⚠" : ""}</text>
          <text>Profile: {formatChars(home.userProfile.charCount, home.userProfile.charLimit)} ({home.userProfile.usagePercent}%){home.userProfile.usagePercent >= 95 ? " ⚠" : ""}</text>
        </box>
      )}

      <box borderStyle="single" padding={1}>
        <text><strong>Session</strong></text>
        <text>
          {modelName.split("/").pop()} · <span fg={status.color}>{status.label}</span>
          {" · "}<span fg={gatewayConnected ? "green" : "red"}>{gatewayConnected ? "●" : "○"} gateway</span>
        </text>
        <text>
          API: {wire.apiCalls} · Msgs: {messageCount}
          {elapsed > 0 ? ` · ${formatDuration(elapsed)}` : ""}
          {" · "}Skills: {home?.skills?.length ?? "?"}
        </text>
      </box>
    </>
  );

  return (
    <box flexGrow={1} flexDirection="column" padding={1}>
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <strong>Context Window</strong>
          <span> {formatTokens(inputTokens)} / {formatTokens(contextLength)} ({usagePercent}%)</span>
          {selectedSegment && <span fg="cyan"> · viewing {findSegment(selectedSegment)?.label} · click grid to close</span>}
          {!selectedSegment && !hasWireData && !latestDbSession && <span fg="yellow"> [awaiting first response]</span>}
          {!selectedSegment && !hasWireData && latestDbSession && <span fg="cyan"> [from last session]</span>}
        </text>
      </box>

      {/* Grid + right panel */}
      <box flexDirection="row">
        <box borderStyle="single" paddingTop={1} paddingX={2} marginRight={2}>
          {[...Array(GRID_COLS)].map((_, row) => (
            <box key={row} flexDirection="row" height={1}>
              {[...Array(GRID_COLS)].map((_, col) => {
                const idx = row * GRID_COLS + col;
                const cell = grid[idx];
                const highlight = hoveredSegment === cell.segmentId || selectedSegment === cell.segmentId;
                return (
                  <box
                    key={col}
                    backgroundColor={highlight ? SEGMENT_HIGHLIGHT[cell.segmentId] : undefined}
                    onMouseOver={() => setHoveredSegment(cell.segmentId)}
                    onMouseOut={() => setHoveredSegment(null)}
                    onMouseDown={() => setSelectedSegment(selectedSegment === cell.segmentId ? null : cell.segmentId)}
                  >
                    <text>{cell.emoji}</text>
                  </box>
                );
              })}
            </box>
          ))}
        </box>

        <box flexDirection="column" flexGrow={1}>
          {selectedSegment ? renderDetailPanel() : renderOverview()}
        </box>
      </box>
    </box>
  );
};
