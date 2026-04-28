import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useGateway } from "../app/gateway";
import { useListKeys } from "../keys";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { TabShell } from "../ui/shell";
import { KVBlock } from "../ui/kv";
import { Col, Hdr } from "../ui/table";

// ─── Types ────────────────────────────────────────────────────────────

type Toolset = {
  name: string
  description: string
  tool_count: number
  enabled: boolean
}

// ─── Toolset Row ──────────────────────────────────────────────────────

const Row = memo((props: {
  ts: Toolset;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const ts = props.ts;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const glyph = ts.enabled ? "●" : "○";

  return (
    <box flexDirection="column">
      <box flexDirection="row" height={1} backgroundColor={bg}
           onMouseDown={props.onSelect} onMouseOver={props.onHover}>
        <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
        <Col w={2} fg={theme.textMuted}>{props.expanded ? "▾ " : "▸ "}</Col>
        <Col w={2} fg={ts.enabled ? theme.success : theme.textMuted}>{`${glyph} `}</Col>
        <Col grow fg={props.selected ? theme.accent : theme.text}>{ts.name}</Col>
        <Col w={11} fg={theme.info} right>{`${ts.tool_count} tools`}</Col>
        <Col w={11} fg={ts.enabled ? theme.success : theme.textMuted} right>
          {ts.enabled ? "enabled" : "disabled"}
        </Col>
      </box>
      {props.expanded ? (
        <box flexDirection="column" marginLeft={6} marginBottom={1}>
          <box minHeight={1}>
            <text wrapMode="word" fg={theme.textMuted}>{ts.description || "—"}</text>
          </box>
        </box>
      ) : null}
    </box>
  );
});

// ─── Detail Panel ─────────────────────────────────────────────────────

const DetailPanel = memo((props: { ts: Toolset }) => {
  const theme = useTheme().theme;
  const ts = props.ts;

  return (
    <box
      flexDirection="column" padding={1} border
      borderColor={theme.border} backgroundColor={theme.backgroundPanel} width="40%"
    >
      <box height={1}><text fg={theme.primary}><strong>Toolset Detail</strong></text></box>
      <box height={1} />
      <box height={1}><text fg={theme.accent}><strong>{ts.name}</strong></text></box>
      <box height={1} />
      <KVBlock rows={[
        ["Status", ts.enabled ? "enabled" : "disabled", ts.enabled ? theme.success : theme.textMuted],
        ["Tools", String(ts.tool_count), theme.info],
      ]} />
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Description:</text></box>
      <box minHeight={1}>
        <text wrapMode="word" fg={theme.text}>{ts.description || "—"}</text>
      </box>
    </box>
  );
});

// ─── Main Component ───────────────────────────────────────────────────

export const Toolsets = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const dialog = useDialog();
  const toast = useToast();
  const [list, setList] = useState<Toolset[]>([]);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const live = useRef({ list, sel });
  live.current = { list, sel };

  const load = useCallback(() => {
    gw.request<{ toolsets?: Toolset[] }>("toolsets.list", {})
      .then(r => { setList(r.toolsets ?? []); setErr(null); })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  const expand = useCallback((name: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    const ts = live.current.list[live.current.sel];
    if (!ts) return;
    const action = ts.enabled ? "disable" : "enable";
    // optimistic flip
    setList(prev => prev.map(t => t.name === ts.name ? { ...t, enabled: !t.enabled } : t));
    gw.request("tools.configure", { action, names: [ts.name] })
      .then(() => load())
      .catch((e: Error) => {
        toast.show({ variant: "error", message: e.message });
        load();
      });
  }, [gw, toast, load]);

  const count = list.length;
  const ts = list[sel] ?? null;

  const keys = useListKeys({
    active: !!props.focused && dialog.stack.length === 0,
    count, setSel,
    onActivate: () => { if (ts) expand(ts.name) },
    onToggle: toggle,
    onRefresh: load,
  });

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={`Toolsets (${count})`}
        error={err}
        hint={`↑↓ nav  ${keys.print("list.toggle")} toggle  ${keys.print("list.activate")} expand  ${keys.print("list.refresh")} refresh`}
      >
        <Hdr>
          <Col w={6} fg={theme.textMuted}>{""}</Col>
          <Col grow fg={theme.textMuted} bold>Name</Col>
          <Col w={11} fg={theme.textMuted} bold right>Tools</Col>
          <Col w={11} fg={theme.textMuted} bold right>Status</Col>
        </Hdr>
        <box height={1} />

        {count === 0 ? (
          <box key="empty" flexGrow={1} padding={2}>
            <text fg={theme.textMuted}>No toolsets found</text>
          </box>
        ) : (
          <scrollbox key="list" scrollY flexGrow={1}
                     verticalScrollbarOptions={{ visible: true }}>
            {list.map((t, i) => (
              <Row
                key={t.name}
                ts={t}
                selected={i === sel}
                expanded={open.has(t.name)}
                onSelect={() => { setSel(i); expand(t.name); }}
                onHover={() => setSel(i)}
              />
            ))}
          </scrollbox>
        )}
      </TabShell>

      {ts ? <DetailPanel ts={ts} /> : null}
    </box>
  );
});
