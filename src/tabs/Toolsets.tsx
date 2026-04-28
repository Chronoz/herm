import { useState, useEffect, useCallback, useRef, memo, type ReactNode } from "react";
import { useGateway } from "../app/gateway";
import { useListKeys } from "../keys";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { TabShell } from "../ui/shell";
import { KVBlock } from "../ui/kv";
import { Col, Hdr, Marquee } from "../ui/table";

// ─── Types ────────────────────────────────────────────────────────────

// Wire shape from tui_gateway's `toolsets.list`. v1 only guarantees the
// first four; the rest are optional so a future tui_gateway that passes
// get_toolset_info()/get_available_toolsets() through lands here without
// a client change.
type Toolset = {
  name: string
  description: string
  tool_count: number
  enabled: boolean
  tools?: string[]
  includes?: string[]
  available?: boolean
  requirements?: string[]
}

type Kind = "core" | "platform" | "mcp"

// ─── Classification ───────────────────────────────────────────────────

// Name-only heuristic — tui_gateway doesn't expose includes/is_composite
// on the wire yet, so composites fold into their name-derived bucket.
// `hermes-*` are the per-platform bundles that all clone _HERMES_CORE_TOOLS
// upstream; separating them cuts ~20 near-identical rows out of "core".
const kindOf = (ts: Toolset): Kind =>
  ts.name.includes(":") ? "mcp"
  : ts.name.startsWith("hermes-") ? "platform"
  : "core"

const KIND_LABEL: Record<Kind, string> = {
  core: "core",
  platform: "platform bundles",
  mcp: "mcp",
}

type Section = { kind: Kind; items: Toolset[] }

const group = (list: Toolset[]): Section[] => {
  const by = { core: [], platform: [], mcp: [] } as Record<Kind, Toolset[]>
  for (const ts of list) by[kindOf(ts)].push(ts)
  return (["core", "platform", "mcp"] as const)
    .filter(k => by[k].length > 0)
    .map(k => ({ kind: k, items: by[k] }))
}

// ─── Toolset Row ──────────────────────────────────────────────────────

const Row = memo((props: {
  ts: Toolset;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const ts = props.ts;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const unavail = ts.available === false;
  const glyph = unavail ? "◌" : ts.enabled ? "●" : "○";
  const status = unavail ? "unavailable" : ts.enabled ? "enabled" : "disabled";
  const statusFg = unavail ? theme.warning : ts.enabled ? theme.success : theme.textMuted;

  return (
    <box flexDirection="row" height={1} backgroundColor={bg}
         onMouseDown={props.onSelect} onMouseMove={props.onHover}>
      <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
      <Col w={2} fg={statusFg}>{`${glyph} `}</Col>
      <Col w={24} fg={props.selected ? theme.accent : theme.text}>{ts.name}</Col>
      <Marquee grow active={props.selected} fg={theme.textMuted}>{ts.description || "—"}</Marquee>
      <Col w={9} fg={theme.info} right>{`${ts.tool_count} tools`}</Col>
      <Col w={13} fg={statusFg} right>{status}</Col>
    </box>
  );
});

// ─── Detail Panel ─────────────────────────────────────────────────────

const DetailPanel = memo((props: { ts: Toolset }) => {
  const theme = useTheme().theme;
  const ts = props.ts;
  const unavail = ts.available === false;

  return (
    <box
      flexDirection="column" padding={1} border
      borderColor={theme.border} backgroundColor={theme.backgroundPanel} width="40%"
    >
      <box height={1}><text fg={theme.accent}><strong>{ts.name}</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{KIND_LABEL[kindOf(ts)]}</text></box>
      <box height={1} />
      <KVBlock rows={[
        ["Status", unavail ? "unavailable" : ts.enabled ? "enabled" : "disabled",
          unavail ? theme.warning : ts.enabled ? theme.success : theme.textMuted],
        ["Tools", String(ts.tool_count), theme.info],
        ["Includes", ts.includes?.length ? ts.includes.join(", ") : undefined, theme.text],
        ["Requires", ts.requirements?.length ? ts.requirements.join(", ") : undefined,
          unavail ? theme.warning : theme.text],
      ]} />
      <box height={1} />
      <box minHeight={1}>
        <text wrapMode="word" fg={theme.text}>{ts.description || "—"}</text>
      </box>
      {ts.tools?.length ? (
        <>
          <box height={1} />
          <box height={1}><text fg={theme.textMuted}>Tools ({ts.tools.length}):</text></box>
          <scrollbox flexGrow={1} scrollY>
            {ts.tools.map(n => <text key={n} fg={theme.text}>· {n}</text>)}
          </scrollbox>
        </>
      ) : null}
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
  const [err, setErr] = useState<string | null>(null);

  // Flat nav list derived from grouped sections, so ↑/↓ crosses section
  // boundaries in render order. `live` mirrors for callbacks that must
  // read current selection without closing over stale state.
  const secs = group(list);
  const flat = secs.flatMap(s => s.items);
  const live = useRef({ flat, sel });
  live.current = { flat, sel };

  const load = useCallback(() => {
    gw.request<{ toolsets?: Toolset[] }>("toolsets.list", {})
      .then(r => { setList(r.toolsets ?? []); setErr(null); })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(() => {
    const ts = live.current.flat[live.current.sel];
    if (!ts) return;
    if (ts.available === false) {
      toast.show({ variant: "warning", message: `${ts.name} is unavailable` });
      return;
    }
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

  const count = flat.length;
  const ts = flat[sel] ?? null;

  const keys = useListKeys({
    active: !!props.focused && dialog.stack.length === 0,
    count, setSel,
    onToggle: toggle,
    onRefresh: () => { load(); toast.show({ variant: "info", message: "Reloaded", duration: 1000 }) },
  });

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell
        title={`Toolsets (${count})`}
        error={err}
        hint={`↑↓ nav  ${keys.print("list.toggle")} toggle  ${keys.print("list.refresh")} refresh`}
      >
        <Hdr>
          <Col w={4} fg={theme.textMuted}>{""}</Col>
          <Col w={24} fg={theme.textMuted} bold>Name</Col>
          <Col grow fg={theme.textMuted} bold>Description</Col>
          <Col w={9} fg={theme.textMuted} bold right>Tools</Col>
          <Col w={13} fg={theme.textMuted} bold right>Status</Col>
        </Hdr>
        <box height={1} />

        {count === 0 ? (
          <box key="empty" flexGrow={1} padding={2}>
            <text fg={theme.textMuted}>No toolsets found</text>
          </box>
        ) : (
          <scrollbox key="list" scrollY flexGrow={1}
                     verticalScrollbarOptions={{ visible: true }}>
            {secs.reduce<{ base: number; out: ReactNode[] }>((acc, s) => {
              acc.out.push(
                <box key={`§${s.kind}`} height={1} marginTop={acc.base > 0 ? 1 : 0}>
                  <text fg={theme.textMuted}>─ {KIND_LABEL[s.kind]} ({s.items.length}) </text>
                </box>
              );
              s.items.forEach((t, j) => {
                const i = acc.base + j;
                acc.out.push(
                  <Row
                    key={t.name}
                    ts={t}
                    selected={i === sel}
                    onSelect={() => setSel(i)}
                    onHover={() => setSel(i)}
                  />
                );
              });
              acc.base += s.items.length;
              return acc;
            }, { base: 0, out: [] }).out}
          </scrollbox>
        )}
      </TabShell>

      {ts ? <DetailPanel ts={ts} /> : null}
    </box>
  );
});
