import { useState, useEffect, useCallback, memo } from "react";
import {
  queryAnalytics,
  type AnalyticsData,
  type DailyRow,
  type ModelRow,
} from "../utils/hermes-home";
import { useTheme } from "../theme";

// ─── Helpers ──────────────────────────────────────────────────────────

const REFRESH = 60_000;
const PERIODS = [7, 30, 90] as const;

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const fmtCost = (usd: number): string => {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

const pad = (s: string, w: number): string =>
  s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);

const rpad = (s: string, w: number): string =>
  s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;

const barLen = (value: number, max: number, width: number): number =>
  max > 0 ? Math.round((value / max) * width) : 0;

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…";

// ─── Component ────────────────────────────────────────────────────────

export const Analytics = memo(({ visible = true }: { visible?: boolean }) => {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const theme = useTheme().theme;

  const refresh = useCallback(() => {
    setData(queryAnalytics(period));
  }, [period]);

  useEffect(() => {
    if (!visible) return
    refresh();
    const timer = setInterval(refresh, REFRESH);
    return () => clearInterval(timer);
  }, [refresh, visible]);

  if (!data) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <text fg={theme.textMuted}>{"Loading analytics…"}</text>
      </box>
    );
  }

  const totals = data.totals;
  const daily = data.daily;
  const peak = daily.reduce((m, d) => Math.max(m, d.input + d.output), 0);
  const width = 40;

  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* Period selector */}
      <box height={1} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{"Period: "}</text>
        {PERIODS.map((p) => (
          <box key={p} height={1} onMouseDown={() => setPeriod(p)}>
            <text fg={p === period ? theme.primary : theme.textMuted}>
              {p === period ? `[${p}d]` : ` ${p}d `}
            </text>
          </box>
        ))}
      </box>

      <box height={1} />

      {/* Summary cards */}
      <box height={1} flexDirection="row">
        <text>
          <span fg={theme.info}>{"  Tokens "}</span>
          <span fg={theme.text}>{fmt(totals.input + totals.output)}</span>
          <span fg={theme.textMuted}>{"  (in:"}</span>
          <span fg={theme.success}>{fmt(totals.input)}</span>
          <span fg={theme.textMuted}>{" out:"}</span>
          <span fg={theme.warning}>{fmt(totals.output)}</span>
          <span fg={theme.textMuted}>{")"}</span>
          <span fg={theme.info}>{"   Sessions "}</span>
          <span fg={theme.text}>{String(totals.sessions)}</span>
          <span fg={theme.info}>{"   Cost "}</span>
          <span fg={theme.accent}>{fmtCost(totals.estimated)}</span>
          {totals.actual > 0 ? (
            <span fg={theme.textMuted}>{` (actual: ${fmtCost(totals.actual)})`}</span>
          ) : (
            <span>{""}</span>
          )}
        </text>
      </box>

      <box height={1} />

      {/* Bar chart */}
      <text fg={theme.info}>{"  Daily Token Usage"}</text>
      <box height={1} />
      {daily.slice(-14).map((d) => {
        const inp = barLen(d.input, peak, width);
        const out = barLen(d.output, peak, width);
        const label = d.day.slice(5);
        return (
          <box key={d.day} height={1} flexDirection="row">
            <text>
              <span fg={theme.textMuted}>{pad(label, 7)}</span>
              <span fg={theme.success}>{"━".repeat(inp)}</span>
              <span fg={theme.warning}>{"━".repeat(out)}</span>
              <span fg={theme.textMuted}>{" " + fmt(d.input + d.output)}</span>
            </text>
          </box>
        );
      })}

      <box height={1} />

      {/* Daily breakdown */}
      <text fg={theme.info}>{"  Daily Breakdown"}</text>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>
            {pad("Day", 12) + rpad("Input", 10) + rpad("Output", 10) + rpad("Cache", 10) + rpad("Cost", 10) + rpad("Sessions", 8)}
          </span>
        </text>
      </box>
      <scrollbox scrollY flexGrow={1}>
        {daily.map((d: DailyRow) => (
          <box key={d.day} height={1}>
            <text>
              <span fg={theme.text}>{pad(d.day.slice(5), 12)}</span>
              <span fg={theme.success}>{rpad(fmt(d.input), 10)}</span>
              <span fg={theme.warning}>{rpad(fmt(d.output), 10)}</span>
              <span fg={theme.textMuted}>{rpad(fmt(d.cache), 10)}</span>
              <span fg={theme.accent}>{rpad(fmtCost(d.cost), 10)}</span>
              <span fg={theme.text}>{rpad(String(d.sessions), 8)}</span>
            </text>
          </box>
        ))}

        <box height={1} />

        {/* Model breakdown */}
        <text fg={theme.info}>{"  Model Breakdown"}</text>
        <box height={1}>
          <text>
            <span fg={theme.textMuted}>
              {pad("Model", 32) + rpad("Tokens", 12) + rpad("Cost", 10) + rpad("Sessions", 8)}
            </span>
          </text>
        </box>
        {data.models.map((m: ModelRow) => (
          <box key={m.model} height={1}>
            <text>
              <span fg={theme.text}>{pad(truncate(m.model, 30), 32)}</span>
              <span fg={theme.success}>{rpad(fmt(m.input + m.output), 12)}</span>
              <span fg={theme.accent}>{rpad(fmtCost(m.cost), 10)}</span>
              <span fg={theme.text}>{rpad(String(m.sessions), 8)}</span>
            </text>
          </box>
        ))}
      </scrollbox>
    </box>
  );
});
