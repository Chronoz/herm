#!/usr/bin/env bun
/**
 * gen-schema — derive src/config/schema.ts from the installed Hermes agent's
 * DEFAULT_CONFIG literal in hermes_cli/config.py.
 *
 * The literal is the de-facto schema: it names every key, gives a default
 * (which implies the type), and most leaves carry a #-comment doc either on
 * the preceding lines or trailing the value. We scrape all three.
 *
 * Python does the heavy lifting (ast.literal_eval + line-walk for docs) so
 * this script doesn't re-implement a Python parser. Output is a committed
 * .ts file — regenerate with `bun scripts/gen-schema.ts` after an agent pull.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"

const HOME = process.env.HOME!
const HERMES_HOME = process.env.HERMES_HOME || join(HOME, ".hermes")

const CANDIDATES = [
  process.env.HERMES_AGENT_SRC,
  join(HERMES_HOME, "hermes-agent"),
  join(HOME, "Dev", "clones", "hermes-agent"),
].filter(Boolean) as string[]

const agentRoot = CANDIDATES.find(p => existsSync(join(p, "hermes_cli", "config.py")))
if (!agentRoot) {
  console.error("gen-schema: could not locate hermes_cli/config.py under any of:", CANDIDATES)
  process.exit(1)
}
const configPy = join(agentRoot, "hermes_cli", "config.py")
const sha = (() => {
  const p = Bun.spawnSync(["git", "-C", agentRoot, "rev-parse", "--short", "HEAD"])
  return p.exitCode === 0 ? new TextDecoder().decode(p.stdout).trim() : "unknown"
})()
const sourceLabel = `hermes-agent@${sha} hermes_cli/config.py`

// ─── extract via python3 ─────────────────────────────────────────────

const py = `
import ast, json, re, sys

path = ${JSON.stringify(configPy)}
with open(path, encoding="utf-8") as f:
    src = f.read()
lines = src.splitlines()

# locate DEFAULT_CONFIG = { ... } by brace balance
start = next(i for i, l in enumerate(lines) if re.match(r"^DEFAULT_CONFIG\\s*=\\s*{", l))
depth, end = 0, start
for i in range(start, len(lines)):
    depth += lines[i].count("{") - lines[i].count("}")
    if depth == 0:
        end = i
        break
block = "\\n".join(lines[start:end + 1]).split("=", 1)[1].strip()
tree = ast.literal_eval(block)

# doc map: dotted-path -> text. Walk lines tracking key stack via indent+braces.
KEY = re.compile(r'^(\\s*)"([^"]+)"\\s*:\\s*(.*)$')
docs: dict[str, str] = {}
stack: list[tuple[int, str]] = []   # (indent, key)
pending: list[str] = []             # accumulated #-lines above next key
last_key: str = ""
last_ind: int = -1

def strip_hash(s: str) -> str:
    return re.sub(r"^#\\s?", "", s.strip())

for raw in lines[start + 1:end]:
    stripped = raw.strip()
    if not stripped:
        pending.clear(); continue
    if stripped.startswith("#"):
        ind = len(raw) - len(raw.lstrip())
        # deeper indent than the key just seen → trailing-comment continuation, not preceding doc
        if last_key and ind > last_ind:
            docs[last_key] = (docs.get(last_key, "") + " " + strip_hash(stripped)).strip()
        else:
            pending.append(strip_hash(stripped))
        continue
    m = KEY.match(raw)
    if not m:
        # closing brace or list item — drop stack frames shallower than this indent on '}'
        if stripped.startswith(("}", "},")):
            ind = len(raw) - len(raw.lstrip())
            while stack and stack[-1][0] >= ind:
                stack.pop()
        pending.clear(); continue
    ind, key, rest = len(m.group(1)), m.group(2), m.group(3)
    while stack and stack[-1][0] >= ind:
        stack.pop()
    dotted = ".".join([k for _, k in stack] + [key])
    # trailing same-line comment (outside string literal — crude but DEFAULT_CONFIG has no '#' inside strings)
    trail = ""
    h = rest.find("#")
    if h >= 0 and rest[:h].count('"') % 2 == 0:
        trail = strip_hash(rest[h:])
    doc = " ".join(pending).strip() or trail
    if doc:
        docs[dotted] = doc
    pending.clear()
    last_key, last_ind = dotted, ind
    # does this key open a nested dict literal?
    body = (rest[:h] if h >= 0 and trail else rest).rstrip(",").strip()
    if body.endswith("{") and not body.endswith("{}"):
        stack.append((ind, key))
        last_key = ""

def walk(node, prefix=""):
    for k, v in node.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict) and v:
            yield from walk(v, p)
        else:
            if isinstance(v, bool): t = "bool"
            elif isinstance(v, int): t = "int"
            elif isinstance(v, float): t = "float"
            elif isinstance(v, str): t = "str"
            elif isinstance(v, list): t = "list"
            elif isinstance(v, dict): t = "dict"
            elif v is None: t = "null"
            else: t = "str"
            yield p, {"type": t, "default": v, "doc": docs.get(p, "")}

out = dict(walk(tree))
json.dump({"source": path, "entries": out}, sys.stdout)
`

const proc = Bun.spawnSync(["python3", "-c", py])
if (proc.exitCode !== 0) {
  console.error("gen-schema: python extraction failed")
  console.error(new TextDecoder().decode(proc.stderr))
  process.exit(1)
}
const extracted = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
  source: string
  entries: Record<string, { type: string; default: unknown; doc: string }>
}

// ─── augment ─────────────────────────────────────────────────────────

/** Keys read by the agent that aren't in DEFAULT_CONFIG (user-adds-only). */
const EXTRA: Record<string, { type: string; default: unknown; doc: string }> = {
  custom_providers: { type: "dict", default: {}, doc: "OpenAI-compatible provider definitions keyed by name." },
  mcp_servers: { type: "dict", default: {}, doc: "MCP server definitions keyed by name." },
  fallback_model: { type: "dict", default: null, doc: "Fallback model (dict) or chain (list of dicts) for provider failover." },
  "agent.reasoning_effort": { type: "str", default: "", doc: "Reasoning effort for the main agent: none | minimal | low | medium | high | xhigh." },
  "agent.system_prompt": { type: "str", default: "", doc: "System-prompt override applied by the active personality." },
  custom_prompt: { type: "str", default: "", doc: "Ad-hoc system-prompt addendum set via /prompt." },
  provider: { type: "str", default: "", doc: "Default model provider." },
}

