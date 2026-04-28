import { useState, useEffect, useCallback, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { useKeys, handleListKey } from "../keys";
import { useGateway } from "../app/gateway";
import { useTheme } from "../theme";
import { useToast } from "../ui/toast";
import { useDialog } from "../ui/dialog";
import { openConfirm } from "../dialogs/confirm";
import { TabShell } from "../ui/shell";
import { Col, Hdr } from "../ui/table";
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
  /** Search mode: resolved category shown as a pill so hits stay attributable. */
  badge?: string;
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
    <box flexDirection="row" height={1} backgroundColor={bg}>
      <Col w={2} fg={props.changed ? theme.warning : theme.textMuted}>{mark}</Col>
      <Col w={2} fg={props.active ? theme.primary : theme.text}>{indicator}</Col>
      {props.badge !== undefined
        ? <Col w={12} fg={theme.textMuted}>{props.badge}</Col>
        : null}
      <Col w={28} fg={props.active ? theme.accent : theme.text}>{f.label}</Col>
      <Col grow min={6} fg={f.type === "boolean" ? (f.value ? theme.success : theme.error) : theme.text}>
        {display()}
      </Col>
      <Col w={9} fg={theme.textMuted} right>{props.active ? hint() : ""}</Col>
    </box>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

export const Config = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const toast = useToast();
  const dialog = useDialog();
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
          label: key.split(".").slice(1).join(".") || key,
          type: classify(key, val),
          value: val,
          options: SELECTS[key],
        }))
    : (grouped.get(active) ?? []);

  const count = fields.length;

  const changed = (key: string): boolean =>
    JSON.stringify(getNested(raw, key)) !== JSON.stringify(getNested(original, key));

  const nChanged = entries.reduce((n, [k]) => n + (changed(k) ? 1 : 0), 0);

  const update = (key: string, val: unknown) => {
    const next = structuredClone(raw);
    setNested(next, key, val);
    setRaw(next);
    setYaml(yamlStringify(next));
  };

  const fmt = (v: unknown) =>
    v === undefined ? "—" : Array.isArray(v) ? v.join(", ") : String(v);

  const save = async () => {
    const target = mode === "yaml" ? (yamlParse(yaml) ?? {}) : raw;
    const flat = flatten(target as Record<string, unknown>);
    const diffs = flat
      .filter(([key]) => JSON.stringify(getNested(target as Record<string, unknown>, key)) !== JSON.stringify(getNested(original, key)))
      .map(([key, val]) => ({ key, from: getNested(original, key), to: val }));
    if (diffs.length === 0) {
      toast.show({ variant: "info", message: "No changes" });
      return;
    }
    const body = diffs.map(d => `${d.key}: ${fmt(d.from)} → ${fmt(d.to)}`).join("\n");
    const ok = await openConfirm(dialog, {
      title: `Write ${diffs.length} change${diffs.length === 1 ? "" : "s"} to config.yaml?`,
      body, yes: "save",
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      diffs.map(d => gw.request("config.set", { key: d.key, value: d.to }))
    );
    const n = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - n;
    setRaw(structuredClone(target));
    setOriginal(structuredClone(target));
    if (mode === "form") setYaml(yamlStringify(target));
    if (fail > 0) toast.show({ variant: "error", message: `Saved ${n}, ${fail} failed` });
    else toast.show({ variant: "success", message: "Config saved" });
  };

  const keys = useKeys();
  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return;
    if (key.name === "tab" && !editing && !searching) {
      setMode(m => m === "form" ? "yaml" : "form");
      return;
    }

    if (keys.match("config.save", key)) return void save();

    if (mode === "yaml") {
      if (key.name === "backspace") { setYaml(prev => prev.slice(0, -1)); return; }
      if (key.name === "return") { setYaml(prev => prev + "\n"); return; }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setYaml(prev => prev + key.raw);
        return;
      }
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
    if (keys.match("list.search", key)) { setSearching(true); setQuery(""); setCursor(0); return; }

    if (focus === "categories") {
      if (key.name === "up") { setCat(c => Math.max(0, c - 1)); setCursor(0); return; }
      if (key.name === "down") { setCat(c => Math.min(CATEGORIES.length - 1, c + 1)); setCursor(0); return; }
      if (key.name === "return") { setFocus("fields"); return; }
      return;
    }

    const f = fields[cursor];
    const matched = handleListKey(keys, key, {
      count, setSel: setCursor,
      onRefresh: () => { load(); toast.show({ variant: "info", message: "Reloaded", duration: 1000 }) },
      onToggle: f?.type === "boolean" ? () => update(f.key, !f.value) : undefined,
      onActivate: f && (f.type === "string" || f.type === "number" || f.type === "list")
        ? () => {
            setEditing(true);
            setBuf(f.type === "list" && Array.isArray(f.value) ? (f.value as string[]).join(", ") : String(f.value ?? ""));
          }
        : undefined,
    });
    if (matched || !f) return;

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
  });

  const dirty = nChanged > 0 ? `● ${nChanged} unsaved  ` : "";

  if (mode === "yaml") {
    return (
      <TabShell title="Config · YAML" hint={`Tab form  ${keys.print("config.save")} save`}>
        <scrollbox scrollY flexGrow={1}>
          <text wrapMode="word">
            <span fg={theme.text}>{yaml}</span>
            <span fg={theme.accent}>█</span>
          </text>
        </scrollbox>
      </TabShell>
    );
  }

  // Search collapses to single-pane: input row sits above (outside)
  // both shells so placement matches scope (all categories). Results
  // rows carry a category badge so hits stay attributable; Esc
  // restores two-pane.
  return (
    <box flexDirection="column" flexGrow={1}>
      {searching ? (
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text>
            <span fg={theme.accent}>┃ </span>
            <span fg={theme.text}>{query}</span>
            <span fg={theme.accent}>█</span>
            <span fg={theme.textMuted}>{`   ${count} of ${entries.length}  ·  ↑↓ nav  ·  Esc close`}</span>
          </text>
        </box>
      ) : null}
      <box flexDirection="row" flexGrow={1}>
        {searching ? null : (
          <TabShell title="Config" hint="↑↓ → select" grow={1}
                    focus={focus === "categories"}>
            <scrollbox scrollY flexGrow={1}>
              {CATEGORIES.map((c, i) => {
                const sel = i === cat;
                const hot = sel && focus === "categories";
                const items = grouped.get(c) ?? [];
                const catDirty = items.some(f => changed(f.key));
                return (
                  <box
                    key={c}
                    backgroundColor={hot ? theme.backgroundElement : undefined}
                    onMouseDown={() => { setCat(i); setCursor(0); setFocus("categories"); }}
                  >
                    <text>
                      <span fg={catDirty ? theme.warning : theme.textMuted}>{catDirty ? "●" : " "}</span>
                      <span fg={hot ? theme.accent : sel ? theme.primary : theme.text}>
                        {sel ? "▸ " : "  "}{c}
                      </span>
                      <span fg={theme.textMuted}>{` (${items.length})`}</span>
                    </text>
                  </box>
                );
              })}
            </scrollbox>
          </TabShell>
        )}

        <TabShell
          title={searching ? "Search" : nChanged > 0 ? `${active} · ${nChanged} unsaved` : active}
          hint={`${dirty}Tab yaml  ←→ pane  ↑↓ nav  ${keys.print("list.search")} search  ${keys.print("config.save")} save`}
          grow={3} focus={focus === "fields" || searching}
        >
          <Hdr>
            <Col w={4} fg={theme.textMuted}>{""}</Col>
            {searching ? <Col w={12} fg={theme.textMuted} bold>Category</Col> : null}
            <Col w={28} fg={theme.textMuted} bold>Field</Col>
            <Col grow min={6} fg={theme.textMuted} bold>Value</Col>
            <Col w={9} fg={theme.textMuted}>{""}</Col>
          </Hdr>
          <box height={1} />

          {count === 0 ? (
            <box key="empty" flexGrow={1} padding={2}>
              <text fg={theme.textMuted}>
                {searching ? "No matching fields" : "No fields in this category"}
              </text>
            </box>
          ) : (
            <scrollbox key="list" scrollY flexGrow={1}
                       verticalScrollbarOptions={{ visible: true }}>
              {fields.map((f, i) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  active={i === cursor && (focus === "fields" || searching)}
                  changed={changed(f.key)}
                  editing={editing && i === cursor}
                  buf={buf}
                  badge={searching ? categorize(f.key) : undefined}
                />
              ))}
            </scrollbox>
          )}
        </TabShell>
      </box>
    </box>
  );
});
