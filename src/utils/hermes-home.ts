/**
 * hermes-home.ts — Reader for the ~/.hermes/ directory.
 *
 * This is herm's window into the Hermes Agent's persistent state.
 * All reads are filesystem-based (Bun APIs), no HTTP needed.
 *
 * Data sources:
 *   config.yaml        — model, compression, memory limits, agent settings
 *   state.db           — SQLite session/message history with token counts
 *   memories/MEMORY.md — agent's personal notes (injected into system prompt)
 *   memories/USER.md   — user profile (injected into system prompt)
 *   gateway_state.json — gateway runtime state (pid, platforms, health)
 *   sessions/sessions.json — live session index with last_prompt_tokens
 *   skills/             — installed skill directories
 */

import { Database } from "bun:sqlite";
import { parse as parseYaml } from "yaml";

// ─── Path Resolution ─────────────────────────────────────────────────

const HOME = process.env.HOME || "/home/kaio";
const HERMES_HOME = process.env.HERMES_HOME || `${HOME}/.hermes`;

/** Resolve a path relative to ~/.hermes/ */
export const hermesPath = (relative: string): string =>
  `${HERMES_HOME}/${relative}`;

// ─── Types ───────────────────────────────────────────────────────────

/** Subset of config.yaml we care about */
export interface HermesConfig {
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
    threshold: number; // 0-1, e.g. 0.5
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
  content: string;
  charCount: number;
  charLimit: number;
  usagePercent: number;
  entryCount: number;
}

/** Gateway platform state */
export interface GatewayPlatformState {
  state: "connected" | "fatal" | "disconnected" | string;
  error_code?: string;
  error_message?: string;
  updated_at: string;
}

/** Gateway runtime state from gateway_state.json */
export interface GatewayState {
  pid: number;
  kind: string;
  start_time: number;
  gateway_state: string;
  platforms: Record<string, GatewayPlatformState>;
  updated_at: string;
}

/** A row from the sessions table in state.db */
export interface SessionRow {
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
  parent_session_id: string | null;
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

/** Aggregated snapshot of everything useful from ~/.hermes/ */
export interface HermesHomeSnapshot {
  config: HermesConfig | null;
  memory: MemoryFileInfo | null;
  userProfile: MemoryFileInfo | null;
  gateway: GatewayState | null;
  liveSessions: Record<string, LiveSession>;
  recentSessions: SessionRow[];
  skillCount: number;
  readAt: number; // epoch ms
  errors: string[]; // non-fatal read errors
}

// ─── Readers ─────────────────────────────────────────────────────────

/** Read and parse config.yaml */
export async function readConfig(): Promise<HermesConfig | null> {
  try {
    const file = Bun.file(hermesPath("config.yaml"));
    const text = await file.text();
    const raw = parseYaml(text);
    return {
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
        provider: raw?.memory?.provider ?? "file",
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
    const file = Bun.file(hermesPath(`memories/${filename}`));
    const content = await file.text();
    const entryCount = content.split("§").filter((s) => s.trim()).length;
    return {
      content,
      charCount: content.length,
      charLimit,
      usagePercent: charLimit > 0 ? Math.round((content.length / charLimit) * 100) : 0,
      entryCount,
    };
  } catch {
    return null;
  }
}

/** Read gateway_state.json */
export async function readGatewayState(): Promise<GatewayState | null> {
  try {
    const file = Bun.file(hermesPath("gateway_state.json"));
    const text = await file.text();
    return JSON.parse(text);
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

/** Query state.db for recent sessions */
export function queryRecentSessions(limit: number = 10): SessionRow[] {
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    const rows = db
      .query(
        `SELECT id, source, model, started_at, ended_at, end_reason,
                message_count, tool_call_count,
                input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, reasoning_tokens,
                estimated_cost_usd, title, parent_session_id
         FROM sessions
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit) as SessionRow[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

/** Query state.db for a specific session by ID */
export function querySession(sessionId: string): SessionRow | null {
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    const row = db
      .query(
        `SELECT id, source, model, started_at, ended_at, end_reason,
                message_count, tool_call_count,
                input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, reasoning_tokens,
                estimated_cost_usd, title, parent_session_id
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId) as SessionRow | null;
    db.close();
    return row;
  } catch {
    return null;
  }
}

/** Count installed skills in ~/.hermes/skills/ */
export async function countSkills(): Promise<number> {
  try {
    const glob = new Bun.Glob("**/SKILL.md");
    let count = 0;
    for await (const _ of glob.scan({ cwd: hermesPath("skills") })) {
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ─── Composite Reader ────────────────────────────────────────────────

/**
 * Read a full snapshot of ~/.hermes/ state.
 * Resilient — individual read failures are logged but don't block others.
 */
export async function readHermesHome(): Promise<HermesHomeSnapshot> {
  const errors: string[] = [];
  const snapshot: HermesHomeSnapshot = {
    config: null,
    memory: null,
    userProfile: null,
    gateway: null,
    liveSessions: {},
    recentSessions: [],
    skillCount: 0,
    readAt: Date.now(),
    errors,
  };

  // Read config first — other reads depend on limits from it
  try {
    snapshot.config = await readConfig();
  } catch (e: any) {
    errors.push(`config: ${e.message}`);
  }

  const memLimit = snapshot.config?.memory?.memory_char_limit ?? 2200;
  const userLimit = snapshot.config?.memory?.user_char_limit ?? 1375;

  // Run independent reads in parallel
  const [memory, userProfile, gateway, liveSessions, skillCount] =
    await Promise.allSettled([
      readMemoryFile("MEMORY.md", memLimit),
      readMemoryFile("USER.md", userLimit),
      readGatewayState(),
      readLiveSessions(),
      countSkills(),
    ]);

  if (memory.status === "fulfilled") snapshot.memory = memory.value;
  else errors.push(`memory: ${memory.reason}`);

  if (userProfile.status === "fulfilled")
    snapshot.userProfile = userProfile.value;
  else errors.push(`userProfile: ${userProfile.reason}`);

  if (gateway.status === "fulfilled") snapshot.gateway = gateway.value;
  else errors.push(`gateway: ${gateway.reason}`);

  if (liveSessions.status === "fulfilled")
    snapshot.liveSessions = liveSessions.value;
  else errors.push(`liveSessions: ${liveSessions.reason}`);

  if (skillCount.status === "fulfilled")
    snapshot.skillCount = skillCount.value;
  else errors.push(`skillCount: ${skillCount.reason}`);

  // SQLite is sync in bun:sqlite, run separately
  try {
    snapshot.recentSessions = queryRecentSessions(10);
  } catch (e: any) {
    errors.push(`stateDb: ${e.message}`);
  }

  return snapshot;
}
