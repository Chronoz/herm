import { useState, useEffect, useCallback, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { useGateway } from "../app/gateway";
import { useTheme } from "../theme";
import { useToast } from "../ui/toast";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

// ─── Schema ──────────────────────────────────────────────────────────

const CATEGORIES = [
  "general", "agent", "terminal", "display", "delegation",
  "memory", "compression", "security", "browser", "voice",
  "tts", "stt", "logging", "discord", "auxiliary",
] as const;

type Category = (typeof CATEGORIES)[number];

const MERGES: Record<string, Category> = {
  privacy: "security",
  context: "agent",
  skills: "agent",
  cron: "agent",
  network: "agent",
  checkpoints: "agent",
  approvals: "security",
  human_delay: "display",
  smart_model_routing: "agent",
};

const SELECTS: Record<string, string[]> = {
  "terminal.backend": ["local", "docker", "ssh", "modal", "daytona", "singularity"],
  "tts.provider": ["edge", "elevenlabs", "openai", "neutts"],
  "display.skin": ["default", "ares", "mono", "slate"],
  "approvals.mode": ["ask", "yolo", "deny"],
  "logging.level": ["DEBUG", "INFO", "WARNING", "ERROR"],
  "agent.reasoning_effort": ["none", "minimal", "low", "medium", "high", "xhigh"],
  "model.provider": ["auto", "openai", "anthropic", "openrouter", "local"],
  "memory.provider": ["", "sqlite", "file"],
  "display.personality": ["default", "minimal", "verbose"],
};

// ─── Helpers ─────────────────────────────────────────────────────────

type FieldType = "boolean" | "select" | "number" | "string" | "list";

type Field = {
  key: string;
  label: string;
  type: FieldType;
  value: unknown;
  options?: string[];
};

const classify = (key: string, val: unknown): FieldType => {
  if (SELECTS[key]) return "select";
  if (typeof val === "boolean") return "boolean";
  if (typeof val === "number") return "number";
  if (Array.isArray(val)) return "list";
  return "string";
};

const flatten = (obj: Record<string, unknown>, prefix = ""): [string, unknown][] =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v))
      return flatten(v as Record<string, unknown>, key);
    return [[key, v]];
  });

const categorize = (key: string): Category => {
  const root = key.split(".")[0];
  if (MERGES[root]) return MERGES[root];
  if (CATEGORIES.includes(root as Category)) return root as Category;
  if (root === "model" || root === "gateway") return "general";
  return "auxiliary";
};

const setNested = (obj: Record<string, unknown>, path: string, val: unknown) => {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object")
      cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = val;
};

const getNested = (obj: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && !Array.isArray(cur))
      cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
};

// ─── Field Row ───────────────────────────────────────────────────────

