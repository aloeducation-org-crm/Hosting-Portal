"use client";

/**
 * Unified Infrastructure — the single control-plane view of the hybrid
 * deployment: Hostinger Cloud (production), Office Server A (replica /
 * recovery), Office Server B (CI / staging / backup copy) and offsite backup.
 *
 * Honesty rule enforced by this component: a number is rendered only when the
 * backend says it was measured. Anything else is labelled
 * "not measured" / "no agent" / "unavailable" — never a fabricated zero and
 * never a simulated green tick.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  PlayCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  Workflow,
  XCircle,
} from "lucide-react";

type DataState = "live" | "stale" | "unavailable" | "revoked";

interface AgentView {
  id: string;
  name: string;
  agentKey: string;
  serverId: string | null;
  status: string;
  version: string | null;
  capabilities: string[];
  scopes: string[];
  online: boolean;
  dataState: DataState;
  lastHeartbeat: string | null;
  heartbeatAgeMs: number | null;
  lastSeenIp: string | null;
  enrolledAt: string | null;
}

interface NodeView {
  id: string;
  name: string | null;
  hostname: string;
  ip: string | null;
  region: string;
  role: string;
  status: string;
  cpuCores: number | null;
  ramGb: number | null;
  diskGb: number | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  uptime: number | null;
  agent: AgentView | null;
  dataState: DataState;
  replication: ReplicationView | null;
}

interface ReplicationView {
  host: string;
  engine: string;
  version: string | null;
  role: string;
  binlogEnabled: boolean | null;
  gtidMode: string | null;
  lagSeconds: number | null;
  healthy: boolean | null;
  lastCheckedAt: string | null;
  notes?: string | null;
}

interface JobView {
  id: string;
  type: string;
  workerKind: string | null;
  status: string;
  riskLevel: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  lockKey: string | null;
  correlationId: string | null;
  requiresApproval: boolean;
  approvedBy: string | null;
  lastError: string | null;
  deadLetterReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  actorEmail: string | null;
}

interface TaskApprovalView {
  id: string;
  command: string;
  agentName: string;
  args: string;
  timeoutMs: number;
  createdAt: string;
}

interface Topology {
  generatedAt: string;
  pendingApprovals: TaskApprovalView[];
  nodes: NodeView[];
  agents: AgentView[];
  unregisteredAudits: ReplicationView[];
  replication: ReplicationView[];
  queue: {
    byState: Record<string, number>;
    active: number;
    waitingApproval: number;
    deadLetters: number;
    oldestQueuedAt: string | null;
    oldestQueuedDelayMs: number;
    tasks: Record<string, number>;
  };
  allowlist: Array<{ command: string; label: string; description: string; risk: string; timeoutMs: number; requiresSudo: boolean; scopes: string[] }>;
  workloads: {
    websites: number;
    recentDeployments: Array<{ id: string; status: string; stage: string | null; createdAt: string; commitHash: string | null; verifiedCommitSha: string | null }>;
    deploymentsSucceeded: number;
    deploymentsFailed: number;
  };
  backups: {
    recent: Array<{ id: string; filename: string; filepath: string; status: string; backupType: string; checksum: string | null; fileSize: number | null; createdAt: string }>;
    verifiedCount: number;
    verified: boolean;
    restoreDrills: Array<{ id: string; status: string; createdAt: string }>;
    restoreDrillEverRun: boolean;
  };
  dataState: DataState;
}

/** Planned roles. These are *intent*; the observed state decides the badge. */
const PLANNED_NODES = [
  {
    key: "production",
    title: "Hostinger Cloud",
    subtitle: "4 GB RAM · 100 GB NVMe",
    plannedRole: "Public application + primary database",
    icon: Cloud,
    expectation: "Node.js/PM2 panel, Nginx/HTTPS, primary MySQL/MariaDB",
  },
  {
    key: "office-a",
    title: "Office Server A",
    subtitle: "16 GB RAM · Core i5 · UPS",
    plannedRole: "Database replica + recovery application",
    icon: Server,
    expectation: "Read-only replica, warm recovery instance, internal tools",
  },
  {
    key: "office-b",
    title: "Office Server B",
    subtitle: "8 GB RAM · SSD · UPS",
    plannedRole: "CI/build worker + staging + backup copy",
    icon: Workflow,
    expectation: "Self-hosted runner, staging deploy, monitoring, local backup copy",
  },
  {
    key: "offsite",
    title: "Offsite backup storage",
    subtitle: "independent credentials",
    plannedRole: "Encrypted backups + restore drills",
    icon: HardDrive,
    expectation: "Daily encrypted copies, retention, verified restore",
  },
];

