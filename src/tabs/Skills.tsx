import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { makeSource, type SkillInfo } from "../utils/hermes-home";
import { useGateway } from "../app/gateway";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { useTheme } from "../theme";
import { TabShell } from "../ui/shell";
import { KVBlock } from "../ui/kv";
import { trunc } from "../ui/fmt";
import { openConfirm } from "../dialogs/confirm";

type Hit = { name: string; description?: string }

// ─── Skill Row ───────────────────────────────────────────────────────

const SkillRow = memo((props: {
  skill: SkillInfo;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const s = props.skill;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const indicator = props.selected ? "▸ " : "  ";

  return (
    <box
      backgroundColor={bg}
      onMouseDown={props.onSelect}
      onMouseOver={props.onHover}
    >
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>
          {indicator}
        </span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {s.name.padEnd(24)}
        </span>
        <span fg={theme.info}>
          {(s.category || "—").padEnd(16)}
        </span>
        <span fg={theme.textMuted}>
          {trunc(s.description || "—", 60)}
        </span>
      </text>
    </box>
  );
});

// ─── Hub Result Row ──────────────────────────────────────────────────

const HitRow = memo((props: { hit: Hit; selected: boolean; onHover: () => void }) => {
  const theme = useTheme().theme;
  const on = props.selected;
  return (
    <box height={1} backgroundColor={on ? theme.backgroundElement : undefined}
         onMouseOver={props.onHover}>
      <text>
        <span fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</span>
        <span fg={on ? theme.accent : theme.text}>{props.hit.name.padEnd(28)}</span>
        <span fg={theme.textMuted}>{trunc(props.hit.description || "—", 70)}</span>
      </text>
    </box>
  );
});

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel = memo((props: { skill: SkillInfo }) => {
  const theme = useTheme().theme;
  const s = props.skill;

  return (
    <box
      flexDirection="column"
      padding={1}
      border
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      width="40%"
    >
      <box height={1}><text fg={theme.primary}><strong>Skill Detail</strong></text></box>
      <box height={1} />
      <box height={1}><text fg={theme.accent}><strong>{s.name}</strong></text></box>
      <box height={1} />
      <KVBlock rows={[
        ["Category", s.category || "uncategorized", theme.info],
        ["File", s.source.relative],
        ["Tags", s.tags.length > 0 ? s.tags.join(", ") : undefined],
      ]} />
      <box height={1} />
      {s.description ? (
        <text wrapMode="word"><span fg={theme.text}>{s.description}</span></text>
      ) : (
        <text fg={theme.textMuted}>No description</text>
      )}
    </box>
  );
});

// ─── Empty State ─────────────────────────────────────────────────────

const EmptyState = memo((props: { searching: boolean }) => {
  const theme = useTheme().theme;
  return (
    <box flexGrow={1} padding={2}>
      <text>
        <span fg={theme.textMuted}>
          {props.searching
            ? "No matching skills on hub"
            : "No skills found in ~/.hermes/skills/"}
        </span>
      </text>
    </box>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

export const Skills = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const dialog = useDialog();
  const toast = useToast();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const seq = useRef(0);

  const load = useCallback(() => {
    gw.request<{ skills: Record<string, string[]> }>("skills.manage", { action: "list" })
      .then(res => {
        const raw = res.skills ?? {};
        const rows: SkillInfo[] = Object.entries(raw).flatMap(([cat, names]) =>
          names.map(n => ({
            source: makeSource(`skills/${cat}/${n}/SKILL.md`, `${n}/SKILL.md`),
            category: cat,
            name: n,
            description: "",
            tags: [],
            // No description available from the gateway list — estimate
            // from name only until skills.manage returns frontmatter.
            tokenEstimate: Math.ceil(n.length / 4),
          }))
        );
        rows.sort((a, b) => a.source.relative.localeCompare(b.source.relative));
        setSkills(rows);
      })
      .catch(() => {});
  }, [gw]);

  useEffect(() => {
    load();
  }, [load]);

  // Hub search — debounced, drop stale responses via seq ref.
  useEffect(() => {
    const id = ++seq.current;
    if (!searching || !query.trim()) { setHits([]); return }
    const t = setTimeout(() => {
      gw.request<{ results: Hit[] }>("skills.manage", { action: "search", query })
        .then(r => {
          if (seq.current !== id) return;
          setHits(r.results ?? []);
          setSelected(0);
        })
        .catch(() => { if (seq.current === id) setHits([]) });
    }, 150);
    return () => clearTimeout(t);
  }, [gw, query, searching]);

  // Group installed skills by category for display
  const groups = Map.groupBy(skills, s => s.category || "uncategorized");

  // Flat list for keyboard navigation
  const flat = [...groups].flatMap(([cat, items]) => [
    { type: "header" as const, category: cat },
    ...items.map(s => ({ type: "skill" as const, skill: s })),
  ]);

  const skillRows = flat.filter(r => r.type === "skill");
  const count = searching ? hits.length : skillRows.length;
  const current = !searching && skillRows[selected]?.type === "skill"
    ? skillRows[selected].skill : null;

  const exit = useCallback(() => {
    setSearching(false); setQuery(""); setHits([]); setSelected(0);
  }, []);

  const install = useCallback(async (name: string) => {
    const ok = await openConfirm(dialog, {
      title: "Install skill?",
      body: name,
      yes: "install",
    });
    if (!ok) return;
    gw.request("skills.manage", { action: "install", query: name })
      .then(() => {
        toast.show({ variant: "success", message: `Installed ${name}` });
        exit();
        load();
      })
      .catch((e: Error) =>
        toast.show({ variant: "error", message: `Install failed: ${e.message}` }));
  }, [dialog, gw, toast, exit, load]);

  const inspect = useCallback((name: string) => {
    gw.request<{ info: unknown }>("skills.manage", { action: "inspect", query: name })
      .then(r => dialog.replace(
        <box flexDirection="column" width={90} height={24}>
          <box height={1}><text fg={theme.primary}><strong>{`Skill · ${name}`}</strong></text></box>
          <box height={1} />
          <scrollbox scrollY flexGrow={1}>
            <box flexDirection="column" width="100%">
              <text wrapMode="word">{JSON.stringify(r.info ?? r, null, 2)}</text>
            </box>
          </scrollbox>
        </box>,
      ))
      .catch((e: Error) => toast.error(e));
  }, [gw, dialog, toast, theme.primary]);

  useKeyboard((key) => {
    if (!props.focused) return;
    if (!searching && key.raw === "/") {
      setSearching(true); setQuery(""); setHits([]); setSelected(0);
      return;
    }

    if (searching) {
      if (key.name === "escape") { exit(); return }
      if (key.name === "backspace") { setQuery(p => p.slice(0, -1)); setSelected(0); return }
      if (key.name === "up") return setSelected(p => Math.max(0, p - 1));
      if (key.name === "down") return setSelected(p => Math.min(count - 1, p + 1));
      if (key.name === "return") {
        const hit = hits[selected];
        if (hit) install(hit.name);
        return;
      }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery(p => p + key.raw); setSelected(0);
      }
      return;
    }

    // Normal mode
    if (key.name === "up") return setSelected(p => Math.max(0, p - 1));
    if (key.name === "down") return setSelected(p => Math.min(count - 1, p + 1));
    if (key.name === "r") return load();
    if (key.name === "i" && current) return inspect(current.name);
  });

  // Track which skill index we're on as we iterate through the grouped list
  let skillIdx = -1;

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={searching ? `Hub Search (${hits.length})` : `Skills (${skills.length})`}
        hint={searching
          ? "↑↓ navigate  Enter install  Esc cancel"
          : "↑↓ navigate  / search hub  i inspect  r refresh"}
      >
        {/* Search bar */}
        {searching ? (
          <box height={1}>
            <text>
              <span fg={theme.accent}>{"/ "}</span>
              <span fg={theme.text}>{query}</span>
              <span fg={theme.accent}>{"█"}</span>
            </text>
          </box>
        ) : null}

        {/* Column headers (installed mode only) */}
        {searching ? null : (
          <box height={1}>
            <text fg={theme.textMuted}>
              {"  "}{"Name".padEnd(24)}{"Category".padEnd(16)}{"Description"}
            </text>
          </box>
        )}
        {searching ? null : (
          <box height={1}>
            <text fg={theme.borderSubtle}>
              {"  "}{"─".repeat(22)}{"  "}{"─".repeat(14)}{"  "}{"─".repeat(40)}
            </text>
          </box>
        )}

        {/* List */}
        {count === 0 ? (
          <EmptyState searching={searching} />
        ) : searching ? (
          <scrollbox scrollY flexGrow={1}>
            <box flexDirection="column" width="100%">
              {hits.map((h, i) => (
                <HitRow key={h.name} hit={h} selected={i === selected}
                  onHover={() => setSelected(i)} />
              ))}
            </box>
          </scrollbox>
        ) : (
          <scrollbox scrollY flexGrow={1}>
            {flat.map((row, i) => {
              if (row.type === "header") {
                return (
                  <box key={`h-${row.category}`} marginTop={i > 0 ? 1 : 0}>
                    <text fg={theme.info}><strong>{`▾ ${row.category}`}</strong></text>
                  </box>
                );
              }
              skillIdx++;
              const idx = skillIdx;
              return (
                <SkillRow
                  key={row.skill.name}
                  skill={row.skill}
                  selected={idx === selected}
                  onSelect={() => setSelected(idx)}
                  onHover={() => setSelected(idx)}
                />
              );
            })}
          </scrollbox>
        )}
      </TabShell>

      {/* Detail panel */}
      {current ? <DetailPanel skill={current} /> : null}
    </box>
  );
});