const FieldRow = memo((props: {
  field: Field;
  active: boolean;
  changed: boolean;
  editing: boolean;
  buf: string;
}) => {
  const theme = useTheme().theme;
  const f = props.field;
  const bg = props.active ? theme.backgroundElement : undefined;
  const indicator = props.active ? "▸ " : "  ";
  const mark = props.changed ? "● " : "  ";

  const display = (): string => {
    if (props.editing) return props.buf + "█";
    if (f.type === "boolean") return f.value ? "✓ ON" : "✗ OFF";
    if (f.type === "list") return Array.isArray(f.value) ? (f.value as string[]).join(", ") : String(f.value ?? "");
    if (f.type === "select") return String(f.value ?? "");
    return String(f.value ?? "");
  };

  const hint = (): string => {
    if (f.type === "boolean") return "[space]";
    if (f.type === "select") return "[h/l]";
    return "[enter]";
  };

  return (
    <box backgroundColor={bg}>
      <text>
        <span fg={props.changed ? theme.warning : theme.textMuted}>{mark}</span>
        <span fg={props.active ? theme.primary : theme.text}>{indicator}</span>
        <span fg={props.active ? theme.accent : theme.text}>
          {f.label.padEnd(28)}
        </span>
        <span fg={f.type === "boolean" ? (f.value ? theme.success : theme.error) : theme.text}>
          {display().padEnd(30)}
        </span>
        <span fg={theme.textMuted}>
          {props.active ? hint() : ""}
        </span>
      </text>
    </box>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

export const Config = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const toast = useToast();
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const [original, setOriginal] = useState<Record<string, unknown>>({});
  const [yaml, setYaml] = useState("");
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [cat, setCat] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [buf, setBuf] = useState("");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<"categories" | "fields">("categories");

  const load = useCallback(() => {
    gw.request<{ config?: Record<string, unknown> }>("config.get", { key: "full" })
      .then(res => {
        const parsed = res.config ?? {};
        setRaw(structuredClone(parsed));
        setOriginal(structuredClone(parsed));
        setYaml(yamlStringify(parsed));
      })
      .catch(() => {
        setRaw({});
        setOriginal({});
        setYaml("");
      });
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  const entries = flatten(raw);
  const grouped = entries.reduce((map, [key, val]) => {
    const c = categorize(key);
    const label = key.split(".").slice(1).join(".") || key;
    if (!map.has(c)) map.set(c, []);
    map.get(c)!.push({ key, label, type: classify(key, val), value: val, options: SELECTS[key] });
    return map;
  }, new Map<Category, Field[]>(CATEGORIES.map(c => [c, []])));

  const active = CATEGORIES[cat];
  const fields = searching && query.trim()
    ? entries
        .filter(([key]) => key.toLowerCase().includes(query.toLowerCase()))
        .map(([key, val]) => ({
          key,
          label: key,
          type: classify(key, val),
          value: val,
          options: SELECTS[key],
        }))
    : (grouped.get(active) ?? []);

  const count = fields.length;

  const changed = (key: string): boolean =>
    JSON.stringify(getNested(raw, key)) !== JSON.stringify(getNested(original, key));

  const hasChanges = entries.some(([key]) => changed(key));

  const update = (key: string, val: unknown) => {
    const next = structuredClone(raw);
    setNested(next, key, val);
    setRaw(next);
    setYaml(yamlStringify(next));
  };

  const save = async () => {
    const target = mode === "yaml" ? (yamlParse(yaml) ?? {}) : raw;
    const flat = flatten(target as Record<string, unknown>);
    const results = await Promise.allSettled(
      flat
        .filter(([key]) => JSON.stringify(getNested(target as Record<string, unknown>, key)) !== JSON.stringify(getNested(original, key)))
        .map(([key, val]) => gw.request("config.set", { key, value: val }))
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    setRaw(structuredClone(target));
    setOriginal(structuredClone(target));
    if (mode === "form") setYaml(yamlStringify(target));
    if (fail > 0) toast.show({ variant: "error", message: `Saved ${ok}, ${fail} failed` });
    else toast.show({ variant: "success", message: results.length === 0 ? "No changes" : "Config saved" });
  };

  useKeyboard((key) => {
    if (!props.focused) return;
    if (key.name === "tab" && !editing && !searching) {
      setMode(m => m === "form" ? "yaml" : "form");
      return;
    }

    if (key.ctrl && key.name === "s") {
      save();
      return;
    }

    if (mode === "yaml") {
      if (key.name === "backspace") { setYaml(prev => prev.slice(0, -1)); return; }
      if (key.name === "return") { setYaml(prev => prev + "\n"); return; }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setYaml(prev => prev + key.raw);
        return;
      }
      return;
    }

    if (!editing && !searching && key.raw === "/") {
      setSearching(true);
      setQuery("");
      setCursor(0);
      return;
    }

    if (searching) {
      if (key.name === "escape") { setSearching(false); setQuery(""); setCursor(0); return; }
      if (key.name === "backspace") { setQuery(prev => prev.slice(0, -1)); setCursor(0); return; }
      if (key.name === "up") { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.name === "down") { setCursor(c => Math.min(count - 1, c + 1)); return; }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery(prev => prev + key.raw);
        setCursor(0);
        return;
      }
      return;
    }

    if (editing) {
      if (key.name === "escape") { setEditing(false); setBuf(""); return; }
      if (key.name === "return") {
        const f = fields[cursor];
        if (f) {
          const val = f.type === "number" ? Number(buf) || 0
            : f.type === "list" ? buf.split(",").map(s => s.trim())
            : buf;
          update(f.key, val);
        }
        setEditing(false);
        setBuf("");
        return;
      }
      if (key.name === "backspace") { setBuf(prev => prev.slice(0, -1)); return; }
      if (key.raw && key.raw.length === 1) { setBuf(prev => prev + key.raw); return; }
      return;
    }

    if (key.name === "left") { setFocus("categories"); return; }
    if (key.name === "right") { setFocus("fields"); return; }

    if (focus === "categories") {
      if (key.name === "up") { setCat(c => Math.max(0, c - 1)); setCursor(0); return; }
      if (key.name === "down") { setCat(c => Math.min(CATEGORIES.length - 1, c + 1)); setCursor(0); return; }
      if (key.name === "return") { setFocus("fields"); return; }
      return;
    }

    if (key.name === "up") { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.name === "down") { setCursor(c => Math.min(count - 1, c + 1)); return; }

    const f = fields[cursor];
    if (!f) return;

    if (key.name === "space" && f.type === "boolean") {
      update(f.key, !f.value);
      return;
    }

    if (f.type === "select" && f.options) {
      const idx = f.options.indexOf(String(f.value));
      if (key.raw === "l" || key.raw === "]") {
        update(f.key, f.options[(idx + 1) % f.options.length]);
        return;
      }
      if (key.raw === "h" || key.raw === "[") {
        update(f.key, f.options[(idx - 1 + f.options.length) % f.options.length]);
        return;
      }
    }

    if (key.name === "return" && (f.type === "string" || f.type === "number" || f.type === "list")) {
      setEditing(true);
      setBuf(f.type === "list" && Array.isArray(f.value) ? (f.value as string[]).join(", ") : String(f.value ?? ""));
      return;
    }
  });

  if (mode === "yaml") {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box padding={1}>
          <text>
            <span fg={theme.primary}><strong>Config Editor</strong></span>
            <span fg={theme.textMuted}>{" — "}</span>
            <span fg={theme.accent}>YAML</span>
            <span fg={theme.textMuted}>{"  Tab form  Ctrl+S save"}</span>
            {hasChanges ? <span fg={theme.warning}>{" ● unsaved"}</span> : null}
          </text>
        </box>
        <box
          flexGrow={1}
          border
          borderColor={theme.border}
          backgroundColor={theme.backgroundPanel}
          padding={1}
        >
          <scrollbox scrollY>
            <text wrapMode="word">
              <span fg={theme.text}>{yaml}</span>
              <span fg={theme.accent}>{"█"}</span>
            </text>
          </scrollbox>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text>
          <span fg={theme.primary}><strong>Config Editor</strong></span>
          <span fg={theme.textMuted}>{" — "}</span>
          <span fg={theme.accent}>Form</span>
          <span fg={theme.textMuted}>
            {"  Tab yaml  ←→ pane  ↑↓ navigate  / search  Ctrl+S save"}
          </span>
          {hasChanges ? <span fg={theme.warning}>{" ● unsaved"}</span> : null}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          width={20}
          border
          borderColor={focus === "categories" ? theme.borderActive : theme.border}
          backgroundColor={theme.backgroundPanel}
          paddingTop={1}
          paddingBottom={1}
        >
          <text>
            <span fg={theme.primary}><strong>{" Categories"}</strong></span>
          </text>
          <text>{" "}</text>
          {CATEGORIES.map((c, i) => {
            const sel = i === cat && !searching;
            const focused = sel && focus === "categories";
            const items = grouped.get(c) ?? [];
            const dirty = items.some(f => changed(f.key));
            return (
              <box
                key={c}
                backgroundColor={focused ? theme.backgroundElement : undefined}
                onMouseDown={() => { setCat(i); setCursor(0); setFocus("categories"); }}
              >
                <text>
                  <span fg={dirty ? theme.warning : theme.textMuted}>
                    {dirty ? "●" : " "}
                  </span>
                  <span fg={focused ? theme.accent : sel ? theme.primary : theme.text}>
                    {sel ? "▸ " : "  "}{c}
                  </span>
                  <span fg={theme.textMuted}>{` (${items.length})`}</span>
                </text>
              </box>
            );
          })}
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          border
          borderColor={focus === "fields" ? theme.borderActive : theme.border}
          backgroundColor={theme.backgroundPanel}
          padding={1}
        >
          {searching ? (
            <box>
              <text>
                <span fg={theme.accent}>{"/ "}</span>
                <span fg={theme.text}>{query}</span>
                <span fg={theme.accent}>{"█"}</span>
                <span fg={theme.textMuted}>{`  ${count} matches  Esc cancel`}</span>
              </text>
            </box>
          ) : (
            <text>
              <span fg={theme.primary}><strong>{`  ${active}`}</strong></span>
              <span fg={theme.textMuted}>{` — ${count} fields`}</span>
            </text>
          )}

          <box marginTop={1}>
            <text>
              <span fg={theme.textMuted}>
                {"    "}{"Field".padEnd(28)}{"Value".padEnd(30)}{"Action"}
              </span>
            </text>
          </box>
          <text>
            <span fg={theme.borderSubtle}>
              {"    "}{"─".repeat(26)}{"  "}{"─".repeat(28)}{"  "}{"─".repeat(10)}
            </span>
          </text>

          {count === 0 ? (
            <box padding={2}>
              <text>
                <span fg={theme.textMuted}>
                  {searching ? "No matching fields" : "No fields in this category"}
                </span>
              </text>
            </box>
          ) : (
            <scrollbox scrollY>
              {fields.map((f, i) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  active={i === cursor && focus === "fields"}
                  changed={changed(f.key)}
                  editing={editing && i === cursor}
                  buf={buf}
                />
              ))}
            </scrollbox>
          )}
        </box>
      </box>
    </box>
  );
});
