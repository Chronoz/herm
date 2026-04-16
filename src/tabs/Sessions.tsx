import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useKeyboard } from "@opentui/react";
import {
  queryRecentSessions,
  querySessionMessages,
  searchSessions,
  deleteSession,
  type SessionRow,
  type MessageRow,
  type SearchResult,
} from "../utils/hermes-home";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { invalidate } from "../utils/cache";

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

const timeAgo = (ts: number): string => {
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel = memo((props: { session: SessionRow }) => {
  const theme = useTheme().theme;
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
});

// ─── Search Detail Panel ─────────────────────────────────────────────

const SearchDetailPanel = memo((props: { result: SearchResult }) => {
  const theme = useTheme().theme;
  const r = props.result;

  // Render snippet with >>> <<< markers as highlights
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let rest = r.snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(">>>");
    if (start === -1) {
      parts.push({ text: rest, highlight: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), highlight: false });
    const end = rest.indexOf("<<<", start + 3);
    if (end === -1) {
      parts.push({ text: rest.slice(start + 3), highlight: true });
      break;
    }
    parts.push({ text: rest.slice(start + 3, end), highlight: true });
    rest = rest.slice(end + 3);
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
          <strong>Search Match</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.accent}>
          <strong>{r.title ?? "Untitled"}</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Source".padEnd(13)}</span>
        <span fg={theme.info}>{` ${formatSourceBadge(r.sessionSource)}`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Model".padEnd(13)}</span>
        <span fg={theme.text}>{` ${r.model ?? "—"}`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Time".padEnd(13)}</span>
        <span fg={theme.text}>{` ${formatDateTime(r.started_at)}`}</span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>Snippet:</span>
      </text>
      <text wrapMode="word">
        {parts.map((p, i) =>
          p.highlight ? (
            <span key={i} fg={theme.accent}>
              <strong>{p.text}</strong>
            </span>
          ) : (
            <span key={i} fg={theme.text}>
              {p.text}
            </span>
          ),
        )}
      </text>
    </box>
  );
});

// ─── Empty State ─────────────────────────────────────────────────────

const EmptyState = memo((props: { searching: boolean }) => {
  const theme = useTheme().theme;
  return (
    <box flexGrow={1} padding={2}>
      <text>
        <span fg={theme.textMuted}>
          {props.searching
            ? "No matching sessions found"
            : "No sessions found in state.db"}
        </span>
      </text>
    </box>
  );
});

// ─── Confirm Delete Dialog ───────────────────────────────────────────

const ConfirmDelete = (props: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const theme = useTheme().theme;
  const [hover, setHover] = useState<"yes" | "no" | null>(null);

  useKeyboard((key) => {
    if (key.name === "y") props.onConfirm();
    if (key.name === "n" || key.name === "escape") props.onCancel();
  });

  return (
    <box flexDirection="column" width={50}>
      <text>
        <span fg={theme.warning}>
          <strong>Delete Session?</strong>
        </span>
      </text>
      <text> </text>
      <text wrapMode="word">
        <span fg={theme.text}>{truncate(props.title, 46)}</span>
      </text>
      <text> </text>
      <box flexDirection="row" gap={2}>
        <box
          onMouseDown={props.onConfirm}
          onMouseOver={() => setHover("yes")}
          onMouseOut={() => setHover(null)}
        >
          <text>
            <span fg={hover === "yes" ? theme.error : theme.textMuted}>
              {hover === "yes" ? "▸ " : "  "}
            </span>
            <span fg={hover === "yes" ? theme.error : theme.text}>
              {"[y] Delete"}
            </span>
          </text>
        </box>
        <box
          onMouseDown={props.onCancel}
          onMouseOver={() => setHover("no")}
          onMouseOut={() => setHover(null)}
        >
          <text>
            <span fg={hover === "no" ? theme.accent : theme.textMuted}>
              {hover === "no" ? "▸ " : "  "}
            </span>
            <span fg={hover === "no" ? theme.accent : theme.text}>
              {"[n] Cancel"}
            </span>
          </text>
        </box>
      </box>
    </box>
  );
};

// ─── Session Row ─────────────────────────────────────────────────────

const SessionItem = memo((props: {
  session: SessionRow;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  onDelete: () => void;
}) => {
  const theme = useTheme().theme;
  const s = props.session;
  const title = truncate(s.title ?? "Untitled", 30);
  const badge = formatSourceBadge(s.sessionSource);
  const time = formatTime(s.started_at);
  const cost = formatCost(s.estimated_cost_usd);
  const [xHover, setXHover] = useState(false);

  const bg = props.selected ? theme.backgroundElement : undefined;
  const indicator = props.selected ? "▸ " : "  ";

  return (
    <box
      flexDirection="row"
      backgroundColor={bg}
      onMouseDown={props.onSelect}
      onMouseOver={props.onHover}
    >
      <box flexGrow={1}>
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
      <box
        width={3}
        onMouseDown={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        onMouseOver={() => setXHover(true)}
        onMouseOut={() => setXHover(false)}
      >
        <text>
          <span fg={xHover ? theme.error : theme.textMuted}>
            {" ✕"}
          </span>
        </text>
      </box>
    </box>
  );
});

// ─── Search Result Row ───────────────────────────────────────────────

const SearchItem = memo((props: {
  result: SearchResult;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const r = props.result;
  const title = truncate(r.title ?? "Untitled", 30);
  const badge = formatSourceBadge(r.sessionSource);
  const ago = timeAgo(r.started_at);

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
        <span fg={theme.textMuted}>{` ${ago.padEnd(10)}`}</span>
        <span fg={theme.textMuted}>{` ${r.model ?? "—"}`}</span>
      </text>
    </box>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

type SessionsProps = {
  onSwitch?: (sid: string, rows: MessageRow[]) => void;
};

export const Sessions = memo((props: SessionsProps) => {
  const theme = useTheme().theme;
  const dialog = useDialog();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const rows = queryRecentSessions(50);
    setSessions(rows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced search
  useEffect(() => {
    if (!searching) return;
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(() => {
      setResults(searchSessions(query, 30));
      setSelected(0);
    }, 200);
  }, [query, searching]);

  const activate = useCallback(() => {
    if (searching) {
      const r = results[selected];
      if (!r || !props.onSwitch) return;
      const rows = querySessionMessages(r.session_id);
      props.onSwitch(r.session_id, rows);
      return;
    }
    const s = sessions[selected];
    if (!s || !props.onSwitch) return;
    const rows = querySessionMessages(s.id);
    props.onSwitch(s.id, rows);
  }, [sessions, results, selected, props.onSwitch, searching]);

  const confirmDelete = useCallback(
    (s: SessionRow) => {
      dialog.replace(
        <ConfirmDelete
          title={s.title ?? "Untitled"}
          onConfirm={() => {
            const ok = deleteSession(s.id);
            dialog.clear();
            if (ok) {
              invalidate();
              toast.show({ variant: "success", message: "Session deleted" });
              load();
              setSelected((prev) => Math.min(prev, sessions.length - 2));
            } else {
              toast.show({ variant: "error", message: "Failed to delete session" });
            }
          }}
          onCancel={() => dialog.clear()}
        />,
      );
    },
    [dialog, toast, load, sessions.length],
  );

  const count = searching ? results.length : sessions.length;

  useKeyboard((key) => {
    // Toggle search with /
    if (!searching && key.raw === "/") {
      setSearching(true);
      setQuery("");
      setResults([]);
      setSelected(0);
      return;
    }

    // In search mode, handle typing
    if (searching) {
      if (key.name === "escape") {
        setSearching(false);
        setQuery("");
        setResults([]);
        setSelected(0);
        return;
      }
      if (key.name === "backspace") {
        setQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (key.name === "return") {
        activate();
        return;
      }
      if (key.name === "up") {
        setSelected((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.name === "down") {
        setSelected((prev) => Math.min(count - 1, prev + 1));
        return;
      }
      // Printable character
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery((prev) => prev + key.raw);
        return;
      }
      return;
    }

    // Normal mode
    if (key.name === "up") {
      setSelected((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.name === "down") {
      setSelected((prev) => Math.min(count - 1, prev + 1));
      return;
    }
    if (key.name === "return") {
      activate();
      return;
    }
    if (key.name === "r") {
      load();
      return;
    }
    if (key.raw === "d" || key.name === "delete") {
      const s = sessions[selected];
      if (s) confirmDelete(s);
      return;
    }
  });

  const empty = searching ? results.length === 0 && query.length > 0 : sessions.length === 0;

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
        {/* Header */}
        <text>
          <span fg={theme.primary}>
            <strong>
              {searching
                ? `Search Results (${results.length})`
                : `Sessions (${sessions.length})`}
            </strong>
          </span>
          <span fg={theme.textMuted}>
            {searching
              ? "  ↑↓ navigate  Enter switch  Esc cancel"
              : "  ↑↓ navigate  Enter switch  / search  d delete  r refresh"}
          </span>
        </text>

        {/* Search bar */}
        {searching ? (
          <box>
            <text>
              <span fg={theme.accent}>{"/ "}</span>
              <span fg={theme.text}>{query}</span>
              <span fg={theme.accent}>{"█"}</span>
            </text>
          </box>
        ) : null}

        <text> </text>

        {/* List */}
        {empty ? (
          <EmptyState searching={searching} />
        ) : (
          <scrollbox scrollY>
            {searching
              ? results.map((r, i) => (
                  <SearchItem
                    key={r.session_id}
                    result={r}
                    selected={i === selected}
                    onSelect={() => setSelected(i)}
                    onHover={() => setSelected(i)}
                  />
                ))
              : sessions.map((s, i) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    selected={i === selected}
                    onSelect={() => setSelected(i)}
                    onHover={() => setSelected(i)}
                    onDelete={() => confirmDelete(s)}
                  />
                ))}
          </scrollbox>
        )}
      </box>

      {/* Detail panel */}
      {searching && results[selected] ? (
        <SearchDetailPanel result={results[selected]} />
      ) : !searching && sessions[selected] ? (
        <DetailPanel session={sessions[selected]} />
      ) : null}
    </box>
  );
});
