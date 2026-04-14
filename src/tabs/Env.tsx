import { useState, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import {
  readEnvFile,
  writeEnvVar,
  removeEnvVar,
  redact,
  ENV_CATALOG,
} from "../utils/hermes-home";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";

// ─── Types ────────────────────────────────────────────────────────

type Row =
  | { type: "header"; category: string; collapsed: boolean }
  | { type: "var"; key: string; value: string | undefined };

// ─── Edit Dialog ──────────────────────────────────────────────────

const EditDialog = (props: {
  name: string;
  initial: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}) => {
  const theme = useTheme().theme;
  const [value, setValue] = useState(props.initial);

  useKeyboard((key) => {
    if (key.name === "escape") { props.onCancel(); return; }
    if (key.name === "return") { props.onSave(value); return; }
    if (key.name === "backspace") { setValue(v => v.slice(0, -1)); return; }
    if (key.raw && key.raw.length === 1 && key.raw >= " ") {
      setValue(v => v + key.raw);
    }
  });

  return (
    <box flexDirection="column" width={60}>
      <text>
        <span fg={theme.primary}>
          <strong>Edit Variable</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Name  "}</span>
        <span fg={theme.accent}>{props.name}</span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Value "}</span>
      </text>
      <box border borderColor={theme.border} paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={theme.text}>{value}</span>
          <span fg={theme.accent}>{"█"}</span>
        </text>
      </box>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"Enter save  Esc cancel"}</span>
      </text>
    </box>
  );
};

// ─── Confirm Dialog ───────────────────────────────────────────────

const ConfirmDialog = (props: {
  name: string;
  onYes: () => void;
  onNo: () => void;
}) => {
  const theme = useTheme().theme;

  useKeyboard((key) => {
    if (key.raw === "y" || key.raw === "Y") { props.onYes(); return; }
    if (key.name === "escape" || key.raw === "n" || key.raw === "N") {
      props.onNo();
    }
  });

  return (
    <box flexDirection="column" width={50}>
      <text>
        <span fg={theme.warning}>
          <strong>Clear Variable</strong>
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.text}>
          {`Remove ${props.name} from .env?`}
        </span>
      </text>
      <text> </text>
      <text>
        <span fg={theme.textMuted}>{"y confirm  n/Esc cancel"}</span>
      </text>
    </box>
  );
};

// ─── Var Row ──────────────────────────────────────────────────────

const VarRow = (props: {
  name: string;
  value: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const set = props.value !== undefined;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const indicator = props.selected ? "▸ " : "  ";

  return (
    <box backgroundColor={bg} onMouseDown={props.onSelect} onMouseOver={props.onHover}>
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>
          {indicator}
        </span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {props.name.padEnd(28)}
        </span>
        <span fg={set ? theme.success : theme.textMuted}>
          {(set ? " SET " : "UNSET").padEnd(8)}
        </span>
        <span fg={theme.textMuted}>
          {set ? redact(props.value!) : "—"}
        </span>
      </text>
    </box>
  );
};

// ─── Main Component ───────────────────────────────────────────────

export const Env = () => {
  const theme = useTheme().theme;
  const dialog = useDialog();
  const toast = useToast();

  const [vars, setVars] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setVars(await readEnvFile());
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build rows
  const rows: Row[] = [];
  for (const group of ENV_CATALOG) {
    const keys = searching && query.trim()
      ? group.keys.filter(k => k.toLowerCase().includes(query.toLowerCase()))
      : group.keys;
    if (keys.length === 0) continue;

    const hide = collapsed[group.category] ?? false;
    rows.push({ type: "header", category: group.category, collapsed: hide });
    if (!hide) {
      for (const key of keys) {
        rows.push({ type: "var", key, value: vars[key] });
      }
    }
  }

  // Navigable items (headers + vars)
  const nav = rows;
  const count = nav.length;

  const current = nav[selected];

  const edit = useCallback((key: string) => {
    const initial = vars[key] ?? "";
    dialog.replace(
      <EditDialog
        name={key}
        initial={initial}
        onSave={async (val) => {
          dialog.clear();
          await writeEnvVar(key, val);
          await load();
          toast.show({ variant: "success", message: `${key} updated` });
        }}
        onCancel={() => dialog.clear()}
      />,
    );
  }, [vars, dialog, load, toast]);

  const clear = useCallback((key: string) => {
    dialog.replace(
      <ConfirmDialog
        name={key}
        onYes={async () => {
          dialog.clear();
          await removeEnvVar(key);
          await load();
          toast.show({ variant: "success", message: `${key} cleared` });
        }}
        onNo={() => dialog.clear()}
      />,
    );
  }, [dialog, load, toast]);

  useKeyboard((key) => {
    // Search toggle
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
      if (key.name === "return" && current?.type === "var") {
        edit(current.key);
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
    if (key.name === "return") {
      if (current?.type === "header") {
        setCollapsed(prev => ({
          ...prev,
          [current.category]: !prev[current.category],
        }));
        return;
      }
      if (current?.type === "var") {
        edit(current.key);
        return;
      }
    }
    if (key.raw === "d" && current?.type === "var" && current.value !== undefined) {
      clear(current.key);
      return;
    }
    if (key.raw === "r") {
      load();
      return;
    }
  });

  let idx = -1;

  return (
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
            {searching ? `API Keys (searching)` : "API Keys / Env"}
          </strong>
        </span>
        <span fg={theme.textMuted}>
          {searching
            ? "  ↑↓ navigate  Enter edit  Esc cancel"
            : "  ↑↓ navigate  Enter edit/toggle  d clear  / search  r refresh"}
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
            {"  "}{"Name".padEnd(28)}{"Status".padEnd(8)}{"Value"}
          </span>
        </text>
      </box>
      <text>
        <span fg={theme.borderSubtle}>
          {"  "}{"─".repeat(26)}{"  "}{"─".repeat(6)}{"  "}{"─".repeat(30)}
        </span>
      </text>

      {/* List */}
      {count === 0 ? (
        <box flexGrow={1} padding={2}>
          <text>
            <span fg={theme.textMuted}>
              {searching ? "No matching variables" : "No variables configured"}
            </span>
          </text>
        </box>
      ) : (
        <scrollbox scrollY>
          {rows.map((row) => {
            idx++;
            const i = idx;
            if (row.type === "header") {
              const arrow = row.collapsed ? "▸" : "▾";
              return (
                <box
                  key={`h-${row.category}`}
                  marginTop={i > 0 ? 1 : 0}
                  backgroundColor={i === selected ? theme.backgroundElement : undefined}
                  onMouseDown={() => setSelected(i)}
                >
                  <text>
                    <span fg={theme.info}>
                      <strong>{`${arrow} ${row.category}`}</strong>
                    </span>
                  </text>
                </box>
              );
            }
            return (
              <VarRow
                key={row.key}
                name={row.key}
                value={row.value}
                selected={i === selected}
                onSelect={() => setSelected(i)}
                onHover={() => setSelected(i)}
              />
            );
          })}
        </scrollbox>
      )}
    </box>
  );
};
