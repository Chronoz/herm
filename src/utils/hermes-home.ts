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
import { count as tokenCount } from "./tokens";

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
  /**
   * Token cost of this skill's index entry in the system prompt
   * (name + description + tags). Body content is NOT included — it
   * only loads on skill_view() and shows up as a tool result.
   */
  tokenEstimate: number;
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
       WHERE messages_fts MATCH ? AND s.source IN ('tui', 'cli')
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
      const indexEntry = `${name}: ${fm.description}${fm.tags.length ? ` [${fm.tags.join(",")}]` : ""}`;
      skills.push({
        source: makeSource(`skills/${path}`, `${name}/SKILL.md`),
        category,
        name,
        description: fm.description,
        tags: fm.tags,
        tokenEstimate: tokenCount(indexEntry),
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
