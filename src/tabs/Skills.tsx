import { useState, useEffect, useCallback, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { listSkills, type SkillInfo } from "../utils/hermes-home";
import { useTheme } from "../theme";

// ─── Helpers ─────────────────────────────────────────────────────────

const truncate = (s: string, max: number): string => {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
};

// ─── Skill Row ───────────────────────────────────────────────────────

const SkillRow = (props: {
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
          {truncate(s.description || "—", 60)}
        </span>
      </text>
    </box>
  );
};

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel = (props: { skill: SkillInfo }) => {
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
      <text>
        <span fg={theme.primary}>
          <strong>Skill Detail</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.accent}>
          <strong>{s.name}</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Category".padEnd(12)}</span>
        <span fg={theme.info}>{` ${s.category || "uncategorized"}`}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>{"File".padEnd(12)}</span>
        <span fg={theme.text}>{` ${s.source.relative}`}</span>
      </text>
      {s.tags.length > 0 ? (
        <text>
          <span fg={theme.textMuted}>{"Tags".padEnd(12)}</span>
          <span fg={theme.text}>{` ${s.tags.join(", ")}`}</span>
        </text>
      ) : null}
      <text> </text>
      {s.description ? (
        <text wrapMode="word">
          <span fg={theme.text}>{s.description}</span>
        </text>
      ) : (
        <text>
          <span fg={theme.textMuted}>No description</span>
        </text>
      )}
    </box>
  );
};

// ─── Empty State ─────────────────────────────────────────────────────

const EmptyState = (props: { searching: boolean }) => {
  const theme = useTheme().theme;
  return (
    <box flexGrow={1} padding={2}>
      <text>
        <span fg={theme.textMuted}>
          {props.searching
            ? "No matching skills"
            : "No skills found in ~/.hermes/skills/"}
        </span>
      </text>
    </box>
  );
};

// ─── Main Component ──────────────────────────────────────────────────

export const Skills = memo(() => {
  const theme = useTheme().theme;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const rows = await listSkills();
    setSkills(rows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filter skills by search query
  const filtered = searching && query.trim()
    ? skills.filter(s => {
        const q = query.toLowerCase();
        return s.name.toLowerCase().includes(q)
          || s.description.toLowerCase().includes(q)
          || s.category.toLowerCase().includes(q)
          || s.tags.some(t => t.toLowerCase().includes(q));
      })
    : skills;

  // Group by category for display
  const groups = Map.groupBy(filtered, s => s.category || "uncategorized");

  // Flat list for keyboard navigation
  const flat = [...groups].flatMap(([cat, items]) => [
    { type: "header" as const, category: cat },
    ...items.map(s => ({ type: "skill" as const, skill: s })),
  ]);

  // Count only skill rows for navigation
  const skillRows = flat.filter(r => r.type === "skill");
  const count = skillRows.length;

  // Map selected index to the skill
  const current = skillRows[selected]?.type === "skill" ? skillRows[selected].skill : null;

  useKeyboard((key) => {
    // Toggle search
    if (!searching && key.raw === "/") {
      setSearching(true);
      setQuery("");
      setSelected(0);
      return;
    }

    if (searching) {
      if (key.name === "escape") {
        setSearching(false);
        setQuery("");
        setSelected(0);
        return;
      }
      if (key.name === "backspace") {
        setQuery(prev => prev.slice(0, -1));
        setSelected(0);
        return;
      }
      if (key.name === "up") {
        setSelected(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.name === "down") {
        setSelected(prev => Math.min(count - 1, prev + 1));
        return;
      }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setQuery(prev => prev + key.raw);
        setSelected(0);
        return;
      }
      return;
    }

    // Normal mode
    if (key.name === "up") {
      setSelected(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.name === "down") {
      setSelected(prev => Math.min(count - 1, prev + 1));
      return;
    }
    if (key.name === "r") {
      load();
      return;
    }
  });

  // Track which skill index we're on as we iterate through the grouped list
  let skillIdx = -1;

  return (
    <box flexDirection="row" flexGrow={1}>
      <box
        flexDirection="column"
        flexGrow={1}
        border
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        padding={1}
      >
        {/* Header */}
        <text>
          <span fg={theme.primary}>
            <strong>
              {searching
                ? `Skills (${count} matching)`
                : `Skills (${skills.length})`}
            </strong>
          </span>
          <span fg={theme.textMuted}>
            {searching
              ? "  ↑↓ navigate  Esc cancel"
              : "  ↑↓ navigate  / search  r refresh"}
          </span>
        </text>

        {/* Search bar */}
        {searching ? (
          <box>
            <text>
              <span fg={theme.accent}>{"/ "}</span>
              <span fg={theme.text}>{query}</span>
              <span fg={theme.accent}>{"█"}</span>
            </text>
          </box>
        ) : null}

        {/* Column headers */}
        <box marginTop={1}>
          <text>
            <span fg={theme.textMuted}>
              {"  "}{"Name".padEnd(24)}{"Category".padEnd(16)}{"Description"}
            </span>
          </text>
        </box>
        <text>
          <span fg={theme.borderSubtle}>{"  "}{"─".repeat(22)}{"  "}{"─".repeat(14)}{"  "}{"─".repeat(40)}</span>
        </text>

        {/* List */}
        {count === 0 ? (
          <EmptyState searching={searching} />
        ) : (
          <scrollbox scrollY>
            {flat.map((row, i) => {
              if (row.type === "header") {
                return (
                  <box key={`h-${row.category}`} marginTop={i > 0 ? 1 : 0}>
                    <text>
                      <span fg={theme.info}>
                        <strong>{`▾ ${row.category}`}</strong>
                      </span>
                    </text>
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
      </box>

      {/* Detail panel */}
      {current ? <DetailPanel skill={current} /> : null}
    </box>
  );
});
