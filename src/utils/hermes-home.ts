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
import { homedir } from "os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as perf from "./perf";

// ─── Path Resolution ─────────────────────────────────────────────────

const HOME = process.env.HOME || homedir();
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
  lastMessage: string | null;
  last_active: number | null;
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
  description: string;
  tags: string[];
}

/** SOUL.md info */
export interface SoulInfo {
  source: Source;
  charCount: number;
  tokenEstimate: number;
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

/** Write config object to config.yaml */
export async function writeConfig(config: Record<string, unknown>): Promise<void> {
  const text = stringifyYaml(config);
  await Bun.write(hermesPath("config.yaml"), text);
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

/** Query state.db for recent sessions — falls back to first user message as title */
export function queryRecentSessions(limit: number = 30): SessionRow[] {
  const end = perf.mark("io:queryRecentSessions")
  const dbSource = makeSource("state.db");
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });
    const rows = db
      .query(
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
    }>;
    db.close();
    const mapped = rows.map((row) => ({
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
    }));
    end()
    return mapped
  } catch {
    end()
    return [];
  }
}

/** Memory provider info — what's configured and available */
export interface MemoryProviderInfo {
  name: string;
  active: boolean;
  config: Record<string, string | number | boolean>;
}

/** Read memory provider configs from ~/.hermes/ */
export async function readMemoryProviders(
  activeProvider: string,
): Promise<MemoryProviderInfo[]> {
  const providers: MemoryProviderInfo[] = [];

  // Built-in is always present
  providers.push({ name: "builtin", active: true, config: {} });

  // Known providers and their config file patterns
  const known: Array<{ name: string; files: string[] }> = [
    { name: "mem0", files: ["mem0.json"] },
    { name: "honcho", files: ["honcho.json"] },
    { name: "hindsight", files: ["hindsight/config.json"] },
    { name: "supermemory", files: ["supermemory.json"] },
    { name: "holographic", files: ["holographic.db"] },
    { name: "openviking", files: [] },
    { name: "retaindb", files: [] },
    { name: "byterover", files: [] },
  ];

  for (const p of known) {
    const cfg: Record<string, string | number | boolean> = {};
    let found = false;

    for (const f of p.files) {
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
          found = true;
        } else {
          // Non-JSON (like .db) — just check existence
          const stat = await file.stat();
          if (stat) {
            cfg["db_size"] = `${Math.round(stat.size / 1024)}KB`;
            found = true;
          }
        }
      } catch {
        // file doesn't exist
      }
    }

    if (found || p.name === activeProvider) {
      providers.push({
        name: p.name,
        active: p.name === activeProvider,
        config: cfg,
      });
    }
  }

  return providers;
}

// ─── Analytics ────────────────────────────────────────────────────────

export interface DailyRow {
  day: string;
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  cost: number;
  sessions: number;
}

export interface ModelRow {
  model: string;
  input: number;
  output: number;
  cost: number;
  sessions: number;
}

interface TotalsRow {
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  estimated: number;
  actual: number;
  sessions: number;
}

export interface AnalyticsData {
  daily: DailyRow[];
  models: ModelRow[];
  totals: TotalsRow;
}

/** Query analytics aggregates from state.db for the last N days */
export function queryAnalytics(days: number): AnalyticsData {
  const endTiming = perf.mark("io:queryAnalytics")
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const empty: AnalyticsData = {
    daily: [],
    models: [],
    totals: { input: 0, output: 0, cache: 0, reasoning: 0, estimated: 0, actual: 0, sessions: 0 },
  };
  try {
    const db = new Database(hermesPath("state.db"), { readonly: true });

    const daily = db
      .query(
        `SELECT date(started_at, 'unixepoch') as day,
                SUM(input_tokens), SUM(output_tokens),
                SUM(cache_read_tokens), SUM(reasoning_tokens),
                COALESCE(SUM(estimated_cost_usd),0), COUNT(*)
         FROM sessions WHERE started_at > ?
         GROUP BY day ORDER BY day`,
      )
      .all(cutoff) as Array<Record<string, unknown>>;

    const models = db
      .query(
        `SELECT model, SUM(input_tokens), SUM(output_tokens),
                COALESCE(SUM(estimated_cost_usd),0), COUNT(*)
         FROM sessions WHERE started_at > ? AND model IS NOT NULL
         GROUP BY model ORDER BY SUM(input_tokens)+SUM(output_tokens) DESC`,
      )
      .all(cutoff) as Array<Record<string, unknown>>;

    const totals = db
      .query(
        `SELECT SUM(input_tokens), SUM(output_tokens),
                SUM(cache_read_tokens), SUM(reasoning_tokens),
                COALESCE(SUM(estimated_cost_usd),0),
                COALESCE(SUM(actual_cost_usd),0), COUNT(*)
         FROM sessions WHERE started_at > ?`,
      )
      .all(cutoff) as Array<Record<string, unknown>>;

    db.close();

    const vals = (row: Record<string, unknown>) => Object.values(row);

    const data = {
      daily: daily.map((r) => {
        const v = vals(r);
        return {
          day: String(v[0]),
          input: Number(v[1]) || 0,
          output: Number(v[2]) || 0,
          cache: Number(v[3]) || 0,
          reasoning: Number(v[4]) || 0,
          cost: Number(v[5]) || 0,
          sessions: Number(v[6]) || 0,
        };
      }),
      models: models.map((r) => {
        const v = vals(r);
        return {
          model: String(v[0]),
          input: Number(v[1]) || 0,
          output: Number(v[2]) || 0,
          cost: Number(v[3]) || 0,
          sessions: Number(v[4]) || 0,
        };
      }),
      totals: (() => {
        const v = totals[0] ? vals(totals[0]) : [];
        return {
          input: Number(v[0]) || 0,
          output: Number(v[1]) || 0,
          cache: Number(v[2]) || 0,
          reasoning: Number(v[3]) || 0,
          estimated: Number(v[4]) || 0,
          actual: Number(v[5]) || 0,
          sessions: Number(v[6]) || 0,
        };
      })(),
    };
    endTiming()
    return data
  } catch {
    endTiming()
    return empty;
  }
}

