import { useState, useEffect, useCallback, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { readToolsets, type ToolsetInfo } from "../utils/hermes-home";
import { useTheme } from "../theme";

// ─── Toolset Row ──────────────────────────────────────────────────────

const ToolsetRow = (props: {
  toolset: ToolsetInfo;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const ts = props.toolset;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const indicator = props.selected ? "▸ " : "  ";
  const chevron = props.expanded ? "▾" : "▸";
  const badge = ts.enabled
    ? ts.active.length > 0 ? "● active" : "○ ready"
    : "✕ off";
  const color = ts.enabled
    ? ts.active.length > 0 ? theme.success : theme.info
    : theme.textMuted;

  return (
    <box flexDirection="column">
      <box
        backgroundColor={bg}
        onMouseDown={props.onSelect}
        onMouseOver={props.onHover}
      >
        <text>
          <span fg={props.selected ? theme.primary : theme.text}>
            {indicator}
          </span>
          <span fg={theme.textMuted}>{chevron} </span>
          <span fg={props.selected ? theme.accent : theme.text}>
            {ts.name.padEnd(16)}
          </span>
          <span fg={theme.info}>
            {String(ts.tools.length).padStart(2)} tools   </span>
          <span fg={color}>{badge}</span>
        </text>
      </box>
      {props.expanded ? (
        <box flexDirection="column" marginLeft={6}>
          {ts.tools.map(t => (
            <text key={t}>
              <span fg={ts.active.includes(t) ? theme.success : theme.textMuted}>
                {ts.active.includes(t) ? "  ● " : "  ○ "}
              </span>
              <span fg={ts.active.includes(t) ? theme.text : theme.textMuted}>
                {t}
              </span>
            </text>
          ))}
        </box>
      ) : null}
    </box>
  );
};

// ─── Detail Panel ─────────────────────────────────────────────────────

const DetailPanel = (props: { toolset: ToolsetInfo }) => {
  const theme = useTheme().theme;
  const ts = props.toolset;

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
          <strong>Toolset Detail</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.accent}>
          <strong>{ts.name}</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Status".padEnd(12)}</span>
        <span fg={ts.enabled ? theme.success : theme.error}>
          {ts.enabled ? " enabled" : " disabled"}
        </span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Tools".padEnd(12)}</span>
        <span fg={theme.info}>{` ${ts.tools.length} total`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"Active".padEnd(12)}</span>
        <span fg={theme.success}>{` ${ts.active.length} in session`}</span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>Tools:</span>
      </text>
      {ts.tools.map(t => (
        <text key={t}>
          <span fg={ts.active.includes(t) ? theme.success : theme.textMuted}>
            {ts.active.includes(t) ? "  ● " : "  ○ "}
          </span>
          <span fg={ts.active.includes(t) ? theme.text : theme.textMuted}>
            {t}
          </span>
        </text>
      ))}
    </box>
  );
};

// ─── Empty State ──────────────────────────────────────────────────────

const EmptyState = (props: { searching: boolean }) => {
  const theme = useTheme().theme;
  return (
    <box flexGrow={1} padding={2}>
      <text>
        <span fg={theme.textMuted}>
          {props.searching
            ? "No matching toolsets"
            : "No toolsets found"}
        </span>
      </text>
    </box>
  );
};

// ─── Main Component ───────────────────────────────────────────────────

export const Toolsets = memo(() => {
  const theme = useTheme().theme;
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setToolsets(await readToolsets());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = searching && query.trim()
    ? toolsets.filter(ts => {
        const q = query.toLowerCase();
        return ts.name.toLowerCase().includes(q)
          || ts.tools.some(t => t.toLowerCase().includes(q));
      })
    : toolsets;

  const count = filtered.length;
  const current = filtered[selected] ?? null;

  const toggle = useCallback((name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  useKeyboard((key) => {
    if (!searching && key.raw === "/") {
      setSearching(true);
      setQuery("");
      setSelected(0);
      return;
    }

    if (searching) {
      if (key.name === "escape") {
        setSearching(false);
        setQuery("");
        setSelected(0);
        return;
      }
      if (key.name === "backspace") {
        setQuery(prev => prev.slice(0, -1));
        setSelected(0);
        return;
      }
      if (key.name === "up") {
        setSelected(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.name === "down") {
        setSelected(prev => Math.min(count - 1, prev + 1));
        return;
      }
      if (key.name === "return" && current) {
        toggle(current.name);
        return;
      }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery(prev => prev + key.raw);
        setSelected(0);
        return;
      }
      return;
    }

    if (key.name === "up") {
      setSelected(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.name === "down") {
      setSelected(prev => Math.min(count - 1, prev + 1));
      return;
    }
    if (key.name === "return" && current) {
      toggle(current.name);
      return;
    }
    if (key.name === "r") {
      load();
      return;
    }
  });

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
                ? `Toolsets (${count} matching)`
                : `Toolsets (${toolsets.length})`}
            </strong>
          </span>
          <span fg={theme.textMuted}>
            {searching
              ? "  ↑↓ navigate  Enter expand  Esc cancel"
              : "  ↑↓ navigate  Enter expand  / search  r refresh"}
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

        {/* Column headers */}
        <box marginTop={1}>
          <text>
            <span fg={theme.textMuted}>
              {"  "}{"Name".padEnd(18)}{"Tools".padEnd(12)}{"Status"}
            </span>
          </text>
        </box>
        <text>
          <span fg={theme.borderSubtle}>{"  "}{"─".repeat(16)}{"  "}{"─".repeat(10)}{"  "}{"─".repeat(12)}</span>
        </text>

        {/* List */}
        {count === 0 ? (
          <EmptyState searching={searching} />
        ) : (
          <scrollbox scrollY>
            {filtered.map((ts, i) => (
              <ToolsetRow
                key={ts.name}
                toolset={ts}
                selected={i === selected}
                expanded={expanded.has(ts.name)}
                onSelect={() => { setSelected(i); toggle(ts.name); }}
                onHover={() => setSelected(i)}
              />
            ))}
          </scrollbox>
        )}
      </box>

      {/* Detail panel */}
      {current ? <DetailPanel toolset={current} /> : null}
    </box>
  );
});
