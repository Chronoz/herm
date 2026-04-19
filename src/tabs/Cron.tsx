import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { useGateway } from "../app/gateway";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { openConfirm } from "../dialogs/confirm";
import { TabShell } from "../ui/shell";
import { KVBlock } from "../ui/kv";
import { openTextPrompt } from "../dialogs/text-prompt";
import { trunc, ago } from "../ui/fmt";

// ─── Types ───────────────────────────────────────────────────────────

type CronJob = {
  id: string
  name: string
  prompt: string
  schedule: { kind: string; expr: string; display: string }
  enabled: boolean
  state: string
  deliver: string
  last_run?: string
  next_run?: string
  last_error?: string
}

type RawJob = {
  job_id?: string
  id?: string
  name?: string
  prompt_preview?: string
  prompt?: string
  schedule?: string
  enabled?: boolean
  state?: string
  deliver?: string
  last_run_at?: string
  next_run_at?: string
  last_delivery_error?: string
}

const normalize = (j: RawJob): CronJob => ({
  id: j.job_id ?? j.id ?? "",
  name: j.name ?? "",
  prompt: j.prompt ?? j.prompt_preview ?? "",
  schedule: { kind: "", expr: j.schedule ?? "", display: j.schedule ?? "" },
  enabled: j.enabled ?? true,
  state: j.state ?? "scheduled",
  deliver: j.deliver ?? "local",
  last_run: j.last_run_at,
  next_run: j.next_run_at,
  last_error: j.last_delivery_error,
})

// gateway returns ISO timestamps; shared `ago` wants unix seconds
const rel = (iso?: string) => iso ? ago(new Date(iso).getTime() / 1000) : "—";

// ─── Job Row ─────────────────────────────────────────────────────────

const JobRow = memo((props: {
  job: CronJob;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const j = props.job;
  const bg = props.selected ? theme.backgroundElement : undefined;
  const glyph = j.enabled ? "●" : "○";

  return (
    <box backgroundColor={bg} onMouseDown={props.onSelect} onMouseOver={props.onHover}>
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</span>
        <span fg={j.enabled ? theme.success : theme.textMuted}>{glyph} </span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {trunc(j.name || j.id, 20).padEnd(22)}
        </span>
        <span fg={theme.textMuted}>{(j.schedule?.display ?? j.schedule?.expr ?? "—").padEnd(18)}</span>
        <span fg={theme.textMuted}>{` last: ${rel(j.last_run).padEnd(10)}`}</span>
        <span fg={theme.textMuted}>{` next: ${rel(j.next_run).padEnd(10)}`}</span>
        {j.state === "error" ? <span fg={theme.error}>{"  ERR"}</span> : null}
      </text>
    </box>
  );
});

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel = memo((props: { job: CronJob }) => {
  const theme = useTheme().theme;
  const j = props.job;

  return (
    <box
      flexDirection="column" padding={1} border
      borderColor={theme.border} backgroundColor={theme.backgroundPanel} width="40%"
    >
      <box height={1}><text fg={theme.primary}><strong>Job Detail</strong></text></box>
      <box height={1} />
      <box height={1}><text fg={theme.accent}><strong>{j.name || j.id}</strong></text></box>
      <box height={1} />
      <KVBlock rows={[
        ["ID", j.id],
        ["State", j.enabled ? "active" : "paused", j.enabled ? theme.success : theme.warning],
        ["Schedule", j.schedule?.display ?? j.schedule?.expr ?? "—"],
        ["Deliver", j.deliver ?? "local"],
        ["Last Run", j.last_run ?? "—"],
        ["Next Run", j.next_run ?? "—"],
        ["Error", j.last_error, theme.error],
      ]} />
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Prompt:</text></box>
      <text wrapMode="word"><span fg={theme.text}>{j.prompt}</span></text>
    </box>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

export const Cron = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const dialog = useDialog();
  const toast = useToast();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const live = useRef({ jobs, sel });
  live.current = { jobs, sel };

  const load = useCallback(() => {
    gw.request<{ jobs?: RawJob[] }>("cron.manage", { action: "list" })
      .then(res => { setJobs((res.jobs ?? []).map(normalize)); setErr(null); })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  // ── Actions (stable via live ref) ─────────────────────────────────

  const create = useCallback(async () => {
    const schedule = await openTextPrompt(dialog, {
      title: "New Cron Job", label: "Schedule (cron expr or 'every 30m')",
    });
    if (schedule === null) return;
    const prompt = await openTextPrompt(dialog, {
      title: "New Cron Job", label: "Prompt",
    });
    if (prompt === null) return;
    gw.request("cron.manage", { action: "add", name: "", schedule, prompt })
      .then(() => { toast.show({ variant: "success", message: "Job created" }); load(); })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, dialog, toast, load]);

  const toggle = useCallback(() => {
    const j = live.current.jobs[live.current.sel];
    if (!j) return;
    const action = j.enabled ? "pause" : "resume";
    gw.request("cron.manage", { action, name: j.id })
      .then(() => { toast.show({ variant: "success", message: j.enabled ? "Paused" : "Resumed" }); load(); })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, toast, load]);

  const remove = useCallback(async () => {
    const j = live.current.jobs[live.current.sel];
    if (!j) return;
    const ok = await openConfirm(dialog, {
      title: "Delete Job?",
      body: `Delete "${j.name || j.id}"? This cannot be undone.`,
      yes: "delete", danger: true,
    });
    if (!ok) return;
    gw.request("cron.manage", { action: "remove", name: j.id })
      .then(() => {
        toast.show({ variant: "success", message: "Deleted" });
        setSel(s => Math.max(0, Math.min(s, live.current.jobs.length - 2)));
        load();
      })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, dialog, toast, load]);

  useKeyboard((key) => {
    if (!props.focused || dialog.stack.length > 0) return;
    if (key.name === "up") return setSel(s => Math.max(0, s - 1));
    if (key.name === "down") return setSel(s => Math.min(jobs.length - 1, s + 1));
    if (key.raw === "r") return load();
    if (key.raw === "n") return void create();
    if (key.name === "space") return toggle();
    if (key.raw === "d" || key.name === "delete") return remove();
  });

  const job = jobs[sel] ?? null;

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell title={`Cron Jobs (${jobs.length})`} error={err}
                hint="↑↓ nav  n new  Space pause/resume  d delete  r refresh">
        {jobs.length === 0 ? (
          <box key="empty" flexGrow={1}>
            <text fg={theme.textMuted}>No cron jobs. Press n to create one.</text>
          </box>
        ) : (
          <scrollbox key="list" scrollY flexGrow={1}>
            {jobs.map((j, i) => (
              <JobRow
                key={j.id}
                job={j}
                selected={i === sel}
                onSelect={() => setSel(i)}
                onHover={() => setSel(i)}
              />
            ))}
          </scrollbox>
        )}
      </TabShell>

      {job ? <DetailPanel job={job} /> : null}
    </box>
  );
});