/** Parse YAML frontmatter from a SKILL.md file */
function parseFrontmatter(text: string): { description: string; tags: string[] } {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: "", tags: [] };
  const desc = match[1].match(/^description:\s*(.+)/m);
  const tags = match[1].match(/^tags:\s*\[(.+)\]/m);
  return {
    description: desc ? desc[1].trim() : "",
    tags: tags ? tags[1].split(",").map(t => t.trim()) : [],
  };
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
      const fm = await Bun.file(hermesPath(`skills/${path}`)).text()
        .then(parseFrontmatter)
        .catch(() => ({ description: "", tags: [] as string[] }));
      skills.push({
        source: makeSource(`skills/${path}`, `${name}/SKILL.md`),
        category,
        name,
        description: fm.description,
        tags: fm.tags,
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
function readSystemPromptInfo(): SystemPromptInfo | null {
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
      tokenEstimate: Math.ceil(row.system_prompt.length / 4),
    };
  } catch {
    return null;
  }
}

// ─── Toolsets ─────────────────────────────────────────────────────────

/** Known toolset → tool name mapping */
const TOOLSET_MAP: Record<string, string[]> = {
  terminal: ["terminal", "process"],
  file: ["read_file", "write_file", "search_files", "patch"],
  web: ["browser_navigate", "browser_click", "browser_type", "browser_snapshot", "browser_scroll", "browser_press", "browser_back", "browser_vision", "browser_console", "browser_get_images"],
  code: ["execute_code"],
  delegate: ["delegate_task"],
  memory: ["memory", "session_search", "skill_manage", "skill_view", "skills_list"],
  productivity: ["todo", "cronjob", "image_generate", "text_to_speech"],
  clarify: ["clarify"],
};

/** Info about a single toolset */
export interface ToolsetInfo {
  name: string;
  tools: string[];
  enabled: boolean;
  active: string[];
}

/** Read toolsets: parse config.yaml for enabled list, cross-ref with session tools */
export async function readToolsets(): Promise<ToolsetInfo[]> {
  let enabled: string[] = [];
  try {
    const text = await Bun.file(hermesPath("config.yaml")).text();
    const raw = parseYaml(text);
    if (Array.isArray(raw?.toolsets)) enabled = raw.toolsets;
  } catch {
    // no config — treat all as enabled
  }

  const info = await readToolsFromLatestSession();
  const live = new Set(info?.tools.map(t => t.name) ?? []);

  return Object.entries(TOOLSET_MAP).map(([name, tools]) => ({
    name,
    tools,
    enabled: enabled.length === 0 || enabled.includes(name),
    active: tools.filter(t => live.has(t)),
  }));
}

// ─── Composite Reader ────────────────────────────────────────────────

/**
 * Read a full snapshot of ~/.hermes/ state.
 * Resilient — individual read failures are logged but don't block others.
 */
export async function readHermesHome(): Promise<HermesHomeSnapshot> {
  const end = perf.mark("io:readHermesHome")
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
  } catch (e: unknown) {
    errors.push(`config: ${(e as Error).message}`);
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
    snapshot.recentSessions = queryRecentSessions();
  } catch (e: unknown) {
    errors.push(`stateDb: ${(e as Error).message}`);
  }

  try {
    snapshot.systemPrompt = readSystemPromptInfo();
  } catch (e: unknown) {
    errors.push(`systemPrompt: ${(e as Error).message}`);
  }

  end()
  return snapshot;
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

/** Redact a value: show first 4 chars + '...' */
export const redact = (value: string): string =>
  value.length <= 4 ? value : `${value.slice(0, 4)}...`;

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
