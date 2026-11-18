/** Browser-safe read model for the administration API (no server imports). */
export interface WorkflowRecord {
  id: string; key: string; name: string; description: string | null; enabled: boolean;
  version: number; definition: string; trigger: string; eventName: string | null;
  intervalSeconds: number | null; nextRunAt: string | null; lastRunAt: string | null;
  scheduleInput: string; createdAt: string; _count: { runs: number };
}
export interface StepRecord {
  id: string; key: string; ordinal: number; label: string; handler: string;
  status: string; jobId: string | null; output: string | null; error: string | null;
  verified: boolean | null; attempts: number; startedAt: string | null; finishedAt: string | null;
}
export interface RunRecord {
  id: string; workflowId: string; workflowVersion: number; trigger: string; status: string;
  verified: boolean; error: string | null; input: string; output: string | null;
  actorEmail: string | null; resourceId: string | null; resourceType: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null;
  workflow: { key: string; name: string }; steps: StepRecord[];
}
export interface JobRecord {
  id: string; type: string; workerKind: string | null; status: string; riskLevel: string;
  progress: number; attempts: number; maxAttempts: number; lockKey: string | null;
  correlationId: string | null; requiresApproval: boolean; approvedBy: string | null;
  lastError: string | null; deadLetterReason: string | null; createdAt: string;
  startedAt: string | null; finishedAt: string | null; durationMs: number | null;
  actorEmail: string | null; verified: boolean | null; resultCode: string | null;
  hasEvidence: boolean; findingCount: number; criticalFindings: number; retrySafe: boolean;
}
export interface Finding { severity: "info" | "warning" | "critical"; title: string; detail?: string; remediation?: string }
export interface JobDetail extends JobRecord {
  error: string | null; input: unknown; cancellationRequestedAt: string | null; leaseExpiresAt: string | null;
  leasedBy: string | null; availableAt: string; timeoutMs: number | null;
  result: { ok: boolean; code: string; message: string; verified: boolean; data?: unknown; evidence?: string; findings?: Finding[]; warnings?: string[] } | null;
  events: Array<{ at: string; percent: number; message: string }>;
  automation: { runId: string; stepId: string } | null;
}
export interface ProfileVersion {
  id: string; version: number; config: unknown; checksum: string; status: string;
  changeNote: string | null; verificationJobId: string | null; verificationError: string | null;
  verifiedAt: string | null; createdAt: string;
}
export interface ProfileRecord {
  id: string; key: string; name: string; kind: string; framework: string | null;
  activeVersion: number | null; createdAt: string; versions: ProfileVersion[];
}
export interface AgentRecord {
  id: string; name: string; agentKey: string; status: string; version: string | null;
  capabilities: string[]; scopes: string[]; lastHeartbeat: string | null; online: boolean;
  server: { hostname: string; ip: string | null; status: string } | null;
}
export interface WorkerRecord { kind: string; label: string; description: string; execution: string; maxRisk: string; requiredScopes: string[] }
export interface QueueStats {
  byState: Record<string, number>; total: number; active: number; running: number; queued: number;
  completed: number; failed: number; waitingApproval: number; deadLetters: number;
  averageDurationMs: number | null; successRate: number | null;
  lastExecutionAt: string | null; nextExecutionAt: string | null; oldestQueuedDelayMs: number;
}
export interface AutomationSnapshot {
  workflows: WorkflowRecord[]; runs: RunRecord[]; selectedRun: RunRecord | null; jobs: JobRecord[];
  queue: QueueStats; profiles: ProfileRecord[]; agents: AgentRecord[]; workers: WorkerRecord[];
  profileKinds: string[]; jobStates: string[]; observedAt: string;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export function pretty(value: unknown): string { return JSON.stringify(value ?? null, null, 2); }
export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
export function statusClasses(status: string): string {
  if (["SUCCESS", "SUCCEEDED", "VERIFIED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["FAILED", "DEAD_LETTER", "ROLLED_BACK"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  if (["WAITING_APPROVAL", "WAITING_EXTERNAL", "RETRYING", "VERIFYING"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (["RUNNING", "QUEUED", "VALIDATING", "ROLLING_BACK"].includes(status)) return "border-orange-200 bg-orange-50 text-[#C43E0E]";
  return "border-slate-200 bg-slate-50 text-slate-600";
}
/** A completed job/run is not "verified" unless an independent observation said so. */
export function verificationLabel(verified: boolean | null | undefined, code?: string | null): string {
  if (code === "OK_UNVERIFIED") return "Unverified";
  return verified === true ? "Verified" : verified === false ? "Unverified" : "Not yet verified";
}
