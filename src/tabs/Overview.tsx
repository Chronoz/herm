import { useEffect, useState, useCallback, memo } from "react";
import { TextAttributes } from "@opentui/core";
import {
  type HermesHomeSnapshot,
  type SessionRow,
} from "../utils/hermes-home";
import { snapshot } from "../utils/cache";
import { useTheme } from "../theme";

// ─── Helpers ──────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30_000;
const BOLD = TextAttributes.BOLD;

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const formatCost = (usd: number): string => {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

const timeAgo = (epochSec: number): string => {
  const diff = Math.floor(Date.now() / 1000 - epochSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const formatDuration = (startSec: number, endSec: number | null): string => {
  if (!endSec) return "ongoing";
  const diff = endSec - startSec;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
};

const capacityBar = (percent: number, width: number): string => {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
};

const truncate = (str: string, max: number): string => {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
};

// ─── Component ────────────────────────────────────────────────────────

export const Overview = memo(() => {
  const [snap, setSnap] = useState<HermesHomeSnapshot | null>(null);
  const theme = useTheme().theme;

  const refresh = useCallback(async () => {
    setSnap(await snapshot());
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!snap) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <text fg={theme.textMuted}>Loading overview…</text>
      </box>
    );
  }

  const config = snap.config;
  const sessions = snap.recentSessions;
  const memory = snap.memory;
  const profile = snap.userProfile;
  const skills = snap.skills;

  // ── Stats
  const totalSessions = sessions.length;
  const totalMessages = sessions.reduce((s, r) => s + r.message_count, 0);
  const totalToolCalls = sessions.reduce((s, r) => s + r.tool_call_count, 0);
  const totalTokens = sessions.reduce(
    (s, r) => s + r.input_tokens + r.output_tokens,
    0,
  );
  const totalCost = sessions.reduce(
    (s, r) => s + (r.estimated_cost_usd ?? 0),
    0,
  );

  // ── Recent 5 sessions
  const recent: SessionRow[] = sessions.slice(0, 5);

  // ── Label styling
  const LABEL_W = 14;
  const pad = (label: string): string => label.padEnd(LABEL_W);

  return (
    <box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1}>
      <scrollbox scrollY flexGrow={1}>
        {/* ── Identity ──────────────────────────── */}
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.accent} attributes={BOLD}>{"═══ Identity ═══"}</text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Agent")}</span>
            <span fg={theme.primary} attributes={BOLD}>Hermes</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Model")}</span>
            <span fg={theme.text}>{config?.model.default ?? "unknown"}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Provider")}</span>
            <span fg={theme.text}>{config?.model.provider ?? "unknown"}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Runtime")}</span>
            <span fg={theme.text}>Hermes Agent</span>
          </text>
        </box>

        {/* ── Stats ─────────────────────────────── */}
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.accent} attributes={BOLD}>{"═══ Stats ═══"}</text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Sessions")}</span>
            <span fg={theme.text} attributes={BOLD}>{String(totalSessions)}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Messages")}</span>
            <span fg={theme.text} attributes={BOLD}>{formatNumber(totalMessages)}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Tool Calls")}</span>
            <span fg={theme.text} attributes={BOLD}>{formatNumber(totalToolCalls)}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Tokens")}</span>
            <span fg={theme.text} attributes={BOLD}>{formatNumber(totalTokens)}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Est. Cost")}</span>
            <span fg={theme.text} attributes={BOLD}>{formatCost(totalCost)}</span>
          </text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Skills")}</span>
            <span fg={theme.text} attributes={BOLD}>{String(skills.length)}</span>
          </text>
        </box>

        {/* ── Memory ────────────────────────────── */}
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.accent} attributes={BOLD}>{"═══ Memory ═══"}</text>
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Notes")}</span>
            <span fg={theme.text}>
              {memory
                ? `${memory.entryCount} entries, ${memory.charCount}/${memory.charLimit} chars (${memory.usagePercent}%)`
                : "unavailable"}
            </span>
          </text>
          {memory ? (
            <text fg={theme.text}>
              <span fg={theme.textMuted}>{pad("")}</span>
              <span fg={theme.success}>
                {capacityBar(memory.usagePercent, 20)}
              </span>
              <span fg={theme.textMuted}>{` ${memory.usagePercent}%`}</span>
            </text>
          ) : null}
          <text fg={theme.text}>
            <span fg={theme.textMuted}>{pad("Profile")}</span>
            <span fg={theme.text}>
              {profile
                ? `${profile.entryCount} entries, ${profile.charCount}/${profile.charLimit} chars (${profile.usagePercent}%)`
                : "unavailable"}
            </span>
          </text>
          {profile ? (
            <text fg={theme.text}>
              <span fg={theme.textMuted}>{pad("")}</span>
              <span fg={theme.info}>
                {capacityBar(profile.usagePercent, 20)}
              </span>
              <span fg={theme.textMuted}>
                {` ${profile.usagePercent}%`}
              </span>
            </text>
          ) : null}
        </box>

        {/* ── Recent Activity ───────────────────── */}
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.accent} attributes={BOLD}>{"═══ Recent Activity ═══"}</text>
          {recent.length === 0 ? (
            <text fg={theme.textMuted}>{"  No sessions found"}</text>
          ) : (
            recent.map((s) => (
              <text key={s.id} fg={theme.text}>
                <span fg={theme.textMuted}>{"  • "}</span>
                <span fg={theme.text} attributes={BOLD}>
                  {truncate(s.title ?? s.id.slice(0, 8), 32)}
                </span>
                <span fg={theme.textMuted}>
                  {`  ${s.model ?? "?"}  ${timeAgo(s.started_at)}  ${formatDuration(s.started_at, s.ended_at)}`}
                </span>
              </text>
            ))
          )}
        </box>

        {/* ── Errors (if any) ───────────────────── */}
        {snap.errors.length > 0 ? (
          <box flexDirection="column" marginBottom={1}>
            <text fg={theme.warning} attributes={BOLD}>{"═══ Warnings ═══"}</text>
            {snap.errors.map((err, idx) => (
              <text key={String(idx)} fg={theme.warning}>
                {"  ⚠ "}
                {err}
              </text>
            ))}
          </box>
        ) : null}
      </scrollbox>
    </box>
  );
});
