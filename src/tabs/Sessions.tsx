import { useState, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import {
  queryRecentSessions,
  type SessionRow,
} from "../utils/hermes-home";
import { useTheme } from "../theme";

// ─── Formatting Helpers ──────────────────────────────────────────────

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatCost = (cost: number | null): string => {
  if (cost === null) return "—";
  return `$${cost.toFixed(2)}`;
};

const formatSourceBadge = (src: string): string => {
  const MAP: Record<string, string> = {
    cli: "CLI",
    api_server: "API",
    discord: "Discord",
    telegram: "Telegram",
    slack: "Slack",
    whatsapp: "WhatsApp",
    signal: "Signal",
  };
  return MAP[src] ?? src;
};

const formatDate = (ts: number): string => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString();
};

const formatTime = (ts: number): string => {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

const formatDuration = (start: number, end: number | null): string => {
  if (!end) return "ongoing";
  const secs = end - start;
  if (secs < 0) return "—";
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
};

const formatDateTime = (ts: number): string => {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
};

const truncate = (s: string, max: number): string => {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
};

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel = (props: { session: SessionRow }) => {
  const { theme } = useTheme();
  const s = props.session;

  const rows: Array<{ label: string; value: string }> = [
    { label: "ID", value: s.id },
    { label: "Model", value: s.model ?? "—" },
    { label: "Source", value: formatSourceBadge(s.sessionSource) },
    { label: "Started", value: formatDateTime(s.started_at) },
    { label: "Ended", value: s.ended_at ? formatDateTime(s.ended_at) : "ongoing" },
    { label: "Duration", value: formatDuration(s.started_at, s.ended_at) },
    { label: "End Reason", value: s.end_reason ?? "—" },
    { label: "Messages", value: String(s.message_count) },
    { label: "Tool Calls", value: String(s.tool_call_count) },
    { label: "Input", value: `${formatTokens(s.input_tokens)} tokens` },
    { label: "Output", value: `${formatTokens(s.output_tokens)} tokens` },
    { label: "Cache Read", value: `${formatTokens(s.cache_read_tokens)} tokens` },
    { label: "Cache Write", value: `${formatTokens(s.cache_write_tokens)} tokens` },
    { label: "Reasoning", value: `${formatTokens(s.reasoning_tokens)} tokens` },
    { label: "Cost", value: formatCost(s.estimated_cost_usd) },
  ];

  if (s.parent_session_id) {
    rows.push({ label: "Parent", value: s.parent_session_id });
  }

  return (
    <box
      flexDirection="column"
      padding={1}
      border
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      width="40%"
    >
      <text>
        <span fg={theme.primary}>
          <strong>Session Detail</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.accent}>
          <strong>{s.title ?? "Untitled"}</strong>
        </span>
      </text>
      <text> </text>
      {rows.map((row) => (
        <text key={row.label}>
          <span fg={theme.textMuted}>{`${row.label.padEnd(13)}`}</span>
          <span fg={theme.text}>{` ${row.value}`}</span>
        </text>
      ))}
    </box>
  );
};

// ─── Empty State ─────────────────────────────────────────────────────

const EmptyState = () => {
  const { theme } = useTheme();
  return (
    <box flexGrow={1} padding={2}>
      <text>
        <span fg={theme.textMuted}>No sessions found in state.db</span>
      </text>
    </box>
  );
};

// ─── Session Row ─────────────────────────────────────────────────────

const SessionItem = (props: {
  session: SessionRow;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const { theme } = useTheme();
  const s = props.session;
  const title = truncate(s.title ?? "Untitled", 30);
  const badge = formatSourceBadge(s.sessionSource);
  const time = formatTime(s.started_at);
  const cost = formatCost(s.estimated_cost_usd);

  const bg = props.selected ? theme.backgroundElement : undefined;
  const indicator = props.selected ? "▸ " : "  ";

  return (
    <box
      backgroundColor={bg}
      onMouseDown={props.onSelect}
      onMouseOver={props.onHover}
    >
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>
          {indicator}
        </span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {title.padEnd(32)}
        </span>
        <span fg={theme.info}>{` ${badge.padEnd(9)}`}</span>
        <span fg={theme.textMuted}>{` ${time}`}</span>
        <span fg={theme.textMuted}>{` │ ${String(s.message_count).padStart(3)} msgs`}</span>
        <span fg={theme.textMuted}>{` │ ${String(s.tool_call_count).padStart(3)} tools`}</span>
        <span fg={theme.success}>{` │ ${cost.padStart(7)}`}</span>
      </text>
    </box>
  );
};

// ─── Main Component ──────────────────────────────────────────────────

export const Sessions = () => {
  const { theme } = useTheme();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState(0);

  const load = useCallback(() => {
    const rows = queryRecentSessions(50);
    setSessions(rows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useKeyboard((key) => {
    if (key.name === "up") {
      setSelected((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.name === "down") {
      setSelected((prev) => Math.min(sessions.length - 1, prev + 1));
      return;
    }
    if (key.name === "r") {
      load();
      return;
    }
  });

  if (sessions.length === 0) return <EmptyState />;

  const current = sessions[selected];

  return (
    <box flexDirection="row" flexGrow={1}>
      <box
        flexDirection="column"
        flexGrow={1}
        border
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        padding={1}
      >
        <text>
          <span fg={theme.primary}>
            <strong>{`Sessions (${sessions.length})`}</strong>
          </span>
          <span fg={theme.textMuted}>{`  ↑↓ navigate  r refresh`}</span>
        </text>
        <text> </text>
        <scrollbox scrollY>
          {sessions.map((s, i) => (
            <SessionItem
              key={s.id}
              session={s}
              selected={i === selected}
              onSelect={() => setSelected(i)}
              onHover={() => setSelected(i)}
            />
          ))}
        </scrollbox>
      </box>

      {current ? <DetailPanel session={current} /> : null}
    </box>
  );
};