export function UnifiedInfrastructure() {
  const [data, setData] = useState<Topology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // `loading` starts true and every setState here happens after the first
    // await, so the mount effect never calls setState synchronously
    // (react-hooks/set-state-in-effect).
    try {
      const res = await fetch("/api/infrastructure/topology", { credentials: "include" });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message ?? `HTTP ${res.status}`);
      setError(null);
      setData(body.data as Topology);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the effect body itself performs no synchronous state update:
    // `load` only touches state after its first await.
    void Promise.resolve().then(load);
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const nodes = data?.nodes ?? [];
  const agents = data?.agents ?? [];

  const matchNode = useMemo(() => {
    return (key: string): NodeView | null => {
      const lower = key.replace("-", "");
      return (
        nodes.find((n) => {
          const hay = `${n.name ?? ""} ${n.hostname}`.toLowerCase().replace(/[-_\s]/g, "");
          return hay.includes(lower) || (key === "production" && /hostinger|cloud|vps|prod/i.test(hay));
        }) ?? null
      );
    };
  }, [nodes]);

  async function runJob(kind: string, input: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/orchestrator/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, input }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body?.message ?? `Could not queue ${label}`);
        return;
      }
      const jobId = body.data?.jobId as string;
      toast.success(body.data?.duplicate ? `${label}: an identical job already exists` : `${label} queued`, { description: jobId });
      await pollJob(jobId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function pollJob(jobId: string, attempts = 40) {
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/orchestrator/jobs/${jobId}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok || !body.success) return;
      const job = body.data;
      if (["SUCCESS", "FAILED", "CANCELLED", "DEAD_LETTER", "ROLLED_BACK"].includes(job.status)) {
        if (job.status === "SUCCESS") toast.success(`Job finished: ${job.result?.message ?? job.status}`);
        else toast.error(`Job ${job.status}: ${job.error ?? job.lastError ?? "see the operations queue"}`);
        await load();
        return;
      }
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading infrastructure state…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Unified Infrastructure</h1>
          <p className="text-sm text-muted-foreground">
            Hostinger Cloud production, two office servers, offsite backup — one control plane.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataStateBadge state={data?.dataState ?? "unavailable"} label={data ? undefined : "not loaded"} />
          {data?.generatedAt && (
            <span className="text-xs text-muted-foreground">updated {new Date(data.generatedAt).toLocaleTimeString()}</span>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6">
            <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium">The topology API could not be reached</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Agents online"
          value={`${agents.filter((a) => a.online).length}/${agents.length}`}
          hint={agents.length === 0 ? "No agent has been enrolled yet" : `${agents.filter((a) => a.dataState === "stale").length} stale`}
          icon={Activity}
          tone={agents.length === 0 ? "unknown" : agents.some((a) => a.online) ? "good" : "warn"}
        />
        <SummaryCard
          title="Queue"
          value={String(data?.queue.active ?? 0)}
          hint={`${data?.queue.waitingApproval ?? 0} awaiting approval · ${data?.queue.deadLetters ?? 0} dead-lettered`}
          icon={Workflow}
          tone={(data?.queue.deadLetters ?? 0) > 0 ? "warn" : "good"}
        />
        <SummaryCard
          title="Backups verified"
          value={data?.backups.verified ? String(data.backups.verifiedCount) : "0"}
          hint={data?.backups.verified ? "checksum confirmed" : "no integrity-verified backup recorded"}
          icon={HardDrive}
          tone={data?.backups.verified ? "good" : "warn"}
        />
        <SummaryCard
          title="Recent deployments"
          value={`${data?.workloads.deploymentsSucceeded ?? 0}/${(data?.workloads.recentDeployments ?? []).length}`}
          hint={`${data?.workloads.deploymentsFailed ?? 0} failed · ${data?.workloads.websites ?? 0} sites`}
          icon={PlayCircle}
          tone={(data?.workloads.deploymentsFailed ?? 0) > 0 ? "warn" : "good"}
        />
      </div>

      <Tabs defaultValue="topology" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="agents">Servers &amp; agents</TabsTrigger>
          <TabsTrigger value="operations">Operations queue</TabsTrigger>
          <TabsTrigger value="database">Database &amp; replication</TabsTrigger>
          <TabsTrigger value="recovery">Backups &amp; recovery</TabsTrigger>
        </TabsList>

        <TabsContent value="topology" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {PLANNED_NODES.map((planned) => {
              const node = matchNode(planned.key);
              const agent = node?.agent ?? agents.find((a) => a.serverId === node?.id) ?? null;
              const Icon = planned.icon;
              return (
                <Card key={planned.key}>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-1 h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-base">{planned.title}</CardTitle>
                        <CardDescription>{planned.subtitle}</CardDescription>
                      </div>
                    </div>
                    <DataStateBadge state={node?.dataState ?? "unavailable"} />
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <Row label="Planned role" value={planned.plannedRole} />
                    <Row label="Registered as" value={node ? `${node.name ?? node.hostname} (${node.role})` : "not registered in the panel"} />
                    <Row label="Expected workload" value={planned.expectation} muted />
                    {node ? (
                      <>
                        <MeterRow label="CPU" percent={node.cpuUsage} measured={Boolean(agent?.online)} />
                        <MeterRow label="Memory" percent={node.memoryUsage} measured={Boolean(agent?.online)} />
                        <MeterRow label="Disk" percent={node.diskUsage} measured={Boolean(agent?.online)} />
                        <Row
                          label="Hardware"
                          value={
                            node.ramGb || node.cpuCores
                              ? `${node.cpuCores ?? "?"} vCPU · ${node.ramGb ?? "?"} GB RAM · ${node.diskGb ?? "?"} GB disk`
                              : "not reported"
                          }
                        />
                      </>
                    ) : (
                      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        No agent has reported from this host, so CPU, memory and disk are <strong>not measured</strong>. Enrol an agent
                        below to replace this panel with real numbers.
                      </p>
                    )}
                    {agent && (
                      <Row
                        label="Agent"
                        value={`${agent.name} · ${agent.version ?? "version unknown"} · heartbeat ${
                          agent.heartbeatAgeMs === null ? "never" : `${Math.round(agent.heartbeatAgeMs / 1000)}s ago`
                        }`}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Placement decisions</CardTitle>
              <CardDescription>
                What runs where, and the risk attached to each decision. Derived from the observed audit, not from an assumption.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Decision
                title="Production stays on Hostinger Cloud"
                body="The panel and the primary database already run there under PM2, and it is the only host whose connectivity does not depend on the office 10–50 Mbps uplink. Keeping the public path off that link is what makes the office servers safe to use for anything else."
              />
              <Decision
                title="Office A is a recovery asset, not a public failover"
                body="A replica behind office power and office internet cannot serve the public when that link drops. It is sized for a warm recovery instance and for holding a replica — promoted manually, with approval, after lag is checked."
                warn
              />
              <Decision
                title="Office B never touches production data"
                body="Builds are CPU- and RAM-hungry. Running them on the 4 GB production host competes with live traffic, so they belong on Office B with scoped runner credentials and no production database access."
              />
              <Decision
                title="A replica is not a backup"
                body="A dropped table or a bad migration reaches a replica in milliseconds. Only an offsite encrypted copy with a recorded restore drill protects against that, which is why the offsite target is a separate node in this topology."
                warn
              />
              <Decision
                title="Manual failover first"
                body="With a few hours of acceptable downtime, a tested manual promotion beats an untested automatic one. Automatic failover can split writes across two primaries; it is only worth enabling after a promotion drill has been recorded."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          <EnrollAgentCard onDone={() => void load()} busy={busy} setBusy={setBusy} servers={nodes} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enrolled agents</CardTitle>
              <CardDescription>
                Connectivity, last heartbeat, version, granted capabilities and the most recent task results.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {agents.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="No agent has been enrolled"
                  body="Create an enrollment token above, then run the agent on the host. Until then every metric on this page is unavailable — it is not zero."
                />
              ) : (
                agents.map((agent) => (
                  <div key={agent.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{agent.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {agent.agentKey}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <DataStateBadge state={agent.dataState} />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || !agent.online}
                          onClick={() => void runAgentTask(agent.id, "metrics.collect", {}, "Collect metrics", setBusy, load)}
                        >
                          {busy === agent.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                          Collect metrics
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || agent.status === "revoked"}
                          onClick={() => void revokeAgent(agent.id, setBusy, load)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                      <span>Version: {agent.version ?? "unknown"}</span>
                      <span>
                        Heartbeat:{" "}
                        {agent.heartbeatAgeMs === null ? "never" : `${Math.round(agent.heartbeatAgeMs / 1000)}s ago`}
                      </span>
                      <span>Last seen IP: {agent.lastSeenIp ?? "unknown"}</span>
                      <span>Enrolled: {agent.enrolledAt ? new Date(agent.enrolledAt).toLocaleString() : "—"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {agent.capabilities.length === 0 ? (
                        <Badge variant="secondary">no capabilities granted</Badge>
                      ) : (
                        agent.capabilities.map((c) => (
                          <Badge key={c} variant="secondary" className="font-mono text-[10px]">
                            {c}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Command allowlist</CardTitle>
              <CardDescription>
                The only commands an agent can ever run. Anything else is refused on both the panel and the host, and the refusal is
                audited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">Command</th>
                      <th className="py-2 pr-4">Risk</th>
                      <th className="py-2 pr-4">sudo</th>
                      <th className="py-2 pr-4">Timeout</th>
                      <th className="py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.allowlist ?? []).map((entry) => (
                      <tr key={entry.command} className="border-t">
                        <td className="py-2 pr-4 font-mono text-xs">{entry.command}</td>
                        <td className="py-2 pr-4">
                          <RiskBadge risk={entry.risk} />
                        </td>
                        <td className="py-2 pr-4">{entry.requiresSudo ? "yes" : "no"}</td>
                        <td className="py-2 pr-4">{Math.round(entry.timeoutMs / 1000)}s</td>
                        <td className="py-2 text-xs text-muted-foreground">{entry.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="space-y-4">
          <OperationsPanel data={data} onRefresh={() => void load()} runJob={runJob} busy={busy} />
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <DatabasePanel data={data} runJob={runJob} busy={busy} />
        </TabsContent>

        <TabsContent value="recovery" className="space-y-4">
          <RecoveryPanel data={data} runJob={runJob} busy={busy} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-panels ─────────────────────────────────────────────────────────────

function OperationsPanel({
  data,
  onRefresh,
  runJob,
  busy,
}: {
  data: Topology | null;
  onRefresh: () => void;
  runJob: (kind: string, input: Record<string, unknown>, label: string) => Promise<void>;
  busy: string | null;
}) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobView | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const loadJobs = useCallback(async () => {
    // `loading` starts true; see the note on `load` above.
    try {
      const res = await fetch("/api/orchestrator/jobs?limit=60", { credentials: "include" });
      const body = await res.json();
      if (body.success) setJobs(body.data.jobs as JobView[]);
    } finally {
      setLoading(false);
      onRefresh();
    }
  }, [onRefresh]);

  useEffect(() => {
    void loadJobs();
    const t = setInterval(() => void loadJobs(), 15_000);
    return () => clearInterval(t);
  }, [loadJobs]);

  async function openJob(job: JobView) {
    setSelected(job);
    setDetail(null);
    const res = await fetch(`/api/orchestrator/jobs/${job.id}`, { credentials: "include" });
    const body = await res.json();
    if (body.success) setDetail(body.data);
  }

  async function decide(job: JobView, decision: "approve" | "reject") {
    const res = await fetch(`/api/orchestrator/jobs/${job.id}/approve`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note: decision === "reject" ? "Rejected from the dashboard" : undefined }),
    });
    const body = await res.json();
    if (res.ok && body.success) toast.success(`Job ${decision === "approve" ? "approved" : "rejected"}`);
    else toast.error(body?.message ?? "Could not record the decision");
    await loadJobs();
  }

  /**
   * Approve or refuse a PRIVILEGED / DESTRUCTIVE agent task. Until this is
   * recorded the agent's poll will never receive the task, so nothing runs on a
   * managed host without a named human decision.
   */
  async function decideTask(task: TaskApprovalView, decision: "approve" | "reject") {
    const res = await fetch(`/api/agents/tasks/${task.id}/approve`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note: decision === "reject" ? "Rejected from the dashboard" : undefined }),
    });
    const body = await res.json();
    if (res.ok && body.success) toast.success(`Task ${decision === "approve" ? "approved" : "rejected"}`);
    else toast.error(body?.message ?? "Could not record the decision");
    await loadJobs();
  }

  async function cancel(job: JobView) {
    const res = await fetch(`/api/orchestrator/jobs/${job.id}/cancel`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Cancelled from the dashboard" }),
    });
    const body = await res.json();
    if (res.ok && body.success) toast.success("Job cancelled");
    else toast.error(body?.message ?? "Could not cancel");
    await loadJobs();
  }

  async function requeue(job: JobView) {
    const res = await fetch(`/api/orchestrator/jobs/${job.id}/requeue`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Requeued from the dashboard after review" }),
    });
    const body = await res.json();
    if (res.ok && body.success) toast.success("Job requeued");
    else toast.error(body?.message ?? "Only dead-lettered jobs can be requeued");
    await loadJobs();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Durable job queue</CardTitle>
            <CardDescription>
              Persistent rows with leases, per-project serialization, retries with backoff, approval gates and dead-lettering. A
              panel restart cannot lose or double-run this work.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadJobs()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {Object.entries(data?.queue.byState ?? {}).map(([state, count]) => (
              <Badge key={state} variant="outline">
                {state}: {count}
              </Badge>
            ))}
            {Object.keys(data?.queue.byState ?? {}).length === 0 && (
              <span className="text-sm text-muted-foreground">No jobs recorded yet.</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runJob("BACKUP_RESTORE", { action: "snapshot-record" }, "Backup record")}>
              Record backup snapshot
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runJob("DATABASE_OPS", { action: "audit" }, "DB audit")}>
              <Database className="mr-2 h-4 w-4" /> Database audit
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runJob("DATABASE_OPS", { action: "plan-migration" }, "Migration plan")}>
              Migration plan
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Worker</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Risk</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <button className="text-left font-mono text-xs hover:underline" onClick={() => void openJob(job)}>
                        {job.workerKind ?? job.type}
                      </button>
                      <div className="text-[11px] text-muted-foreground">{job.id.slice(0, 8)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <JobStateBadge status={job.status} />
                      <Progress value={job.progress} className="mt-1 h-1 w-24" />
                    </td>
                    <td className="py-2 pr-3">
                      <RiskBadge risk={job.riskLevel ?? "READ_ONLY"} />
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {job.attempts}/{job.maxAttempts}
                      {job.deadLetterReason && <div className="max-w-[180px] text-[11px] text-destructive">{job.deadLetterReason}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {job.status === "WAITING_APPROVAL" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void decide(job, "approve")}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void decide(job, "reject")}>
                              Reject
                            </Button>
                          </>
                        )}
                        {job.status === "DEAD_LETTER" && (
                          <Button size="sm" variant="outline" onClick={() => void requeue(job)}>
                            Requeue
                          </Button>
                        )}
                        {!["SUCCESS", "FAILED", "CANCELLED", "DEAD_LETTER", "ROLLED_BACK"].includes(job.status) && (
                          <Button size="sm" variant="ghost" onClick={() => void cancel(job)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      No jobs yet. Queue one above, or connect a repository in Deployments.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent tasks waiting for a human</CardTitle>
          <CardDescription>
            Commands the allowlist marks PRIVILEGED or DESTRUCTIVE (for example <code className="text-xs">service.restart</code> or{" "}
            <code className="text-xs">backup.database</code>) are dispatched but never handed to a host until an administrator
            approves them here. The decision is written to the audit log with your identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.pendingApprovals && data.pendingApprovals.length > 0 ? (
            <ul className="space-y-2">
              {data.pendingApprovals.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{task.command}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {task.agentName} · queued {new Date(task.createdAt).toLocaleString()} · timeout {Math.round(task.timeoutMs / 1000)}s
                    </div>
                    <pre className="mt-1 max-w-full overflow-x-auto text-[11px] text-muted-foreground">{task.args}</pre>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decideTask(task, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decideTask(task, "reject")}>
                      Refuse
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing is waiting. Gated tasks appear here the moment they are dispatched, and stay unclaimable until a decision is
              recorded.
            </p>
          )}
        </CardContent>
      </Card>

      {selected && detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Job {String(detail.id).slice(0, 8)} — {String(detail.workerKind ?? detail.type)}
            </CardTitle>
            <CardDescription>
              Correlation {String(detail.correlationId ?? "—")} · lock {String(detail.lockKey ?? "none")} · lease{" "}
              {detail.leaseExpiresAt ? new Date(String(detail.leaseExpiresAt)).toLocaleTimeString() : "none"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <JobStateBadge status={String(detail.status)} />
            {Array.isArray(detail.events) && (
              <ol className="space-y-1 rounded-md border bg-muted/30 p-3 font-mono text-xs">
                {(detail.events as Array<{ at: string; percent: number; message: string }>).map((e, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span> [{e.percent}%] {e.message}
                  </li>
                ))}
              </ol>
            )}
            {detail.result ? (
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                {JSON.stringify(detail.result, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">No result recorded yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function DatabasePanel({
  data,
  runJob,
  busy,
}: {
  data: Topology | null;
  runJob: (kind: string, input: Record<string, unknown>, label: string) => Promise<void>;
  busy: string | null;
}) {
  const rows = data?.replication ?? [];
  const unregistered = data?.unregisteredAudits ?? [];
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Observed database state</CardTitle>
            <CardDescription>
              Recorded by <code className="text-xs">scripts/audit-database.mjs --write</code> on each host. Nothing here is inferred:
              an engine or a version appears only after it was read from the server.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runJob("DATABASE_OPS", { action: "audit" }, "DB audit")}>
            Refresh from records
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 && unregistered.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No database audit has been recorded"
              body="Run `node scripts/audit-database.mjs --write --host hostinger-cloud` on the production host and `--host office-a` on the replica candidate. Until then the engine, version and binary-log state are unknown — and the platform will not assume MySQL, MariaDB, PostgreSQL or SQLite are interchangeable."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Host</th>
                    <th className="py-2 pr-3">Engine</th>
                    <th className="py-2 pr-3">Version</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">log_bin</th>
                    <th className="py-2 pr-3">GTID</th>
                    <th className="py-2 pr-3">Lag</th>
                    <th className="py-2">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows, ...unregistered].map((r) => (
                    <tr key={r.host} className="border-t">
                      <td className="py-2 pr-3 font-medium">{r.host}</td>
                      <td className="py-2 pr-3">{r.engine}</td>
                      <td className="py-2 pr-3 text-xs">{r.version ?? "not observed"}</td>
                      <td className="py-2 pr-3">{r.role}</td>
                      <td className="py-2 pr-3">
                        {r.binlogEnabled === null ? (
                          <Badge variant="secondary">unknown</Badge>
                        ) : r.binlogEnabled ? (
                          <Badge className="bg-emerald-600">ON</Badge>
                        ) : (
                          <Badge className="bg-destructive">OFF</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.gtidMode ?? "unknown"}</td>
                      <td className="py-2 pr-3 text-xs">{r.lagSeconds === null ? "n/a" : `${r.lagSeconds}s`}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {r.lastCheckedAt ? new Date(r.lastCheckedAt).toLocaleString() : "never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Replication rules this platform enforces</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <Rule ok text="Primary and replica must be the same family. MySQL and MariaDB GTID implementations are not interchangeable." />
          <Rule ok text="log_bin=ON is a hard prerequisite. If the hosting plan cannot enable it, the recovery strategy is verified backups, not a replica." />
          <Rule ok text="Asynchronous replication first, with lag monitoring and a manual promotion procedure. Automatic failover only after a drill has been recorded." />
          <Rule warn text="The panel database is Prisma/SQLite (libSQL). It has no streaming replication — it recovers by restoring a file. Do not point it at a MySQL/MariaDB URL." />
          <Rule warn text="Replication never replaces an offsite backup: a dropped table propagates to the replica instantly." />
        </CardContent>
      </Card>
    </>
  );
}

function RecoveryPanel({
  data,
  runJob,
  busy,
}: {
  data: Topology | null;
  runJob: (kind: string, input: Record<string, unknown>, label: string) => Promise<void>;
  busy: string | null;
}) {
  const backups = data?.backups;
  const newestBackup = backups?.recent[0] ?? null;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backups</CardTitle>
          <CardDescription>
            A backup is shown as verified only when a checksum comparison has actually passed. A completed job notification on its
            own is not evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {backups?.recent.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">File</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Checksum</th>
                    <th className="py-2 pr-3">Size</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.recent.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="py-2 pr-3 font-mono text-xs">{b.filename}</td>
                      <td className="py-2 pr-3 text-xs">{b.backupType}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={b.status === "COMPLETED" ? "default" : "destructive"}>{b.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px]">{b.checksum ? `${b.checksum.slice(0, 16)}…` : "not computed"}</td>
                      <td className="py-2 pr-3 text-xs">{b.fileSize ? `${(b.fileSize / 1024 / 1024).toFixed(1)} MB` : "unknown"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={HardDrive} title="No backup has been recorded" body="Run `sudo bash scripts/backup.sh /opt/backups` on the production host, then queue a verification job below." />
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runJob("BACKUP_RESTORE", { action: "snapshot-record" }, "Snapshot record")}>
              Record snapshot
            </Button>
            {newestBackup && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void runJob("BACKUP_RESTORE", { action: "verify", backupId: newestBackup.id }, "Verify integrity")}
              >
                <ShieldCheck className="mr-2 h-4 w-4" /> Verify newest integrity
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Restore drills</CardTitle>
          <CardDescription>
            {backups?.restoreDrillEverRun
              ? `${backups.restoreDrills.length} drill(s) recorded.`
              : "No restore drill has ever been recorded, so the recovery time is unknown."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {backups?.restoreDrills.length ? (
            backups.restoreDrills.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                <span className="font-mono">{d.id.slice(0, 8)}</span>
                <Badge variant={d.status === "COMPLETED" ? "default" : "secondary"}>{d.status}</Badge>
                <span className="text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
              </div>
            ))
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title="Untested recovery"
              body="A backup that has never been restored is a hypothesis. Follow docs/HYBRID-INFRASTRUCTURE-PLAN.md §Restore drill, then queue a BACKUP_RESTORE job so the result is recorded here."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failure playbook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <Rule ok text="Node/PM2 crash → PM2 restarts the process; the alert records it. No data loss expected." />
          <Rule ok text="Failed deployment → the engine leaves the previous release live and records the failing stage. Roll back from Deployments." />
          <Rule warn text="Hostinger host down → promote Office A only after checking the last binary-log position and replica lag, with an approval recorded." />
          <Rule warn text="Office internet down → production is unaffected because the public path never traverses the office link. The replica simply falls behind." />
          <Rule warn text="Database corruption → restore from the verified offsite backup, not from the replica, which already holds the same bad data." />
          <Rule text="After promoting Office A, do not re-join the old primary as a writer without rebuilding it as a replica — two writers means conflicting data." />
        </CardContent>
      </Card>
    </>
  );
}

function EnrollAgentCard({
  onDone,
  busy,
  setBusy,
  servers,
}: {
  onDone: () => void;
  busy: string | null;
  setBusy: (v: string | null) => void;
  servers: NodeView[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState("");
  const [scopes, setScopes] = useState<string[]>(["server:read", "monitoring:read"]);
  const [issued, setIssued] = useState<{ token: string; prefix: string; agentName: string } | null>(null);

  const ALL_SCOPES = ["server:read", "server:execute", "monitoring:read", "database:read", "backup:read", "backup:write", "backup:restore", "recovery:execute"];

  async function create() {
    setBusy("enroll");
    try {
      const res = await fetch("/api/agents/enrollment-tokens", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentName: name, serverId: serverId || undefined, scopes }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body?.message ?? "Could not create the token");
        return;
      }
      setIssued(body.data);
      toast.success("Enrollment token created — copy it now");
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Enrol a server agent</CardTitle>
          <CardDescription>
            Mints a single-use token that expires in 15 minutes. Read-only scopes are granted by default; privileged capabilities must
            be added deliberately.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <KeyRound className="mr-2 h-4 w-4" /> {open ? "Close" : "New token"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {issued ? (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                <p className="text-sm font-medium">Token for {issued.agentName}</p>
                <code className="mt-1 block break-all font-mono text-xs">{issued.token}</code>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shown once. Only its hash is stored. Run this on the host:
                </p>
                <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
{`ALO_PANEL_URL=https://your-panel-domain \\
ALO_ENROLL_TOKEN=${issued.token} \\
  node agent/alo-agent.mjs --name "${issued.agentName}" --enroll`}
                </pre>
              </div>
              <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
                Create another
              </Button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="office-a" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-server">Server record (optional)</Label>
                  <select
                    id="agent-server"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                  >
                    <option value="">— unassigned —</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ?? s.hostname}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Scopes</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)))}
                      />
                      <span className="font-mono">{scope}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Scopes limit what the panel will dispatch. The host still refuses anything outside its compiled-in allowlist.
                </p>
              </div>
              <Button onClick={() => void create()} disabled={!name.trim() || busy === "enroll"}>
                {busy === "enroll" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create token
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

async function runAgentTask(
  agentId: string,
  command: string,
  taskArgs: Record<string, unknown>,
  label: string,
  setBusy: (v: string | null) => void,
  reload: () => Promise<void>,
) {
  setBusy(agentId);
  try {
    const res = await fetch("/api/agents", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, command, args: taskArgs }),
    });
    const body = await res.json();
    if (res.ok && body.success) toast.success(`${label} queued`, { description: body.data?.requiresApproval ? "Waiting for approval" : body.message });
    else toast.error(body?.message ?? `Could not queue ${label}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(null);
    await reload();
  }
}

async function revokeAgent(agentId: string, setBusy: (v: string | null) => void, reload: () => Promise<void>) {
  setBusy(agentId);
  try {
    const res = await fetch(`/api/agents/${agentId}/revoke`, { method: "POST", credentials: "include" });
    const body = await res.json();
    if (res.ok && body.success) toast.success("Agent revoked");
    else toast.error(body?.message ?? "Could not revoke the agent");
  } finally {
    setBusy(null);
    await reload();
  }
}

function DataStateBadge({ state, label }: { state: DataState; label?: string }) {
  const map: Record<DataState, { text: string; className: string; icon: React.ElementType }> = {
    live: { text: label ?? "live data", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
    stale: { text: label ?? "stale data", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: AlertTriangle },
    unavailable: { text: label ?? "not measured", className: "border-muted bg-muted/40 text-muted-foreground", icon: XCircle },
    revoked: { text: label ?? "revoked", className: "border-destructive/40 bg-destructive/10 text-destructive", icon: XCircle },
  };
  const item = map[state] ?? map.unavailable;
  const Icon = item.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${item.className}`}>
      <Icon className="h-3 w-3" /> {item.text}
    </span>
  );
}

function JobStateBadge({ status }: { status: string }) {
  const tone =
    status === "SUCCESS"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "FAILED" || status === "DEAD_LETTER"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : status === "WAITING_APPROVAL"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-muted bg-muted/40 text-muted-foreground";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status}</span>;
}

function RiskBadge({ risk }: { risk: string }) {
  const tone =
    risk === "DESTRUCTIVE"
      ? "bg-destructive text-destructive-foreground"
      : risk === "PRIVILEGED"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-muted bg-muted/40 text-muted-foreground";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{risk}</span>;
}

function SummaryCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: "good" | "warn" | "unknown";
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-6">
        <Icon className={`mt-0.5 h-5 w-5 ${tone === "warn" ? "text-amber-500" : tone === "good" ? "text-emerald-500" : "text-muted-foreground"}`} />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${muted ? "text-xs text-muted-foreground" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function MeterRow({ label, percent, measured }: { label: string; percent: number; measured: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={measured ? "font-medium" : "text-muted-foreground"}>
          {measured ? `${Math.round(percent)}%` : "not measured"}
        </span>
      </div>
      <Progress value={measured ? Math.min(100, Math.max(0, percent)) : 0} className="h-1.5" />
    </div>
  );
}

function Decision({ title, body, warn }: { title: string; body: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${warn ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <p className="flex items-center gap-2 font-medium">
        {warn ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function Rule({ text, ok, warn }: { text: string; ok?: boolean; warn?: boolean }) {
  return (
    <p className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : warn ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      ) : (
        <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span>{text}</span>
    </p>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
      <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