const RPC_LIVE = new Set([
  "model", "provider",
  "agent.service_tier", "agent.reasoning_effort",
  "display.show_reasoning", "display.tool_progress", "display.personality",
])

type Effect = "live" | "session" | "restart"
const effectOf = (key: string): Effect => {
  if (RPC_LIVE.has(key)) return "live"
  const root = key.split(".")[0]
  if (root === "terminal" || key === "toolsets" || key === "mcp_servers" || key === "skills.external_dirs")
    return "restart"
  if (root === "agent" || root === "auxiliary" || root === "memory" || root === "delegation")
    return "session"
  return "live"
}

type Entry = {
  type: "bool" | "int" | "float" | "str" | "list" | "dict" | "null"
  default: unknown
  doc: string
  group: string
  effect: Effect
}

const all: Record<string, Entry> = {}
for (const [k, v] of Object.entries({ ...extracted.entries, ...EXTRA })) {
  if (k.startsWith("_")) continue // _config_version etc.
  all[k] = {
    type: v.type as Entry["type"],
    default: v.default,
    doc: v.doc,
    group: k.includes(".") ? k.split(".")[0] : "general",
    effect: effectOf(k),
  }
}

const keys = Object.keys(all).sort()

// ─── emit ────────────────────────────────────────────────────────────

const outDir = join(import.meta.dir, "..", "src", "config")
mkdirSync(outDir, { recursive: true })

const body = [
  `// Generated by scripts/gen-schema.ts — do not edit by hand.`,
  `// Source: ${sourceLabel}`,
  `// Keys: ${keys.length}`,
  ``,
  `export type ConfigType = "bool" | "int" | "float" | "str" | "list" | "dict" | "null"`,
  `export type ConfigEffect = "live" | "session" | "restart"`,
  ``,
  `export interface ConfigSchemaEntry {`,
  `  type: ConfigType`,
  `  default: unknown`,
  `  doc: string`,
  `  group: string`,
  `  effect: ConfigEffect`,
  `}`,
  ``,
  `export const SCHEMA: Record<string, ConfigSchemaEntry> = {`,
  ...keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(all[k])},`),
  `}`,
  ``,
  `export const SCHEMA_KEYS = Object.keys(SCHEMA)`,
  ``,
].join("\n")

writeFileSync(join(outDir, "schema.ts"), body)
console.error(`gen-schema: wrote src/config/schema.ts (${keys.length} keys) from ${agentRoot}`)
