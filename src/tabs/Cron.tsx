import { useState, useEffect, useCallback, memo } from "react";
import { useKeyboard } from "@opentui/react";
import { useGateway } from "../app/gateway";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { TabShell } from "../ui/shell";
import { KVBlock } from "../ui/kv";
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
  const indicator = props.selected ? "▸ " : "  ";

  const stateColor = j.state === "error" ? theme.error
    : j.enabled ? theme.success : theme.warning;
  const badge = j.state === "error" ? "ERR" : j.enabled ? "ACT" : "PAU";

  return (
    <box backgroundColor={bg} onMouseDown={props.onSelect} onMouseOver={props.onHover}>
      <text>
        <span fg={props.selected ? theme.primary : theme.text}>{indicator}</span>
        <span fg={props.selected ? theme.accent : theme.text}>
          {trunc(j.name || j.id, 20).padEnd(22)}
        </span>
        <span fg={stateColor}>{` ${badge} `}</span>
        <span fg={theme.textMuted}>{(j.schedule?.display ?? j.schedule?.expr ?? "—").padEnd(18)}</span>
        <span fg={theme.textMuted}>{` last: ${rel(j.last_run).padEnd(10)}`}</span>
        <span fg={theme.textMuted}>{` next: ${rel(j.next_run).padEnd(10)}`}</span>
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

// ─── Confirm Dialog ──────────────────────────────────────────────────

const Confirm = (props: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const theme = useTheme().theme;

  useKeyboard((key) => {
    if (key.name === "y") props.onConfirm();
    if (key.name === "n" || key.name === "escape") props.onCancel();
  });

  return (
    <box flexDirection="column" width={50}>
      <text><span fg={theme.warning}><strong>{props.title}</strong></span></text>
      <text> </text>
      <text wrapMode="word"><span fg={theme.text}>{props.message}</span></text>
      <text> </text>
      <text><span fg={theme.textMuted}>{"  [y] Confirm    [n] Cancel"}</span></text>
    </box>
  );
};

// ─── Create Dialog ───────────────────────────────────────────────────

const CreateDialog = (props: {
  onCreate: (name: string, prompt: string, schedule: string, deliver: string) => void;
  onCancel: () => void;
}) => {
  const theme = useTheme().theme;
  const [field, setField] = useState(0);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [deliver, setDeliver] = useState("local");

  const fields = [
    { label: "Name", value: name, set: setName },
    { label: "Schedule", value: schedule, set: setSchedule },
    { label: "Deliver", value: deliver, set: setDeliver },
    { label: "Prompt", value: prompt, set: setPrompt },
  ];

  useKeyboard((key) => {
    if (key.name === "escape") { props.onCancel(); return; }
    if (key.name === "tab") { setField(f => (f + 1) % 4); return; }
    if (key.name === "return" && prompt && schedule) {
      props.onCreate(name, prompt, schedule, deliver);
      return;
    }
    if (key.name === "backspace") {
      fields[field].set(v => v.slice(0, -1));
      return;
    }
    if (key.raw && key.raw.length === 1 && key.raw >= " ") {
      fields[field].set(v => v + key.raw);
    }
  });

  return (
    <box flexDirection="column" width={60}>
      <text><span fg={theme.primary}><strong>New Cron Job</strong></span></text>
      <text> </text>
      {fields.map((f, i) => (
        <box key={f.label}>
          <text>
            <span fg={i === field ? theme.accent : theme.textMuted}>
              {i === field ? "▸ " : "  "}
            </span>
            <span fg={theme.text}>{`${f.label.padEnd(10)}`}</span>
            <span fg={theme.text}>{f.value}</span>
            {i === field ? <span fg={theme.accent}>█</span> : null}
          </text>
        </box>
      ))}
      <text> </text>
      <text><span fg={theme.textMuted}>{"  Tab: next field  Enter: create  Esc: cancel"}</span></text>
    </box>
  );
};

// ─── Main Component ──────────────────────────────────────────────────

export const Cron = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const dialog = useDialog();
  const toast = useToast();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [selected, setSelected] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    gw.request<{ jobs?: RawJob[] }>("cron.manage", { action: "list" })
      .then(res => { setJobs((res.jobs ?? []).map(normalize)); setErr(null); })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  const current = jobs[selected] ?? null;

  useKeyboard((key) => {
    if (!props.focused) return;
    if (key.name === "up") { setSelected(s => Math.max(0, s - 1)); return; }
    if (key.name === "down") { setSelected(s => Math.min(jobs.length - 1, s + 1)); return; }
    if (key.name === "r") { load(); return; }

    if (key.raw === "n") {
      dialog.replace(
        <CreateDialog
          onCreate={(name, prompt, schedule, deliver) => {
            dialog.clear();
            gw.request("cron.manage", { action: "add", name, prompt, schedule, deliver })
              .then(() => { toast.show({ variant: "success", message: "Job created" }); load(); })
              .catch(() => toast.show({ variant: "error", message: "Failed to create job" }));
          }}
          onCancel={() => dialog.clear()}
        />,
      );
      return;
    }

    if (key.raw === "p" && current) {
      const act = current.enabled ? "pause" : "resume";
      gw.request("cron.manage", { action: act, name: current.id })
        .then(() => { toast.show({ variant: "success", message: current.enabled ? "Paused" : "Resumed" }); load(); })
        .catch(() => toast.show({ variant: "error", message: "Failed" }));
      return;
    }

    if (key.raw === "t" && current) {
      dialog.replace(
        <Confirm
          title="Trigger Job?"
          message={`Run "${current.name || current.id}" now?`}
          onConfirm={() => {
            dialog.clear();
            gw.request("cron.manage", { action: "run", name: current.id })
              .then(() => { toast.show({ variant: "success", message: "Triggered" }); load(); })
              .catch(() => toast.show({ variant: "error", message: "Failed to trigger" }));
          }}
          onCancel={() => dialog.clear()}
        />,
      );
      return;
    }

    if (key.raw === "d" && current) {
      dialog.replace(
        <Confirm
          title="Delete Job?"
          message={`Delete "${current.name || current.id}"?`}
          onConfirm={() => {
            dialog.clear();
            gw.request("cron.manage", { action: "remove", name: current.id })
              .then(() => {
                toast.show({ variant: "success", message: "Deleted" });
                setSelected(s => Math.min(s, jobs.length - 2));
                load();
              })
              .catch(() => toast.show({ variant: "error", message: "Failed to delete" }));
          }}
          onCancel={() => dialog.clear()}
        />,
      );
      return;
    }
  });

  return (
    <box flexDirection="row" flexGrow={1}>
      <TabShell title={`Cron Jobs (${jobs.length})`} error={err}
                hint="↑↓ nav  n new  p pause  t trigger  d delete  r refresh">
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
                selected={i === selected}
                onSelect={() => setSelected(i)}
                onHover={() => setSelected(i)}
              />
            ))}
          </scrollbox>
        )}
      </TabShell>

      {current ? <DetailPanel job={current} /> : null}
    </box>
  );
});
