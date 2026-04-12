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
import { parse as parseYaml } from "yaml";

// ─── Path Resolution ─────────────────────────────────────────────────

const HOME = process.env.HOME || "/home/kaio";
const HERMES_HOME = process.env.HERMES_HOME || `${HOME}/.hermes`;

/** Resolve a path relative to ~/.hermes/ */
export const hermesPath = (relative: string): string =>
  `${HERMES_HOME}/${relative}`;

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

/** Gateway platform state */
export interface GatewayPlatformState {
  state: "connected" | "fatal" | "disconnected" | string;
  error_code?: string;
  error_message?: string;
  updated_at: string;
}

/** Gateway runtime state from gateway_state.json */
export interface GatewayState {
  source: Source;
  pid: number;
  kind: string;
  start_time: number;
  gateway_state: string;
  platforms: Record<string, GatewayPlatformState>;
  updated_at: string;
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
}

/** SOUL.md info */
export interface SoulInfo {
  source: Source;
  charCount: number;
  tokenEstimate: number;
}

/** System prompt breakdown */
export interface SystemPromptInfo {
  source: Source;
  totalChars: number;
  tokenEstimate: number;
}

/** Tool list with its source session file */
export interface ToolsInfo {
  source: Source;
  tools: ToolInfo[];
}

/** Aggregated snapshot of everything useful from ~/.hermes/ */
export interface HermesHomeSnapshot {
  config: HermesConfig | null;
  memory: MemoryFileInfo | null;
  userProfile: MemoryFileInfo | null;
  gateway: GatewayState | null;
  liveSessions: Record<string, LiveSession>;
  recentSessions: SessionRow[];
  skills: SkillInfo[];
  toolsInfo: ToolsInfo | null;
  soul: SoulInfo | null;
  systemPrompt: SystemPromptInfo | null;
  readAt: number;
  errors: string[];
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

/** Read gateway_state.json */
export async function readGatewayState(): Promise<GatewayState | null> {
  try {
    const file = Bun.file(hermesPath("gateway_state.json"));
    const text = await file.text();
    const raw = JSON.parse(text);
    return {
      source: makeSource("gateway_state.json"),
      ...raw,
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

/** Query state.db for recent sessions */
export function queryRecentSessions(limit: number = 10): SessionRow[] {
  const dbSource = makeSource("state.db");
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
      parent_session_id: string | null;
    }>;
    db.close();
    return rows.map((row) => ({
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
      parent_session_id: row.parent_session_id,
    }));
  } catch {
    return [];
  }
}

/** Query state.db for a specific session by ID */
export function querySession(sessionId: string): SessionRow | null {
  const dbSource = makeSource("state.db");
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
      .get(sessionId) as {
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
    } | null;
    db.close();
    if (!row) return null;
    return {
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
      parent_session_id: row.parent_session_id,
    };
  } catch {
    return null;
  }
}

/** List installed skills with category info */
export async function listSkills(): Promise<SkillInfo[]> {
  try {
    const glob = new Bun.Glob("**/SKILL.md");
    const skills: SkillInfo[] = [];
    for await (const path of glob.scan({ cwd: hermesPath("skills") })) {
      const parts = path.replace("/SKILL.md", "").split("/");
      const name = parts[parts.length - 1];
      const category = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      skills.push({
        source: makeSource(`skills/${path}`, `${name}/SKILL.md`),
        category,
        name,
      });
    }
    return skills.sort((a, b) => a.source.relative.localeCompare(b.source.relative));
  } catch {
    return [];
  }
}

/** Read SOUL.md */
export async function readSoul(): Promise<SoulInfo | null> {
  try {
    const file = Bun.file(hermesPath("SOUL.md"));
    const text = await file.text();
    return {
      source: makeSource("SOUL.md"),
      charCount: text.length,
      tokenEstimate: Math.ceil(text.length / 4),
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
    const tools: ToolInfo[] = (data.tools || []).map((t: any) => ({
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

/** Read system prompt size from the most recent state.db session */
export function readSystemPromptInfo(): SystemPromptInfo | null {
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    const row = db
      .query(
        `SELECT length(system_prompt) as sp_len
         FROM sessions
         WHERE system_prompt IS NOT NULL AND length(system_prompt) > 0
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { sp_len: number } | null;
    db.close();
    if (!row) return null;
    return {
      source: makeSource("state.db"),
      totalChars: row.sp_len,
      tokenEstimate: Math.ceil(row.sp_len / 4),
    };
  } catch {
    return null;
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
    skills: [],
    toolsInfo: null,
    soul: null,
    systemPrompt: null,
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
  const [memory, userProfile, gateway, liveSessions, skills, soul, toolsInfo] =
    await Promise.allSettled([
      readMemoryFile("MEMORY.md", memLimit),
      readMemoryFile("USER.md", userLimit),
      readGatewayState(),
      readLiveSessions(),
      listSkills(),
      readSoul(),
      readToolsFromLatestSession(),
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

  if (skills.status === "fulfilled") snapshot.skills = skills.value;
  else errors.push(`skills: ${skills.reason}`);

  if (soul.status === "fulfilled") snapshot.soul = soul.value;
  else errors.push(`soul: ${soul.reason}`);

  if (toolsInfo.status === "fulfilled") snapshot.toolsInfo = toolsInfo.value;
  else errors.push(`toolsInfo: ${toolsInfo.reason}`);

  // SQLite is sync in bun:sqlite, run separately
  try {
    snapshot.recentSessions = queryRecentSessions(10);
  } catch (e: any) {
    errors.push(`stateDb: ${e.message}`);
  }

  try {
    snapshot.systemPrompt = readSystemPromptInfo();
  } catch (e: any) {
    errors.push(`systemPrompt: ${e.message}`);
  }

  return snapshot;
}
