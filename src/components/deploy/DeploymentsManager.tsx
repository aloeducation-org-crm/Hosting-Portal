"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitBranch, Github, Rocket, RotateCcw, RefreshCw, ShieldCheck,
  Activity, ExternalLink, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Clock, XCircle, Terminal, Settings2, Link2,
} from "lucide-react";

type AnyRecord = Record<string, any>;

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  FAILED: "bg-red-500/15 text-red-700 border-red-500/30",
  ROLLED_BACK: "bg-orange-500/15 text-orange-700 border-orange-500/30",
  RUNNING: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  PENDING: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  QUEUED: "bg-slate-500/15 text-slate-700 border-slate-500/30",
};

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error?.message || `HTTP ${res.status}`);
  return body?.data ?? body;
}

function StatusBadge({ status }: { status?: string | null }) {
  const key = String(status ?? "UNKNOWN").toUpperCase();
  const Icon = key === "SUCCESS" ? CheckCircle2 : key === "FAILED" ? XCircle : key === "RUNNING" ? Activity : Clock;
  return (
    <Badge variant="outline" className={`gap-1 ${STATUS_STYLE[key] ?? "bg-slate-500/10"}`}>
      <Icon className="h-3 w-3" /> {key}
    </Badge>
  );
}

export function DeploymentsManager() {
  const [projects, setProjects] = useState<AnyRecord[]>([]);
  const [github, setGithub] = useState<AnyRecord | null>(null);
  const [queue, setQueue] = useState<AnyRecord | null>(null);
  const [repos, setRepos] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<AnyRecord | null>(null);
  const [configDraft, setConfigDraft] = useState<string>("");
  const [importForm, setImportForm] = useState({ repository: "", productionBranch: "" });

  const refresh = useCallback(async () => {
    try {
      const [p, g, q] = await Promise.all([
        api("/api/deploy/projects"), api("/api/github/status"), api("/api/deploy/status"),
      ]);
      setProjects(p.items ?? []);
      setGithub(g);
      setQueue(q);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deployments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = () => void refresh();
    const first = setTimeout(run, 0);
    const timer = setInterval(run, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const loadRepos = async () => {
    setBusy("repos");
    try {
      const data = await api("/api/github/repos");
      setRepos(data.repositories ?? []);
      if (!data.configured) setError(data.reason ?? "GitHub is not connected");
      else toast.success(`${data.repositories?.length ?? 0} repositories available`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list repositories");
    } finally {
      setBusy(null);
    }
  };

  const importRepo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!importForm.repository.trim()) return;
    setBusy("import");
    try {
      const result = await api("/api/deploy/projects", {
        method: "POST",
        body: JSON.stringify({
          repository: importForm.repository.trim(),
          ...(importForm.productionBranch.trim() ? { productionBranch: importForm.productionBranch.trim() } : {}),
        }),
      });
      toast.success(`Imported ${result.project.repository} (${result.detection.framework})`);
      if (result.warnings?.length) result.warnings.forEach((w: string) => toast.warning(w));
      setImportForm({ repository: "", productionBranch: "" });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const action = async (projectId: string, kind: "deploy" | "rollback" | "auto" | "confirm" | "config", payload?: AnyRecord, current?: AnyRecord) => {
    setBusy(`${kind}-${projectId}`);
    try {
      if (kind === "deploy" || kind === "rollback") {
        const result = await api(`/api/deploy/projects/${projectId}/${kind}`, { method: "POST", body: "{}" });
        toast.success(kind === "deploy" ? `Deployment queued: ${result.deploymentId?.slice(0, 8)}` : `Rollback ${result.verified ? "verified" : "FAILED"}`);
      } else {
        const body = kind === "auto"
          ? { autoDeploy: !current?.autoDeploy }
          : kind === "confirm"
            ? { confirm: true, autoDeploy: true }
            : { config: JSON.parse(configDraft) };
        await api(`/api/deploy/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Configuration saved");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleDetails = async (project: AnyRecord) => {
    if (expanded === project.id) { setExpanded(null); setLogs(null); return; }
    setExpanded(project.id);
    setConfigDraft(JSON.stringify(project.config ?? {}, null, 2));
    const latest = project.latestDeployment?.id;
    if (latest) {
      try { setLogs(await api(`/api/deploy/deployments/${latest}`)); } catch { setLogs(null); }
    } else setLogs(null);
  };

  if (loading) return <div className="space-y-4 p-6">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Git Deployments</h1>
          <p className="text-sm text-muted-foreground">
            GitHub push → verified build → immutable release → health-checked deploy → rollback.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/ai/auto-deploy"><Rocket className="mr-2 h-4 w-4 text-[#E8501A]" /> AI Auto-Deploy Studio</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/ai/assistant">Zero-Terminal Presets</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
          <Button size="sm" asChild><a href="/api/github/connect"><Github className="mr-2 h-4 w-4" /> Connect GitHub</a></Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-50/50"><CardContent className="flex items-center gap-2 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Github className="h-4 w-4" /> GitHub</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <div>App: <span className="font-medium">{github?.github?.appConfigured ? "configured" : "not configured"}</span></div>
            <div>OAuth: <span className="font-medium">{github?.github?.oauthConfigured ? "configured" : "not configured"}</span></div>
            <div>Webhook secret: <span className="font-medium">{github?.github?.webhookSecretConfigured ? "configured" : "not configured"}</span></div>
            <div>Connections: <span className="font-medium">{github?.connections?.length ?? 0}</span> · Deliveries: {github?.webhookDeliveries ?? 0}</div>
            <div className="pt-1 font-mono text-[10px]">POST {github?.github?.webhookPath ?? "/api/github/webhook"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> Queue</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <div>Pending: <span className="font-medium">{queue?.pending ?? "—"}</span> · Running: <span className="font-medium">{queue?.running ?? "—"}</span></div>
            <div>Inline worker: <span className="font-medium">{queue?.inlineWorker ? "on" : "off (use scripts/deploy-worker.ts)"}</span></div>
            <div>Active static ports: <span className="font-mono">{(queue?.activeStaticPorts ?? []).join(", ") || "none"}</span></div>
            <div className="truncate pt-1 font-mono text-[10px]" title={queue?.releaseBase}>{queue?.releaseBase ?? ""}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" /> Safety</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <div>HMAC-SHA256 signature + delivery-id dedup</div>
            <div>Allowlisted argv commands, no shell</div>
            <div>Exact commit SHA + HTTP release-marker verification</div>
            <div>Automatic rollback on failed verification</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Import a repository</CardTitle>
          <CardDescription>Reads manifests through the GitHub API, detects the framework, and creates an editable deployment config.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={importRepo} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="repo">Repository (owner/repo)</Label>
              <Input id="repo" placeholder="acme/my-app" value={importForm.repository}
                onChange={(e) => setImportForm((f) => ({ ...f, repository: e.target.value }))} />
            </div>
            <div className="w-48">
              <Label htmlFor="branch">Production branch</Label>
              <Input id="branch" placeholder="main" value={importForm.productionBranch}
                onChange={(e) => setImportForm((f) => ({ ...f, productionBranch: e.target.value }))} />
            </div>
            <Button type="submit" disabled={busy === "import"}><Rocket className="mr-2 h-4 w-4" /> {busy === "import" ? "Importing…" : "Import"}</Button>
            <Button type="button" variant="outline" onClick={() => void loadRepos()} disabled={busy === "repos"}>
              <Github className="mr-2 h-4 w-4" /> {busy === "repos" ? "Loading…" : "List repos"}
            </Button>
          </form>
          {repos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {repos.slice(0, 12).map((r) => (
                <button key={r.id} className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => setImportForm({ repository: r.fullName, productionBranch: r.defaultBranch })}>
                  {r.fullName} {r.private ? "🔒" : ""}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Projects ({projects.length})</h2>
        {projects.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No Git-connected projects yet. Connect GitHub and import a repository above.
          </CardContent></Card>
        )}
        {projects.map((project) => {
          const latest = project.latestDeployment;
          const isOpen = expanded === project.id;
          return (
            <Card key={project.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GitBranch className="h-4 w-4" /> {project.repository}
                      <Badge variant="outline">{project.productionBranch}</Badge>
                    </CardTitle>
                    <CardDescription className="space-y-1">
                      <div>framework: <span className="font-medium">{project.detection?.framework ?? "unknown"}</span> ·
                        runtime: <span className="font-medium">{project.detection?.runtime ?? "—"}</span> ·
                        port: <span className="font-mono">{project.port}</span> ·
                        domain: <span className="font-mono">{project.domain}</span></div>
                      <div className="font-mono text-xs">
                        {latest?.commitHash ? `${latest.commitHash.slice(0, 12)} — ${latest.commitMessage ?? "no message"} (${latest.commitAuthor ?? "unknown"})` : "no commits deployed yet"}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={latest?.status ?? project.lastDeployStatus} />
                        {latest?.stage && <span className="text-xs">stage: {latest.stage}</span>}
                        {latest?.verifiedCommitSha && <span className="text-xs text-emerald-700">verified: {latest.verifiedCommitSha.slice(0, 12)}</span>}
                        {latest?.failureStage && <span className="text-xs text-red-700">failed at {latest.failureStage}</span>}
                      </div>
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Switch id={`auto-${project.id}`} checked={Boolean(project.autoDeploy)}
                        onCheckedChange={() => void action(project.id, "auto", undefined, project)} />
                      <Label htmlFor={`auto-${project.id}`}>Auto deploy</Label>
                    </div>
                    <Button size="sm" variant="outline" disabled={!!busy}
                      onClick={() => void action(project.id, "deploy")}><Rocket className="mr-1 h-3 w-3" /> Deploy</Button>
                    <Button size="sm" variant="outline" disabled={!!busy}
                      onClick={() => void action(project.id, "rollback")}><RotateCcw className="mr-1 h-3 w-3" /> Rollback</Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggleDetails(project)}>
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <a className="flex items-center gap-1 text-blue-700 hover:underline" href={project.liveUrl} target="_blank" rel="noreferrer">
                    <Link2 className="h-3 w-3" /> {project.liveUrl} <ExternalLink className="h-3 w-3" />
                  </a>
                  <span>health: <span className="font-mono">{project.healthPath}</span></span>
                  <span>status: <span className="font-mono">{project.detectionStatus}</span></span>
                  {latest?.createdAt && <span>last run: {new Date(latest.createdAt).toLocaleString()}</span>}
                  {latest?.durationMs != null && <span>{latest.durationMs}ms</span>}
                </div>
                {project.requiresApproval && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-800">
                    <AlertTriangle className="h-4 w-4" /> Detection is ambiguous — review the config and confirm before any build command runs.
                    <Button size="sm" variant="outline" disabled={!!busy}
                      onClick={() => void action(project.id, "confirm")}><ShieldCheck className="mr-1 h-3 w-3" /> Approve config</Button>
                  </div>
                )}
              </CardContent>
              {isOpen && (
                <CardContent className="border-t pt-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="flex items-center gap-1 text-sm font-medium"><Settings2 className="h-4 w-4" /> Deployment config</h3>
                        <Button size="sm" disabled={!!busy} onClick={() => void action(project.id, "config")}>Save config</Button>
                      </div>
                      <Textarea className="min-h-[240px] font-mono text-xs" value={configDraft}
                        onChange={(e) => setConfigDraft(e.target.value)} spellCheck={false} />
                    </div>
                    <div>
                      <h3 className="mb-2 flex items-center gap-1 text-sm font-medium"><Terminal className="h-4 w-4" /> Latest deployment logs</h3>
                      <div className="max-h-[240px] overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
                        {logs?.logs?.length ? logs.logs.map((l: AnyRecord) => (
                          <div key={l.id} className={l.level === "ERROR" ? "text-red-300" : l.level === "WARN" ? "text-amber-300" : ""}>
                            <span className="text-slate-500">[{new Date(l.timestamp).toLocaleTimeString()}]</span> {l.level} {l.message}
                          </div>
                        )) : <div className="text-slate-400">No logs for this deployment yet.</div>}
                      </div>
                      {logs?.buildOutput && <p className="mt-2 break-all text-xs text-muted-foreground">Result: {logs.buildOutput}</p>}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
