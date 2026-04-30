/**
 * hermes-home.ts — Reader for the ~/.hermes/ directory.
 *
 * This is herm's window into the Hermes Agent's persistent state.
 * All reads are filesystem-based (Bun APIs), no HTTP needed.
 *
 * Every piece of extracted data carries a `source: Source` field so the
 * UI can generically render clickable file links without knowing paths.
 */

import { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import { openSync, readSync, closeSync, readdirSync } from "node:fs";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import * as perf from "./perf";
import { count as tokenCount } from "./tokens";

// ─── Path Resolution ─────────────────────────────────────────────────

const HOME = process.env.HOME || homedir();
const HERMES_HOME = process.env.HERMES_HOME || `${HOME}/.hermes`;

/** Resolve a path relative to ~/.hermes/ */
export const hermesPath = (relative: string): string =>
  `${HERMES_HOME}/${relative}`;

/** Detect a package-manager-owned install. Two signals, matching
 *  hermes_cli/config.py:get_managed_system — HERMES_MANAGED env var
 *  (systemd service sets it) or the `.managed` marker file (NixOS
 *  activation script touches it so interactive shells see it too). */
export const managedSystem = async (): Promise<string | null> => {
  const env = (process.env.HERMES_MANAGED ?? "").trim()
  if (env) {
    const norm = env.toLowerCase()
    if (norm === "1" || norm === "true" || norm === "yes" || norm === "on") return "NixOS"
    const names: Record<string, string> = { homebrew: "Homebrew", nix: "NixOS", nixos: "NixOS" }
    return names[norm] ?? env
  }
  return (await Bun.file(hermesPath(".managed")).exists()) ? "NixOS" : null
}

// ─── Source Provenance ────────────────────────────────────────────────

/** Every piece of data extracted from ~/.hermes/ carries its origin file. */
export interface Source {
  file: string; // absolute path
  relative: string; // relative to HERMES_HOME
  label: string; // human-friendly display name
}

/** Build a Source for a file relative to HERMES_HOME */
export const makeSource = (
  relative: string,
  label?: string,
): Source => ({
  file: hermesPath(relative),
  relative,
  label: label ?? relative.split("/").pop() ?? relative,
});

// ─── Types ───────────────────────────────────────────────────────────

/** Subset of config.yaml we care about */
export interface HermesConfig {
  source: Source;
  model: {
    default: string;
    provider: string;
    base_url: string;
  };
  agent: {
    max_turns: number;
    reasoning_effort: string;
  };
  compression: {
    enabled: boolean;
    threshold: number;
    target_ratio: number;
    protect_last_n: number;
    summary_model: string;
  };
  memory: {
    memory_enabled: boolean;
    user_profile_enabled: boolean;
    memory_char_limit: number;
    user_char_limit: number;
    provider: string;
    nudge_interval: number;
    flush_min_turns: number;
  };
  display: {
    personality: string;
    skin: string;
    show_cost: boolean;
  };
  gateway: {
    platforms: {
      api_server?: {
        enabled: boolean;
        host: string;
        port: number;
      };
    };
  };
}

/** Memory file stats */
export interface MemoryFileInfo {
  source: Source;
  content: string;
  charCount: number;
  charLimit: number;
  usagePercent: number;
  entryCount: number;
}

/** A row from the sessions table in state.db */
export interface SessionRow {
  source: Source;
  id: string;
  sessionSource: string; // renamed from "source" to avoid collision
  model: string | null;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number | null;
  title: string | null;
  lastMessage: string | null;
  last_active: number | null;
  parent_session_id: string | null;
  /** Count of subagent children — spawned while this session was still
   *  live (child.started_at < parent.ended_at or parent.ended_at NULL).
   *  Branches and compression continuations are excluded. Populated by
   *  queryRecentSessions; 0 when the DB query can't compute it. */
  subagent_count: number;
  /** When this row was projected forward from a compression-chain
   *  root, the original root's id lives here so the detail panel can
   *  render the full lineage. NULL when the row is not a projection. */
  lineage_root_id: string | null;
}

/** Live session entry from sessions/sessions.json */
export interface LiveSession {
  session_key: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  display_name: string;
  platform: string;
  chat_type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  last_prompt_tokens: number;
  estimated_cost_usd: number;
  cost_status: string;
  memory_flushed: boolean;
  origin?: {
    platform: string;
    chat_id: string;
    chat_name: string;
    user_id: string;
    user_name: string;
  };
}

/** A tool schema from the session JSON */
export interface ToolInfo {
  name: string;
  descriptionLength: number;
  paramsLength: number;
}

/** Skill info from the skills directory */
export interface SkillInfo {
  source: Source;
  category: string;
  name: string;
  description: string;
  tags: string[];
  /**
   * Token cost of this skill's index entry in the system prompt
   * (name + description + tags). Body content is NOT included — it
   * only loads on skill_view() and shows up as a tool result.
   */
  tokenEstimate: number;
}

/**
 * Read description/tags from a SKILL.md YAML frontmatter block.
 * Cheap — reads only the first ~2KB. Missing file / no `---` → empty.
 */
export function readSkillFrontmatter(source: Source): { description: string; tags: string[] } {
  try {
    const fd = openSync(source.file, "r");
    const buf = Buffer.alloc(2048);
    const n = readSync(fd, buf, 0, 2048, 0);
    closeSync(fd);
    const head = buf.toString("utf-8", 0, n);
    if (!head.startsWith("---")) return { description: "", tags: [] };
    const end = head.indexOf("\n---", 3);
    if (end < 0) return { description: "", tags: [] };
    const fm = parseYaml(head.slice(3, end)) as Record<string, unknown>;
    const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
    return { description: String(fm.description ?? ""), tags };
  } catch {
    return { description: "", tags: [] };
  }
}

/** Per-skill telemetry sidecar record (~/.hermes/skills/.usage.json). */
export interface SkillUsage {
  use_count: number;
  view_count: number;
  patch_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  last_patched_at: string | null;
  created_at: string | null;
  archived_at: string | null;
  state: "active" | "stale" | "archived";
  pinned: boolean;
}

/**
 * Read ~/.hermes/skills/.usage.json. Keyed by skill name.
 * Returns empty record on any failure — absent sidecar is the default.
 */
export async function readSkillUsage(): Promise<Record<string, SkillUsage>> {
  try {
    const f = Bun.file(hermesPath("skills/.usage.json"));
    if (!(await f.exists())) return {};
    const raw = await f.json() as Record<string, Partial<SkillUsage>>;
    const out: Record<string, SkillUsage> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      out[k] = {
        use_count: Number(v.use_count ?? 0),
        view_count: Number(v.view_count ?? 0),
        patch_count: Number(v.patch_count ?? 0),
        last_used_at: v.last_used_at ?? null,
        last_viewed_at: v.last_viewed_at ?? null,
        last_patched_at: v.last_patched_at ?? null,
        created_at: v.created_at ?? null,
        archived_at: v.archived_at ?? null,
        state: (v.state as SkillUsage["state"]) ?? "active",
        pinned: Boolean(v.pinned),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Curator scheduler state (~/.hermes/skills/.curator_state). */
export interface CuratorState {
  last_run_at: string | null;
  last_run_duration_seconds: number | null;
  last_run_summary: string | null;
  paused: boolean;
  run_count: number;
}

export async function readCuratorState(): Promise<CuratorState | null> {
  try {
    const f = Bun.file(hermesPath("skills/.curator_state"));
    if (!(await f.exists())) return null;
    const raw = await f.json() as Partial<CuratorState>;
    return {
      last_run_at: raw.last_run_at ?? null,
      last_run_duration_seconds: raw.last_run_duration_seconds ?? null,
      last_run_summary: raw.last_run_summary ?? null,
      paused: Boolean(raw.paused),
      run_count: Number(raw.run_count ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Locate the newest curator run report — returns {dir, mtime} of the
 * directory under ~/.hermes/logs/curator/ with the latest mtime.
 * Returns null if none exist.
 */
export interface CuratorReportInfo {
  /** Source to the REPORT.md inside the newest run dir. */
  source: Source;
  /** Raw REPORT.md body, trimmed. */
  content: string;
  /** Run dir name, e.g. "20260430-120030". */
  runId: string;
}

export async function readLatestCuratorReport(): Promise<CuratorReportInfo | null> {
  try {
    const base = `${HERMES_HOME}/logs/curator`;
    const entries = readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory());
    if (entries.length === 0) return null;
    // Run dirs are named YYYYMMDD-HHMMSS — lexicographic sort = chronological.
    entries.sort((a, b) => b.name.localeCompare(a.name));
    const runId = entries[0]!.name;
    const rel = `logs/curator/${runId}/REPORT.md`;
    const source = makeSource(rel);
    const body = await Bun.file(source.file).text();
    return { source, content: body.trim(), runId };
  } catch {
    return null;
  }
}

/** SOUL.md info */
export interface SoulInfo {
  source: Source;
  charCount: number;
  tokenEstimate: number;
  /** Raw SOUL.md body. Consumed by the Context drill-down detail panel. */
  content: string;
}

/** System prompt breakdown — full text for section parsing */
export interface SystemPromptInfo {
  source: Source;
  sessionId: string;
  text: string;
  totalChars: number;
  tokenEstimate: number;
}

/** Tool list with its source session file */
export interface ToolsInfo {
  source: Source;
  tools: ToolInfo[];
}

// ─── Readers ─────────────────────────────────────────────────────────

/** Read and parse config.yaml */
export async function readConfig(): Promise<HermesConfig | null> {
  try {
    const file = Bun.file(hermesPath("config.yaml"));
    const text = await file.text();
    const raw = parseYaml(text);
    return {
      source: makeSource("config.yaml", "config.yaml"),
      model: {
        default: raw?.model?.default ?? "unknown",
        provider: raw?.model?.provider ?? "auto",
        base_url: raw?.model?.base_url ?? "",
      },
      agent: {
        max_turns: raw?.agent?.max_turns ?? 60,
        reasoning_effort: raw?.agent?.reasoning_effort ?? "medium",
      },
      compression: {
        enabled: raw?.compression?.enabled ?? true,
        threshold: raw?.compression?.threshold ?? 0.5,
        target_ratio: raw?.compression?.target_ratio ?? 0.2,
        protect_last_n: raw?.compression?.protect_last_n ?? 20,
        summary_model: raw?.compression?.summary_model ?? "",
      },
      memory: {
        memory_enabled: raw?.memory?.memory_enabled ?? true,
        user_profile_enabled: raw?.memory?.user_profile_enabled ?? true,
        memory_char_limit: raw?.memory?.memory_char_limit ?? 2200,
        user_char_limit: raw?.memory?.user_char_limit ?? 1375,
        provider: raw?.memory?.provider ?? "",
        nudge_interval: raw?.memory?.nudge_interval ?? 10,
        flush_min_turns: raw?.memory?.flush_min_turns ?? 6,
      },
      display: {
        personality: raw?.display?.personality ?? "default",
        skin: raw?.display?.skin ?? "default",
        show_cost: raw?.display?.show_cost ?? false,
      },
      gateway: {
        platforms: {
          api_server: raw?.gateway?.platforms?.api_server ?? undefined,
        },
      },
    };
  } catch {
    return null;
  }
}

/** Read a memory file (MEMORY.md or USER.md) with limit context */
export async function readMemoryFile(
  filename: "MEMORY.md" | "USER.md",
  charLimit: number,
): Promise<MemoryFileInfo | null> {
  try {
    const relative = `memories/${filename}`;
    const file = Bun.file(hermesPath(relative));
    const content = await file.text();
    const entryCount = content.split("§").filter((s) => s.trim()).length;
    return {
      source: makeSource(relative, filename),
      content,
      charCount: content.length,
      charLimit,
      usagePercent:
        charLimit > 0 ? Math.round((content.length / charLimit) * 100) : 0,
      entryCount,
    };
  } catch {
    return null;
  }
}

/** Read sessions/sessions.json (live session index) */
export async function readLiveSessions(): Promise<
  Record<string, LiveSession>
> {
  try {
    const file = Bun.file(hermesPath("sessions/sessions.json"));
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Query state.db for recent sessions.
 *
 * Mirrors hermes_state.py list_sessions_rich(): only roots and branch
 * children are listed; subagents and compression continuations are
 * hidden. Each row carries a subagent_count for tree expansion, and
 * compression-chain roots are projected forward to their live tip (the
 * row's id/title/stats come from the tip; started_at stays the root's
 * so chronological order is preserved). lineage_root_id records the
 * original root when projection happened.
 */
export function queryRecentSessions(limit: number = 30): SessionRow[] {
  const end = perf.mark("io:queryRecentSessions")
  const dbSource = makeSource("state.db");
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    // Root/branch filter + first-user-msg preview + last-active max +
    // subagent count. Subagents = children that started BEFORE parent
    // ended (or parent still live). Continuations (end_reason=
    // compression) and branches (end_reason=branched) don't count.
    const rows = db
      .query(
        `SELECT s.id, s.source, s.model, s.started_at, s.ended_at, s.end_reason,
                s.message_count, s.tool_call_count,
                s.input_tokens, s.output_tokens,
                s.cache_read_tokens, s.cache_write_tokens, s.reasoning_tokens,
                s.estimated_cost_usd, s.parent_session_id,
                COALESCE(s.title, SUBSTR(m.content, 1, 120)) AS title,
                SUBSTR(ml.content, 1, 120) AS lastMessage,
                (SELECT MAX(mx.timestamp) FROM messages mx WHERE mx.session_id = s.id) AS last_active,
                (SELECT COUNT(*) FROM sessions c
                 WHERE c.parent_session_id = s.id
                   AND (s.ended_at IS NULL OR c.started_at < s.ended_at)) AS subagent_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id AND m.role = 'user'
           AND m.id = (SELECT MIN(m2.id) FROM messages m2 WHERE m2.session_id = s.id AND m2.role = 'user')
         LEFT JOIN messages ml ON ml.session_id = s.id AND ml.role = 'user'
           AND ml.id = (SELECT MAX(m3.id) FROM messages m3 WHERE m3.session_id = s.id AND m3.role = 'user')
         WHERE s.parent_session_id IS NULL
            OR EXISTS (
              SELECT 1 FROM sessions p
              WHERE p.id = s.parent_session_id
                AND p.end_reason = 'branched'
                AND s.started_at >= p.ended_at
            )
         ORDER BY s.started_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      source: string;
      model: string | null;
      started_at: number;
      ended_at: number | null;
      end_reason: string | null;
      message_count: number;
      tool_call_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      reasoning_tokens: number;
      estimated_cost_usd: number | null;
      title: string | null;
      lastMessage: string | null;
      last_active: number | null;
      parent_session_id: string | null;
      subagent_count: number;
    }>;

    // Compression-tip projection. For each row whose end_reason is
    // 'compression', walk the child chain forward to the tip and
    // replace the surfaced id/title/stats with the tip's — keeping
    // started_at so ordering stays stable. Bounded to 100 links to
    // match upstream's defensive cap against pathological chains.
    const projected = rows.map((r) => {
      if (r.end_reason !== "compression") return { row: r, lineage: null as string | null }
      const tipId = compressionTip(db, r.id)
      if (tipId === r.id) return { row: r, lineage: null }
      const tip = db.query(
        `SELECT s.id, s.model, s.ended_at, s.end_reason,
                s.message_count, s.tool_call_count,
                COALESCE(s.title, SUBSTR(m.content, 1, 120)) AS title,
                SUBSTR(ml.content, 1, 120) AS lastMessage,
                (SELECT MAX(mx.timestamp) FROM messages mx WHERE mx.session_id = s.id) AS last_active,
                (SELECT COUNT(*) FROM sessions c
                 WHERE c.parent_session_id = s.id
                   AND (s.ended_at IS NULL OR c.started_at < s.ended_at)) AS subagent_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id AND m.role = 'user'
           AND m.id = (SELECT MIN(m2.id) FROM messages m2 WHERE m2.session_id = s.id AND m2.role = 'user')
         LEFT JOIN messages ml ON ml.session_id = s.id AND ml.role = 'user'
           AND ml.id = (SELECT MAX(m3.id) FROM messages m3 WHERE m3.session_id = s.id AND m3.role = 'user')
         WHERE s.id = ?`,
      ).get(tipId) as {
        id: string; model: string | null;
        ended_at: number | null; end_reason: string | null;
        message_count: number; tool_call_count: number;
        title: string | null; lastMessage: string | null;
        last_active: number | null; subagent_count: number;
      } | null
      if (!tip) return { row: r, lineage: null }
      return {
        row: {
          ...r,
          id: tip.id,
          model: tip.model,
          ended_at: tip.ended_at,
          end_reason: tip.end_reason,
          message_count: tip.message_count,
          tool_call_count: tip.tool_call_count,
          title: tip.title,
          lastMessage: tip.lastMessage,
          last_active: tip.last_active,
          subagent_count: tip.subagent_count,
          // started_at stays r.started_at — the root's timestamp.
        },
        lineage: r.id,
      }
    })
    db.close();
    const mapped = projected.map(({ row, lineage }) => ({
      source: dbSource,
      id: row.id,
      sessionSource: row.source,
      model: row.model,
      started_at: row.started_at,
      ended_at: row.ended_at,
      end_reason: row.end_reason,
      message_count: row.message_count,
      tool_call_count: row.tool_call_count,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_write_tokens: row.cache_write_tokens,
      reasoning_tokens: row.reasoning_tokens,
      estimated_cost_usd: row.estimated_cost_usd,
      title: row.title,
      lastMessage: row.lastMessage,
      last_active: row.last_active,
      parent_session_id: row.parent_session_id,
      subagent_count: row.subagent_count,
      lineage_root_id: lineage,
    }));
    end()
    return mapped
  } catch {
    end()
    return [];
  }
}

/** Walk the compression-continuation chain forward and return the tip.
 *
 *  A compression continuation is a child session where:
 *    1. The parent's end_reason = 'compression'
 *    2. The child was created AFTER the parent was ended (started_at
 *       >= ended_at) — distinguishes continuations from subagents or
 *       branches that share parent_session_id.
 *
 *  Returns the tip's id, or the input id if it isn't part of a
 *  compression chain. Bounded at 100 links defensively.
 */
function compressionTip(db: Database, sid: string): string {
  let current = sid
  for (let i = 0; i < 100; i++) {
    const next = db.query(
      `SELECT id FROM sessions
       WHERE parent_session_id = ?
         AND started_at >= (
           SELECT ended_at FROM sessions
           WHERE id = ? AND end_reason = 'compression'
         )
       ORDER BY started_at DESC
       LIMIT 1`,
    ).get(current, current) as { id: string } | null
    if (!next) return current
    current = next.id
  }
  return current
}

/** Fetch subagent children of a parent session.
 *
 * Subagents = children whose started_at is strictly before the parent's
 * ended_at (or parent still live). Branches and compression
 * continuations — both of which require started_at >= parent.ended_at
 * — are excluded. Returned rows use the same column projection as
 * queryRecentSessions so the Sessions tab can render them with shared
 * row components. Sorted by started_at ASC to preserve spawn order.
 */
export function querySubagents(parentId: string): SessionRow[] {
  const end = perf.mark("io:querySubagents")
  const dbSource = makeSource("state.db")
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true })
    const rows = db.query(
      `SELECT s.id, s.source, s.model, s.started_at, s.ended_at, s.end_reason,
              s.message_count, s.tool_call_count,
              s.input_tokens, s.output_tokens,
              s.cache_read_tokens, s.cache_write_tokens, s.reasoning_tokens,
              s.estimated_cost_usd, s.parent_session_id,
              COALESCE(s.title, SUBSTR(m.content, 1, 120)) AS title,
              SUBSTR(ml.content, 1, 120) AS lastMessage,
              (SELECT MAX(mx.timestamp) FROM messages mx WHERE mx.session_id = s.id) AS last_active
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id AND m.role = 'user'
         AND m.id = (SELECT MIN(m2.id) FROM messages m2 WHERE m2.session_id = s.id AND m2.role = 'user')
       LEFT JOIN messages ml ON ml.session_id = s.id AND ml.role = 'user'
         AND ml.id = (SELECT MAX(m3.id) FROM messages m3 WHERE m3.session_id = s.id AND m3.role = 'user')
       WHERE s.parent_session_id = ?
         AND s.started_at < COALESCE(
           (SELECT ended_at FROM sessions WHERE id = ?),
           9999999999
         )
       ORDER BY s.started_at ASC`,
    ).all(parentId, parentId) as Array<{
      id: string; source: string; model: string | null;
      started_at: number; ended_at: number | null; end_reason: string | null;
      message_count: number; tool_call_count: number;
      input_tokens: number; output_tokens: number;
      cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number;
      estimated_cost_usd: number | null; parent_session_id: string | null;
      title: string | null; lastMessage: string | null; last_active: number | null;
    }>
    db.close()
    const mapped = rows.map((r) => ({
      source: dbSource,
      id: r.id,
      sessionSource: r.source,
      model: r.model,
      started_at: r.started_at,
      ended_at: r.ended_at,
      end_reason: r.end_reason,
      message_count: r.message_count,
      tool_call_count: r.tool_call_count,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_tokens: r.cache_read_tokens,
      cache_write_tokens: r.cache_write_tokens,
      reasoning_tokens: r.reasoning_tokens,
      estimated_cost_usd: r.estimated_cost_usd,
      title: r.title,
      lastMessage: r.lastMessage,
      last_active: r.last_active,
      parent_session_id: r.parent_session_id,
      // Subagents are leaves in the list view — we don't recurse. 0
      // keeps the type happy and tells the UI "no further expansion".
      subagent_count: 0,
      lineage_root_id: null,
    }))
    end()
    return mapped
  } catch {
    end()
    return []
  }
}

/** Compact lineage info for a session id — the data the Detail panel
 *  uses to render its Lineage block. Every field is optional; if none
 *  resolve, the caller should render no Lineage block at all.
 */
export interface LineageInfo {
  /** The session this one continues from (compression-chain predecessor)
   *  — populated when this row is a compression continuation. */
  continuesFrom?: { id: string; title: string | null }
  /** The session this one was compressed into (its chain successor) —
   *  populated when this row itself has a compression child. */
  compressedTo?: { id: string; title: string | null }
}

/** Walk the lineage graph around a session to find its compression
 *  predecessors and successors. No subagent info here — the UI already
 *  has subagent_count on the Row itself.
 *
 *  Semantics match hermes_state.py: a compression-chain link exists
 *  iff the parent's end_reason = 'compression' AND the child started
 *  at or after parent.ended_at.
 */
export function queryLineage(sid: string): LineageInfo {
  const end = perf.mark("io:queryLineage")
  const info: LineageInfo = {}
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true })
    // Predecessor: this row's parent, IF the parent ended with
    // compression AND this row started at/after the parent's ended_at.
    const pred = db.query(
      `SELECT p.id AS pid, p.title AS ptitle
       FROM sessions s
       JOIN sessions p ON p.id = s.parent_session_id
       WHERE s.id = ?
         AND p.end_reason = 'compression'
         AND s.started_at >= p.ended_at`,
    ).get(sid) as { pid: string; ptitle: string | null } | null
    if (pred) info.continuesFrom = { id: pred.pid, title: pred.ptitle }

    // Successor: a child whose parent_session_id = sid AND started
    // after this session ended AND this session's end_reason is
    // compression. Multiple candidates possible — take the latest.
    const succ = db.query(
      `SELECT c.id AS cid, c.title AS ctitle
       FROM sessions c
       JOIN sessions p ON p.id = c.parent_session_id
       WHERE c.parent_session_id = ?
         AND p.end_reason = 'compression'
         AND c.started_at >= p.ended_at
       ORDER BY c.started_at DESC
       LIMIT 1`,
    ).get(sid) as { cid: string; ctitle: string | null } | null
    if (succ) info.compressedTo = { id: succ.cid, title: succ.ctitle }

    db.close()
    end()
    return info
  } catch {
    end()
    return info
  }
}

// ─── Session search / delete ─────────────────────────────────────────
//
// Stock tui_gateway has no session.search / session.delete RPCs (see
// UPSTREAM.md). Herm hits state.db's FTS5 index directly — same table
// and triggers SessionDB.search_messages() uses, so results match the
// CLI's `hermes sessions search` and the session_search tool.

export interface SessionHit {
  session_id: string;
  snippet: string;
  role: string;
  source: string;
  model: string | null;
  started_at: number;
  title: string | null;
}

// FTS5 treats - . ( ) " etc. as syntax. Quote anything non-alnum as a
// phrase and append * to bare words for prefix match so incremental
// typing narrows results live.
const fts = (q: string): string =>
  q.trim().split(/\s+/)
    .map(w => /^\w+$/.test(w) ? `${w}*` : `"${w.replace(/"/g, '""')}"`)
    .join(" ");

/** FTS5 search over all message content, collapsed to one hit per session. */
export function searchSessions(query: string, limit = 30): SessionHit[] {
  const q = fts(query);
  if (!q) return [];
  const end = perf.mark("io:searchSessions");
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    const rows = db.query(
      `SELECT m.session_id, m.role,
              snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
              s.source, s.model, s.started_at AS started,
              COALESCE(s.title, SUBSTR(m.content, 1, 120)) AS title
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN sessions s ON s.id = m.session_id
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    ).all(q, limit * 4) as Array<{
      session_id: string; role: string; snippet: string; source: string;
      model: string | null; started: number; title: string | null;
    }>;
    db.close();
    const seen = new Set<string>();
    const out: SessionHit[] = [];
    for (const r of rows) {
      if (seen.has(r.session_id)) continue;
      seen.add(r.session_id);
      out.push({
        session_id: r.session_id, snippet: r.snippet, role: r.role,
        source: r.source, model: r.model, started_at: r.started, title: r.title,
      });
      if (out.length >= limit) break;
    }
    end();
    return out;
  } catch {
    end();
    return [];
  }
}

/** Delete a session and its messages. Children are orphaned, not cascaded. */
export function deleteSession(sid: string): boolean {
  const db = new Database(hermesPath("state.db"));
  try {
    const hit = db.query("SELECT 1 FROM sessions WHERE id = ?").get(sid);
    if (!hit) return false;
    db.run("UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?", [sid]);
    db.run("DELETE FROM messages WHERE session_id = ?", [sid]);
    db.run("DELETE FROM sessions WHERE id = ?", [sid]);
    return true;
  } finally {
    db.close();
  }
}

/**
 * Rename a session. Direct state.db write — `session.title` RPC is
 * bound to the gateway's *current* session, so it can't retitle an
 * arbitrary row from the list. UPSTREAM.md tracks wanting a
 * `{session_id, title}` variant.
 */
export function renameSession(sid: string, title: string): boolean {
  const db = new Database(hermesPath("state.db"));
  try {
    db.run("UPDATE sessions SET title = ? WHERE id = ?", [title, sid]);
    return (db.query("SELECT changes() AS c").get() as { c: number }).c > 0;
  } finally {
    db.close();
  }
}

/** Memory provider info — what's configured and available */
export interface MemoryProviderInfo {
  name: string;
  active: boolean;
  config: Record<string, string | number | boolean>;
}

// Per-provider local config/state file locations under HERMES_HOME.
// This is lookup data, not an enumeration — discovery comes from
// discoverMemoryProviders() below.
const MEMORY_CFG_FILES: Record<string, string[]> = {
  mem0: ["mem0.json"],
  honcho: ["honcho.json"],
  hindsight: ["hindsight/config.json"],
  supermemory: ["supermemory.json"],
  holographic: ["holographic.db"],
};

/** Scan the bundled hermes-agent memory-plugin dir for provider names
    (mirrors plugins/memory/__init__.py discover's dir walk). User-
    installed providers in $HERMES_HOME/plugins/ aren't distinguished
    from non-memory plugins without importing them — wait for the
    memory.providers RPC for those. */
function discoverMemoryProviders(): string[] {
  const names = new Set<string>(["builtin"]);
  try {
    for (const e of readdirSync(`${HERMES_HOME}/hermes-agent/plugins/memory`, { withFileTypes: true }))
      if (e.isDirectory() && !e.name.startsWith("_")) names.add(e.name);
  } catch {}
  return [...names];
}

/** Read memory provider configs from ~/.hermes/ — one entry per
    discovered provider, with any local config file parsed in. */
export async function readMemoryProviders(
  activeProvider: string,
): Promise<MemoryProviderInfo[]> {
  const out: MemoryProviderInfo[] = [];
  for (const name of discoverMemoryProviders()) {
    if (name === "builtin") { out.push({ name, active: true, config: {} }); continue; }
    const cfg: Record<string, string | number | boolean> = {};
    for (const f of MEMORY_CFG_FILES[name] ?? []) {
      try {
        const file = Bun.file(hermesPath(f));
        if (f.endsWith(".json")) {
          const raw = await file.json();
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              // Redact keys/tokens
              const lower = k.toLowerCase();
              if (lower.includes("key") || lower.includes("token") || lower.includes("secret")) {
                cfg[k] = typeof v === "string" ? `${v.slice(0, 4)}...` : v;
              } else {
                cfg[k] = v;
              }
            }
          }
        } else {
          const st = await file.stat();
          if (st) cfg["db_size"] = `${Math.round(st.size / 1024)}KB`;
        }
      } catch {}
    }
    out.push({ name, active: name === activeProvider, config: cfg });
  }
  return out;
}

/** Read SOUL.md */
export async function readSoul(): Promise<SoulInfo | null> {
  try {
    const file = Bun.file(hermesPath("SOUL.md"));
    const text = await file.text();
    return {
      source: makeSource("SOUL.md"),
      charCount: text.length,
      tokenEstimate: tokenCount(text),
      content: text,
    };
  } catch {
    return null;
  }
}

/** Read tool list from the most recent session JSON */
export async function readToolsFromLatestSession(): Promise<ToolsInfo | null> {
  try {
    const glob = new Bun.Glob("session_*.json");
    let latestPath = "";
    let latestTime = 0;

    for await (const path of glob.scan({ cwd: hermesPath("sessions") })) {
      const file = Bun.file(hermesPath(`sessions/${path}`));
      const stat = await file.stat();
      if (stat && stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs;
        latestPath = path;
      }
    }

    if (!latestPath) return null;

    const relative = `sessions/${latestPath}`;
    const file = Bun.file(hermesPath(relative));
    const data = await file.json();
    type RawTool = { function?: { name?: string; description?: string; parameters?: unknown } };
    const tools: ToolInfo[] = (data.tools || []).map((t: RawTool) => ({
      name: t?.function?.name ?? "unknown",
      descriptionLength: (t?.function?.description ?? "").length,
      paramsLength: JSON.stringify(t?.function?.parameters ?? {}).length,
    }));
    return {
      source: makeSource(relative, latestPath),
      tools,
    };
  } catch {
    return null;
  }
}

/** Read system prompt from the most recent state.db session that has a full one */
export function readSystemPromptInfo(): SystemPromptInfo | null {
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    // Short prompts (~700 chars) are the generic fallback without SOUL/memory/skills.
    const row = db
      .query(
        `SELECT id, system_prompt
         FROM sessions
         WHERE system_prompt IS NOT NULL AND length(system_prompt) > 1000
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { id: string; system_prompt: string } | null;
    db.close();
    if (!row) return null;
    return {
      source: makeSource("state.db"),
      sessionId: row.id,
      text: row.system_prompt,
      totalChars: row.system_prompt.length,
      tokenEstimate: tokenCount(row.system_prompt),
    };
  } catch {
    return null;
  }
}

export interface CronOutput {
  at: Date
  path: string
  text: string
}

/** Read the most recent cron output for a job, tail-truncated. */
export async function readCronOutput(
  jobId: string,
  tailLines = 40,
): Promise<CronOutput | null> {
  const dir = hermesPath(`cron/output/${jobId}`);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const md = entries.filter(f => f.endsWith(".md")).sort().reverse();
  if (md.length === 0) return null;
  const path = `${dir}/${md[0]}`;
  const full = await Bun.file(path).text();
  const lines = full.trimEnd().split("\n");
  const text =
    lines.length > tailLines
      ? `…(${lines.length - tailLines} earlier lines)\n` +
        lines.slice(-tailLines).join("\n")
      : full.trimEnd();
  const st = await stat(path);
  return { at: st.mtime, path, text };
}

// ─── Env File CRUD ──────────────────────────────────────────────────

const ENV_PATH = hermesPath(".env");

/** Parse ~/.hermes/.env into Record<string, string> */
export async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const text = await Bun.file(ENV_PATH).text();
    const vars: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return vars;
  } catch {
    return {};
  }
}

/** Update or append a KEY=VALUE in ~/.hermes/.env */
export async function writeEnvVar(key: string, value: string): Promise<void> {
  let text = "";
  try {
    text = await Bun.file(ENV_PATH).text();
  } catch { /* file may not exist */ }

  const lines = text.split("\n");
  let found = false;
  const updated = lines.map(line => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);

  await Bun.write(ENV_PATH, updated.join("\n"));
}

/** Remove a key from ~/.hermes/.env */
export async function removeEnvVar(key: string): Promise<void> {
  let text = "";
  try {
    text = await Bun.file(ENV_PATH).text();
  } catch { return; }

  const lines = text.split("\n").filter(l => !l.startsWith(`${key}=`));
  await Bun.write(ENV_PATH, lines.join("\n"));
}

// ─── Provider Catalog ───────────────────────────────────────────────

export const ENV_CATALOG: ReadonlyArray<{ category: string; keys: string[] }> = [
  {
    category: "LLM Providers",
    keys: [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
      "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY",
      "MISTRAL_API_KEY", "XAI_API_KEY", "TOGETHER_API_KEY",
      "FIREWORKS_API_KEY", "NOUS_API_KEY",
    ],
  },
  {
    category: "Tool API Keys",
    keys: [
      "FIRECRAWL_API_KEY", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID",
      "TAVILY_API_KEY", "EXA_API_KEY", "ELEVENLABS_API_KEY",
    ],
  },
  {
    category: "Messaging",
    keys: [
      "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN",
      "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN",
    ],
  },
  {
    category: "Agent",
    keys: ["API_SERVER_KEY", "MEM0_API_KEY"],
  },
];
