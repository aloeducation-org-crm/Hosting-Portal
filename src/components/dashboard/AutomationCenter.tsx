"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock3, GitBranch, Loader2, Play, Plus, RefreshCw, Server, ShieldCheck, Workflow, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { formatDuration, formatTime, parseJson, pretty, statusClasses, verificationLabel, type AutomationSnapshot, type JobDetail, type ProfileRecord, type RunRecord, type WorkflowRecord } from "./automation/model";

const ACCENT = "#E8501A";
const TERMINAL_RUN = ["SUCCEEDED", "FAILED", "CANCELLED"];
const ACTIVE_JOB = ["QUEUED", "VALIDATING", "WAITING_APPROVAL", "RUNNING", "VERIFYING", "RETRYING", "ROLLING_BACK"];
const EXAMPLE_DEFINITION = pretty({ version: 1, steps: [{ key: "nodes", label: "Check enrolled nodes", handler: "PLATFORM_OPS", input: { action: "node-health" } }] });
const PROFILE_EXAMPLES: Record<string, unknown> = {
  node: { agentId: "", region: "default", maxConcurrency: 2 },
  github: { connectionId: "", credential: { envName: "GITHUB_TOKEN" } },
  dns: { provider: "cloudflare", zoneId: "", credential: { envName: "CLOUDFLARE_API_TOKEN" } },
  runtime: { framework: "nextjs", config: { version: 1, serviceManager: "none", port: 3100, envNames: [] } },
  database: { engine: "SQLITE_ISOLATED", hostRef: { envName: "DATABASE_HOST" }, credential: { envName: "DATABASE_PASSWORD" }, backupVerified: false },
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("font-medium", statusClasses(status))}>{status.replaceAll("_", " ")}</Badge>;
}
function VerificationBadge({ verified, code }: { verified: boolean | null | undefined; code?: string | null }) {
  const yes = verified === true && code !== "OK_UNVERIFIED";
  return <Badge variant="outline" className={yes ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{yes ? <ShieldCheck /> : <AlertTriangle />}{verificationLabel(verified, code)}</Badge>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-dashed border-slate-200 px-6 py-10 text-center"><p className="text-sm font-medium text-slate-700">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}
function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{pretty(value)}</pre></div>;
}

type ActionDialog =
  | { kind: "workflow.create" }
  | { kind: "workflow.edit"; workflow: WorkflowRecord }
  | { kind: "workflow.run"; workflow: WorkflowRecord }
  | { kind: "profile.create"; profile?: ProfileRecord }
  | { kind: "confirm"; title: string; description: string; payload: Record<string, unknown>; requireNote?: boolean; noteLabel?: string };

export function AutomationCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedRun = searchParams.get("run");
  const [data, setData] = useState<AutomationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);
  const [tab, setTab] = useState(linkedRun ? "runs" : "overview");
  const [query, setQuery] = useState("");
  const [jobState, setJobState] = useState("ALL");
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const url = linkedRun ? `/api/automation/admin?run=${encodeURIComponent(linkedRun)}` : "/api/automation/admin";
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || "Automation Center could not be loaded");
      if (mounted.current) { setData(body.data); setError(null); }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Automation Center could not be loaded");
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [linkedRun]);

  useEffect(() => { mounted.current = true; const timer = setTimeout(() => void load(), 0); return () => { mounted.current = false; clearTimeout(timer); }; }, [load]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 10_000);
    return () => clearInterval(timer);
  }, [live, load]);

  const selectedRun = data?.selectedRun?.id === linkedRun ? data.selectedRun : data?.runs.find((r) => r.id === linkedRun) ?? null;
  const openRun = useCallback((id: string | null) => {
    if (id) setTab("runs");
    router.replace(id ? `/automation?run=${encodeURIComponent(id)}` : "/automation", { scroll: false });
  }, [router]);

  const openJob = useCallback(async (id: string) => {
    setJobLoading(true); setJobDetail(null);
    try {
      const res = await fetch(`/api/orchestrator/jobs/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || "Job detail unavailable");
      setJobDetail(body.data);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Job detail unavailable"); }
    finally { setJobLoading(false); }
  }, []);

  async function act(payload: Record<string, unknown>, close = true) {
    setBusy(true);
    try {
      const res = await fetch("/api/automation/admin", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || "Action was refused");
      toast.success(body.message || "Action recorded");
      if (close) setDialog(null);
      await load(true);
      if (jobDetail) await openJob(jobDetail.id);
      return body.data;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Action failed"); return null; }
    finally { setBusy(false); }
  }

  const filteredRuns = useMemo(() => (data?.runs ?? []).filter((r) => `${r.workflow.name} ${r.workflow.key} ${r.id} ${r.status}`.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const filteredJobs = useMemo(() => (data?.jobs ?? []).filter((j) => (jobState === "ALL" || j.status === jobState) && `${j.type} ${j.workerKind} ${j.id} ${j.actorEmail}`.toLowerCase().includes(query.toLowerCase())), [data, query, jobState]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}><Workflow className="h-4 w-4" /> Administrator control plane</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Automation Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Durable workflows, approval-gated jobs and versioned infrastructure profiles. A completed step is only verified when independent evidence confirms it.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600"><Switch checked={live} onCheckedChange={setLive} aria-label="Refresh every ten seconds" />Live refresh</label>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}><RefreshCw className={cn(refreshing && "animate-spin")} />Refresh</Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>Automation data unavailable</AlertTitle><AlertDescription>{error} Existing measurements below may be stale.</AlertDescription></Alert>}
      {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" style={{ color: ACCENT }} /></div> : data && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Queued / retrying", value: data.queue.queued, icon: Clock3, note: `Oldest wait ${formatDuration(data.queue.oldestQueuedDelayMs)}` },
            { label: "Running", value: data.queue.running, icon: Activity, note: `${data.queue.active} active jobs` },
            { label: "Awaiting approval", value: data.queue.waitingApproval, icon: ShieldCheck, note: "Named administrator required" },
            { label: "Dead letters", value: data.queue.deadLetters, icon: AlertTriangle, note: "Inspect before requeueing" },
            { label: "Online agents", value: data.agents.filter((a) => a.online).length, icon: Server, note: `${data.agents.length} enrolled` },
          ].map((s) => <Card key={s.label} className="gap-2 border-slate-200 py-4"><CardHeader className="px-4"><CardDescription className="flex items-center gap-2 text-xs"><s.icon className="h-4 w-4" style={{ color: ACCENT }} />{s.label}</CardDescription><CardTitle className="text-2xl">{s.value}</CardTitle></CardHeader><CardContent className="px-4 text-xs text-slate-500">{s.note}</CardContent></Card>)}
        </div>
        <p className="text-xs text-slate-400">Snapshot observed {formatTime(data.observedAt)}. Queue activity is not a worker-heartbeat measurement; the systemd/container healthcheck owns process liveness.</p>

        <Tabs value={tab} onValueChange={(v) => { setTab(v); setQuery(""); }}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="workflows">Workflows <Badge variant="secondary">{data.workflows.length}</Badge></TabsTrigger><TabsTrigger value="runs">Runs</TabsTrigger><TabsTrigger value="jobs">Jobs & approvals</TabsTrigger><TabsTrigger value="profiles">Profiles</TabsTrigger><TabsTrigger value="workers">Workers & agents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">Recent workflow runs</CardTitle><CardDescription>Version-frozen executions; verification is reported separately from completion.</CardDescription></CardHeader><CardContent className="space-y-2">
                {data.runs.length === 0 ? <EmptyState title="No workflow runs yet" detail="Run a workflow manually or let an enabled schedule/event start one." /> : data.runs.slice(0, 6).map((r) => <button key={r.id} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50" onClick={() => { setTab("runs"); openRun(r.id); }}><div className="min-w-0"><p className="truncate text-sm font-medium">{r.workflow.name}</p><p className="text-xs text-slate-500">v{r.workflowVersion} · {formatTime(r.createdAt)}</p></div><div className="flex shrink-0 items-center gap-2"><StatusBadge status={r.status} /><ChevronRight className="h-4 w-4 text-slate-400" /></div></button>)}
              </CardContent></Card>
              <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">Needs attention</CardTitle><CardDescription>Approvals, dead letters and failed checks. No green status is inferred from configuration.</CardDescription></CardHeader><CardContent className="space-y-2">
                {data.jobs.filter((j) => ["WAITING_APPROVAL", "DEAD_LETTER", "FAILED"].includes(j.status)).length === 0 ? <EmptyState title="No jobs in an attention state" detail="This is a queue observation, not a claim that every external system is healthy." /> : data.jobs.filter((j) => ["WAITING_APPROVAL", "DEAD_LETTER", "FAILED"].includes(j.status)).slice(0, 6).map((j) => <button key={j.id} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50" onClick={() => void openJob(j.id)}><div className="min-w-0"><p className="truncate text-sm font-medium">{j.type}</p><p className="truncate text-xs text-slate-500">{j.lastError ?? j.deadLetterReason ?? j.workerKind}</p></div><StatusBadge status={j.status} /></button>)}
              </CardContent></Card>
            </div>
            <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">Queue measurements</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-4"><div><p className="text-xs text-slate-500">Recorded jobs</p><p className="font-semibold">{data.queue.total}</p></div><div><p className="text-xs text-slate-500">Terminal success ratio</p><p className="font-semibold">{data.queue.successRate === null ? "Not measured" : `${Math.round(data.queue.successRate * 100)}%`}</p></div><div><p className="text-xs text-slate-500">Mean terminal duration</p><p className="font-semibold">{formatDuration(data.queue.averageDurationMs)}</p></div><div><p className="text-xs text-slate-500">Last job completion</p><p className="font-semibold">{formatTime(data.queue.lastExecutionAt)}</p></div></CardContent></Card>
          </TabsContent>

          <TabsContent value="workflows" className="mt-4">
            <Card className="border-slate-200"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Workflow definitions</CardTitle><CardDescription>Schedules and events only fire while enabled. Manual runs remain available to administrators.</CardDescription></div><Button size="sm" style={{ backgroundColor: ACCENT }} onClick={() => setDialog({ kind: "workflow.create" })}><Plus />New workflow</Button></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="pl-4">Workflow</TableHead><TableHead>Trigger</TableHead><TableHead>Version</TableHead><TableHead>Enabled</TableHead><TableHead>Next run</TableHead><TableHead className="pr-4 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
              {data.workflows.map((w) => <TableRow key={w.id}><TableCell className="pl-4"><p className="font-medium">{w.name}</p><p className="font-mono text-xs text-slate-500">{w.key}</p><p className="max-w-md whitespace-normal text-xs text-slate-500">{w.description}</p></TableCell><TableCell><p>{w.trigger}</p><p className="text-xs text-slate-500">{w.eventName ?? (w.intervalSeconds ? `every ${w.intervalSeconds}s` : "manual")}</p></TableCell><TableCell>v{w.version}</TableCell><TableCell><Switch checked={w.enabled} disabled={busy} aria-label={`Enable ${w.name}`} onCheckedChange={(enabled) => void act({ action: "workflow.toggle", workflowId: w.id, enabled })} /></TableCell><TableCell className="text-xs">{formatTime(w.nextRunAt)}</TableCell><TableCell className="pr-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "workflow.edit", workflow: w })}>Edit</Button><Button variant="outline" size="sm" onClick={() => setDialog({ kind: "workflow.run", workflow: w })}><Play />Run</Button></div></TableCell></TableRow>)}
            </TableBody></Table></CardContent></Card>
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <Card className="border-slate-200"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">Workflow runs</CardTitle><CardDescription>Most recent 50. Open a run for step evidence and linked jobs.</CardDescription></div><Input className="max-w-xs" placeholder="Search runs…" value={query} onChange={(e) => setQuery(e.target.value)} /></div></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="pl-4">Workflow</TableHead><TableHead>Status</TableHead><TableHead>Verification</TableHead><TableHead>Trigger / actor</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filteredRuns.map((r) => <TableRow key={r.id} className="cursor-pointer" onClick={() => openRun(r.id)}><TableCell className="pl-4"><p className="font-medium">{r.workflow.name}</p><p className="text-xs text-slate-500">v{r.workflowVersion} · {r.id.slice(0, 8)}</p></TableCell><TableCell><StatusBadge status={r.status} /></TableCell><TableCell><VerificationBadge verified={r.verified} /></TableCell><TableCell className="text-xs">{r.trigger}<br /><span className="text-slate-500">{r.actorEmail ?? "platform"}</span></TableCell><TableCell className="text-xs">{formatTime(r.createdAt)}</TableCell><TableCell className="text-xs">{formatDuration(r.durationMs)}</TableCell><TableCell className="pr-4"><ChevronRight className="h-4 w-4 text-slate-400" /></TableCell></TableRow>)}</TableBody></Table>{filteredRuns.length === 0 && <div className="p-4"><EmptyState title="No matching runs" detail="Workflow runs appear here after a manual, scheduled or event trigger." /></div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            <Card className="border-slate-200"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">Durable jobs and approval gate</CardTitle><CardDescription>Inspect immutable input and evidence before approving privileged work.</CardDescription></div><div className="flex gap-2"><Input className="max-w-xs" placeholder="Search jobs…" value={query} onChange={(e) => setQuery(e.target.value)} /><Select value={jobState} onValueChange={setJobState}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All states</SelectItem>{data.jobStates.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div></div></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="pl-4">Job</TableHead><TableHead>State</TableHead><TableHead>Risk</TableHead><TableHead>Outcome</TableHead><TableHead>Attempts</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filteredJobs.map((j) => <TableRow key={j.id} className="cursor-pointer" onClick={() => void openJob(j.id)}><TableCell className="pl-4"><p className="font-medium">{j.type}</p><p className="font-mono text-xs text-slate-500">{j.workerKind} · {j.id.slice(0, 8)}</p></TableCell><TableCell><StatusBadge status={j.status} /></TableCell><TableCell><Badge variant="outline">{j.riskLevel}</Badge></TableCell><TableCell><VerificationBadge verified={j.verified} code={j.resultCode} />{j.findingCount > 0 && <p className="mt-1 text-xs text-slate-500">{j.findingCount} findings{j.criticalFindings ? ` · ${j.criticalFindings} critical` : ""}</p>}</TableCell><TableCell>{j.attempts}/{j.maxAttempts}</TableCell><TableCell className="text-xs">{formatTime(j.createdAt)}</TableCell><TableCell className="pr-4"><ChevronRight className="h-4 w-4 text-slate-400" /></TableCell></TableRow>)}</TableBody></Table>{filteredJobs.length === 0 && <div className="p-4"><EmptyState title="No matching jobs" detail="Enqueued work and approval requests appear here." /></div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="profiles" className="mt-4">
            <Card className="border-slate-200"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Versioned configuration profiles</CardTitle><CardDescription>Only verified versions can become active. Credentials are environment/secret references, never values.</CardDescription></div><Button size="sm" style={{ backgroundColor: ACCENT }} onClick={() => setDialog({ kind: "profile.create" })}><Plus />New profile</Button></CardHeader><CardContent className="space-y-4">{data.profiles.length === 0 ? <EmptyState title="No profiles configured" detail="Create a node, GitHub, DNS, runtime or database profile using credential references." /> : data.profiles.map((p) => <div key={p.id} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{p.name} <Badge variant="secondary">{p.kind}</Badge></p><p className="font-mono text-xs text-slate-500">{p.key} · active {p.activeVersion ? `v${p.activeVersion}` : "none"}</p></div><Button variant="outline" size="sm" onClick={() => setDialog({ kind: "profile.create", profile: p })}>New version</Button></div><div className="mt-3 space-y-2">{p.versions.map((v) => <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"><div><p className="text-sm font-medium">v{v.version} <StatusBadge status={v.status} /></p><p className="text-xs text-slate-500">{v.changeNote || "No change note"} · {formatTime(v.createdAt)}</p>{v.verificationError && <p className="mt-1 text-xs text-red-700">{v.verificationError}</p>}</div><div className="flex gap-2">{v.verificationJobId && <Button variant="ghost" size="sm" onClick={() => void openJob(v.verificationJobId!)}>Verification job</Button>}{v.status !== "VERIFIED" && v.status !== "VERIFYING" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void act({ action: "profile.verify", versionId: v.id, requestId: crypto.randomUUID() })}>Verify</Button>}{v.status === "VERIFIED" && p.activeVersion !== v.version && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "confirm", title: `Activate ${p.key} v${v.version}?`, description: "This switches the active configuration to a previously verified immutable version. It does not deploy anything by itself.", payload: { action: "profile.rollback", profileId: p.id, version: v.version } })}>Activate version</Button>}</div></div>)}</div></div>)}</CardContent></Card>
          </TabsContent>

          <TabsContent value="workers" className="mt-4 space-y-4">
            <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">Registered worker catalogue</CardTitle><CardDescription>Registration describes allowed code, not external-system readiness. Missing credentials or agents block execution explicitly.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.workers.map((w) => <div key={w.kind} className="rounded-lg border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><p className="font-medium">{w.label}</p><Badge variant="outline">{w.execution}</Badge></div><p className="mt-1 font-mono text-xs text-slate-500">{w.kind}</p><p className="mt-2 text-xs text-slate-600">{w.description}</p><div className="mt-3 flex flex-wrap gap-1"><Badge variant="secondary">max {w.maxRisk}</Badge>{w.requiredScopes.map((s) => <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>)}</div></div>)}</CardContent></Card>
            <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">Enrolled node agents</CardTitle><CardDescription>Online means an active enrollment with a fresh heartbeat, not that every capability has been exercised.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="pl-4">Agent</TableHead><TableHead>Reachability</TableHead><TableHead>Last heartbeat</TableHead><TableHead>Capabilities</TableHead><TableHead>Scopes</TableHead></TableRow></TableHeader><TableBody>{data.agents.map((a) => <TableRow key={a.id}><TableCell className="pl-4"><p className="font-medium">{a.name}</p><p className="text-xs text-slate-500">{a.server?.hostname ?? a.agentKey}</p></TableCell><TableCell><Badge variant="outline" className={a.online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{a.online ? "Online" : "Offline / stale"}</Badge></TableCell><TableCell className="text-xs">{formatTime(a.lastHeartbeat)}</TableCell><TableCell className="max-w-xs whitespace-normal text-xs">{a.capabilities.join(", ") || "Not reported"}</TableCell><TableCell className="max-w-xs whitespace-normal font-mono text-xs">{a.scopes.join(", ") || "None granted"}</TableCell></TableRow>)}</TableBody></Table>{data.agents.length === 0 && <div className="p-4"><EmptyState title="No enrolled agents" detail="Agent-dependent operations will report AGENT_UNAVAILABLE until a node enrolls." /></div>}</CardContent></Card>
          </TabsContent>
        </Tabs>
      </>}

      <RunSheet run={selectedRun} onClose={() => openRun(null)} onJob={openJob} busy={busy} onCancel={(r) => setDialog({ kind: "confirm", title: "Cancel this workflow run?", description: "Pending steps are cancelled. A running non-cooperative effect may finish; its lease remains fenced from advancing the workflow.", payload: { action: "run.cancel", runId: r.id }, requireNote: true, noteLabel: "Cancellation reason" })} />
      <Sheet open={!!jobDetail || jobLoading} onOpenChange={(open) => { if (!open) { setJobDetail(null); setJobLoading(false); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader><SheetTitle>Job evidence and controls</SheetTitle><SheetDescription>Immutable input, human approval, progress and the worker&apos;s actual verification result.</SheetDescription></SheetHeader>
          {jobLoading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div> : jobDetail && <div className="space-y-4 px-4 pb-6">
            <div className="flex flex-wrap gap-2"><StatusBadge status={jobDetail.status} /><Badge variant="outline">{jobDetail.riskLevel}</Badge><VerificationBadge verified={jobDetail.result?.verified} code={jobDetail.result?.code} /></div>
            <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-500">Job</p><p className="break-all font-mono">{jobDetail.id}</p></div><div><p className="text-slate-500">Correlation</p><p className="break-all font-mono">{jobDetail.correlationId ?? "—"}</p></div><div><p className="text-slate-500">Attempts</p><p>{jobDetail.attempts}/{jobDetail.maxAttempts} · retry-safe {String(jobDetail.retrySafe)}</p></div><div><p className="text-slate-500">Approval</p><p>{jobDetail.requiresApproval ? jobDetail.approvedBy ?? "Required — not approved" : "Not required for this risk"}</p></div><div><p className="text-slate-500">Lease owner</p><p>{jobDetail.leasedBy ?? "None"}</p></div><div><p className="text-slate-500">Cancellation</p><p>{jobDetail.cancellationRequestedAt ? `Requested ${formatTime(jobDetail.cancellationRequestedAt)}` : "Not requested"}</p></div></div>
            {jobDetail.error && <Alert variant="destructive"><XCircle /><AlertTitle>{jobDetail.lastError ?? "Job error"}</AlertTitle><AlertDescription>{jobDetail.error}</AlertDescription></Alert>}
            {jobDetail.result && <div className="rounded-lg border border-slate-200 p-3"><p className="text-sm font-semibold">{jobDetail.result.code}: {jobDetail.result.message}</p><p className="mt-2 text-xs text-slate-500">Evidence</p><p className="text-sm">{jobDetail.result.evidence || "No independent evidence was reported."}</p>{jobDetail.result.warnings?.map((w, i) => <p key={i} className="mt-2 text-xs text-amber-700">{w}</p>)}</div>}
            {jobDetail.result?.findings?.map((f, i) => <div key={i} className={cn("rounded-md border p-3", f.severity === "critical" ? "border-red-200 bg-red-50" : f.severity === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200")}><p className="text-sm font-medium">{f.title} <Badge variant="outline">{f.severity}</Badge></p>{f.detail && <p className="mt-1 text-xs">{f.detail}</p>}{f.remediation && <p className="mt-1 text-xs text-slate-600">Remediation: {f.remediation}</p>}</div>)}
            <div className="flex flex-wrap gap-2">
              {jobDetail.status === "WAITING_APPROVAL" && <><Button size="sm" style={{ backgroundColor: ACCENT }} onClick={() => setDialog({ kind: "confirm", title: "Approve this exact job?", description: `${jobDetail.workerKind} · ${jobDetail.riskLevel}. Review the immutable input and evidence below. Approval expires after 15 minutes and is consumed by this job only.`, payload: { action: "job.approve", jobId: jobDetail.id }, noteLabel: "Approval note (optional)" })}><ShieldCheck />Approve</Button><Button size="sm" variant="destructive" onClick={() => setDialog({ kind: "confirm", title: "Reject approval?", description: "The job fails and the workflow will not advance past this step.", payload: { action: "job.reject", jobId: jobDetail.id }, requireNote: true, noteLabel: "Rejection reason" })}>Reject</Button></>}
              {ACTIVE_JOB.includes(jobDetail.status) && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "confirm", title: "Request cancellation?", description: "A running effect may finish cooperatively; the UI will continue to show its real state.", payload: { action: "job.cancel", jobId: jobDetail.id }, requireNote: true, noteLabel: "Cancellation reason" })}>Cancel</Button>}
              {["FAILED", "DEAD_LETTER"].includes(jobDetail.status) && jobDetail.retrySafe && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "confirm", title: "Requeue this job?", description: "Only retry-safe work can be requeued. A gated job returns to WAITING_APPROVAL and needs fresh approval.", payload: { action: "job.requeue", jobId: jobDetail.id }, noteLabel: "Operator note (optional)" })}>Requeue</Button>}
              {jobDetail.automation?.runId && <Button size="sm" variant="ghost" onClick={() => { setJobDetail(null); setTab("runs"); openRun(jobDetail.automation!.runId); }}>Open workflow run</Button>}
            </div>
            <JsonBlock label="Immutable input" value={jobDetail.input} />
            {jobDetail.result?.data !== undefined && <JsonBlock label="Worker output" value={jobDetail.result.data} />}
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Progress events</p><div className="space-y-2">{jobDetail.events.map((e, i) => <div key={i} className="border-l-2 pl-3 text-xs" style={{ borderColor: ACCENT }}><p className="text-slate-400">{formatTime(e.at)} · {e.percent}%</p><p className="text-slate-700">{e.message}</p></div>)}</div></div>
          </div>}
        </SheetContent>
      </Sheet>
      {dialog && <ActionDialogView dialog={dialog} busy={busy} onClose={() => setDialog(null)} onSubmit={act} />}
    </div>
  );
}

function RunSheet({ run, onClose, onJob, onCancel, busy }: { run: RunRecord | null; onClose: () => void; onJob: (id: string) => Promise<void>; onCancel: (run: RunRecord) => void; busy: boolean }) {
  return <Sheet open={!!run} onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl"><SheetHeader><SheetTitle>{run?.workflow.name ?? "Workflow run"}</SheetTitle><SheetDescription>Run {run?.id} · definition v{run?.workflowVersion}</SheetDescription></SheetHeader>{run && <div className="space-y-4 px-4 pb-6"><div className="flex flex-wrap gap-2"><StatusBadge status={run.status} /><VerificationBadge verified={run.verified} /></div>{run.error && <Alert variant="destructive"><AlertTriangle /><AlertDescription>{run.error}</AlertDescription></Alert>}<div className="text-xs text-slate-500">Triggered by {run.actorEmail ?? "platform"} · {formatTime(run.createdAt)} · {formatDuration(run.durationMs)}</div>{!TERMINAL_RUN.includes(run.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => onCancel(run)}>Cancel run</Button>}<div className="space-y-3">{run.steps.map((s) => <div key={s.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{s.ordinal + 1}. {s.label}</p><StatusBadge status={s.status} /></div><p className="mt-1 font-mono text-xs text-slate-500">{s.handler} · {s.key} · attempts {s.attempts}</p><div className="mt-2"><VerificationBadge verified={s.verified} /></div>{s.error && <p className="mt-2 text-xs text-red-700">{s.error}</p>}{s.output && <div className="mt-2"><JsonBlock label="Step output" value={parseJson(s.output, null)} /></div>}{s.jobId && <Button className="mt-2" variant="ghost" size="sm" onClick={() => void onJob(s.jobId!)}>Inspect job evidence <ChevronRight /></Button>}</div>)}</div><JsonBlock label="Run input" value={parseJson(run.input, {})} />{run.output && <JsonBlock label="Run output" value={parseJson(run.output, null)} />}</div>}</SheetContent></Sheet>;
}

function ActionDialogView({ dialog, busy, onClose, onSubmit }: { dialog: ActionDialog; busy: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("manual");
  const [eventName, setEventName] = useState("");
  const [interval, setIntervalSeconds] = useState("3600");
  const [definition, setDefinition] = useState(dialog.kind === "workflow.edit" ? pretty(parseJson(dialog.workflow.definition, EXAMPLE_DEFINITION)) : EXAMPLE_DEFINITION);
  const [json, setJson] = useState(dialog.kind === "workflow.run" ? dialog.workflow.scheduleInput || "{}" : dialog.kind === "workflow.edit" ? dialog.workflow.scheduleInput || "{}" : dialog.kind === "profile.create" ? pretty(dialog.profile?.versions[0]?.config ?? PROFILE_EXAMPLES.node) : "{}");
  const [kind, setKind] = useState(dialog.kind === "profile.create" ? dialog.profile?.kind ?? "node" : "node");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const title = dialog.kind === "workflow.create" ? "Create workflow" : dialog.kind === "workflow.edit" ? `Version ${dialog.workflow.key}` : dialog.kind === "workflow.run" ? `Run ${dialog.workflow.name}` : dialog.kind === "profile.create" ? (dialog.profile ? `New version of ${dialog.profile.key}` : "Create profile") : dialog.title;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setFormError(null);
    try {
      let payload: Record<string, unknown>;
      if (dialog.kind === "workflow.create") payload = { action: "workflow.create", key, name, description: description || undefined, trigger, eventName: eventName || undefined, intervalSeconds: trigger === "schedule" ? Number(interval) : undefined, definition: JSON.parse(definition), scheduleInput: JSON.parse(json) };
      else if (dialog.kind === "workflow.edit") payload = { action: "workflow.version", workflowId: dialog.workflow.id, definition: JSON.parse(definition), scheduleInput: JSON.parse(json), changeNote: note || undefined };
      else if (dialog.kind === "workflow.run") payload = { action: "workflow.run", workflowId: dialog.workflow.id, input: JSON.parse(json), requestId: crypto.randomUUID() };
      else if (dialog.kind === "profile.create") payload = { action: "profile.create", key: dialog.profile?.key ?? key, name: dialog.profile?.name ?? name, kind, config: JSON.parse(json), changeNote: note || undefined };
      else {
        if (dialog.requireNote && !note.trim()) throw new Error(`${dialog.noteLabel ?? "Reason"} is required`);
        payload = { ...dialog.payload, ...(dialog.noteLabel?.toLowerCase().includes("reason") ? { reason: note } : dialog.payload.action === "job.approve" || dialog.payload.action === "job.requeue" ? { note } : {}) };
      }
      await onSubmit(payload);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Check the form values"); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{dialog.kind === "confirm" ? dialog.description : dialog.kind === "profile.create" ? "Store credential references only. A new version stays inactive until its verification job succeeds." : "Definitions are validated against the registered worker catalogue and frozen into each run."}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4">
    {(dialog.kind === "workflow.create" || (dialog.kind === "profile.create" && !dialog.profile)) && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="automation-name">Name</Label><Input id="automation-name" required value={name} onChange={(e) => setName(e.target.value)} /></div><div><Label htmlFor="automation-key">Unique key</Label><Input id="automation-key" required pattern="[a-z][a-z0-9-]{2,63}" placeholder="fleet-health-check" value={key} onChange={(e) => setKey(e.target.value)} /></div></div>}
    {dialog.kind === "workflow.create" && <><div><Label htmlFor="automation-description">Description</Label><Textarea id="automation-description" value={description} onChange={(e) => setDescription(e.target.value)} /></div><div className="grid gap-3 sm:grid-cols-3"><div><Label>Trigger</Label><Select value={trigger} onValueChange={setTrigger}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["manual", "schedule", "event", "webhook"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>{trigger === "schedule" ? <div><Label htmlFor="automation-interval">Interval (seconds)</Label><Input id="automation-interval" type="number" min={30} max={2592000} value={interval} onChange={(e) => setIntervalSeconds(e.target.value)} /></div> : <div><Label htmlFor="automation-event">Event name</Label><Input id="automation-event" required={trigger === "event" || trigger === "webhook"} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="project.lifecycle.requested" /></div>}</div></>}
    {(dialog.kind === "workflow.create" || dialog.kind === "workflow.edit") && <><div><Label htmlFor="automation-definition">Definition JSON</Label><Textarea id="automation-definition" className="min-h-64 font-mono text-xs" required value={definition} onChange={(e) => setDefinition(e.target.value)} /></div><div><Label htmlFor="automation-schedule-input">Schedule input JSON</Label><Textarea id="automation-schedule-input" className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} /></div></>}
    {dialog.kind === "workflow.run" && <div><Label htmlFor="automation-run-input">Run input JSON</Label><Textarea id="automation-run-input" className="min-h-40 font-mono text-xs" required value={json} onChange={(e) => setJson(e.target.value)} /><p className="mt-1 text-xs text-slate-500">Missing external access or credentials will block the run with an explicit reason.</p></div>}
    {dialog.kind === "profile.create" && <><div><Label>Profile kind</Label><Select value={kind} onValueChange={(v) => { setKind(v); if (!dialog.profile) setJson(pretty(PROFILE_EXAMPLES[v])); }} disabled={!!dialog.profile}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["node", "github", "dns", "runtime", "database"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="automation-profile-config">Configuration JSON (references, not secret values)</Label><Textarea id="automation-profile-config" className="min-h-48 font-mono text-xs" required value={json} onChange={(e) => setJson(e.target.value)} /></div></>}
    {(dialog.kind === "confirm" || dialog.kind === "workflow.edit" || dialog.kind === "profile.create") && <div><Label htmlFor="automation-note">{dialog.kind === "confirm" ? dialog.noteLabel ?? "Note" : "Change note"}</Label><Textarea id="automation-note" required={dialog.kind === "confirm" && dialog.requireNote} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
    {formError && <Alert variant="destructive"><AlertTriangle /><AlertDescription>{formError}</AlertDescription></Alert>}
    <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button><Button type="submit" disabled={busy} style={{ backgroundColor: ACCENT }}>{busy && <Loader2 className="animate-spin" />}{dialog.kind === "workflow.run" ? "Queue run" : dialog.kind === "confirm" ? "Confirm" : "Save"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
