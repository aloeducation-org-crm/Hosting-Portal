# AI Automation Coverage — Reference Repo Gap Analysis

This document records what the Hosting-Portal's AI automation surface already
provides, and which specific gaps were closed by the
`feat/ai-workflow-assertions-trace-resume` branch. It exists so the next person
who reads the four "agency" reference repos does not re-do work that is already
shipped.

The four reference repos inspected (read-only, untrusted, in `_refs/`):

| Repo | License | What it actually is |
| --- | --- | --- |
| `jnMetaCode/agency-orchestrator` | Apache-2.0 | A real TypeScript DAG workflow engine with multi-agent roles, 20+ LLM connectors, two-tier verification, HITL approval, resumable runs, file-based job store. The only one of the four with runnable engine code. |
| `Anas-Khan93/ai-agency-agents` | MIT | 55+ Markdown persona prompt files for Claude Code. No code, no runtime. |
| `msitarzewski/agency-agents` | MIT | 250+ Markdown personas + a Bash toolchain that renders them into 17 AI coding tools. No engine. |
| `jnMetaCode/agency-agents-zh` | MIT | Chinese fork of the above + 67 China-original agents + a NEXUS pipeline framework (still prompts, not code). |

Three of the four are persona/prompt libraries. Their value to this project is
the **patterns** they describe (topology, HITL gating, fault-mode engineering,
incident runbooks), not their text. No code or prompt text was copied.

## What the project already had before this branch

The Hosting-Portal is **not** a bare hosting panel with AI bolted on. It is an
AI automation platform that also provisions hosting. The existing surface
(confirmed by reading the code, not just grepping routes):

**DAG workflow engine** (`src/lib/ai/automation/engine.ts`). Validates the
graph as a DAG (Kahn cycle detection) before any step runs, executes nodes in
topological order, supports conditional edges (`when: "always" | "true" |
"false"`), enforces a per-run AI call budget (default 12) and a per-step
timeout (default 120s), supports `dryRun` and `continueOnError`, and guarantees
that a failed run never looks like it produced output. Node types: `trigger`,
`ai.complete`, `ai.extract`, nine read-only `hosting.*` tools,
`logic.condition`, `transform.template`, `output`.

**Tool registry** (`src/lib/ai/automation/tools.ts`). Nine tenant-isolated,
read-only hosting tools (listSites, siteHealth, sslExpiring, listDeployments,
automationOverview, billingOverview, marketingOverview, externalToolCatalog,
cloudProjects). Non-admin runs are scoped to `website.ownerId === actor.userId`;
a missing actor identity fails closed rather than querying across tenants.

**Agent task system with HITL** (`src/app/api/agents/tasks/`). AgentTask has
`requiresApproval`, `approvedBy`, `approvedAt`, and a bounded approval window —
an approval is only valid for a limited time because it was about the host
state at that moment. Tasks are claimed, started, and result-reported through
dedicated routes; `AgentTaskStatus` is a full state machine (PENDING →
ASSIGNED → RUNNING → SUCCEEDED/FAILED/REFUSED/TIMED_OUT/CANCELLED).

**LLM provider abstraction** (`src/lib/ai/client.ts`, `src/lib/ai/providers.ts`).
Multi-provider with fallback, surfaced through a single `completeWithAI` entry
point. `AIProviderError` carries the attempt chain so a caller can see which
providers were tried.

**Capability requests** (`src/lib/ai/capability-requests.ts`). Scoped,
least-privilege agent permissions — an agent cannot take an action it has not
been granted a capability for, even if it has an enrollment token.

**Self-hosted agents** (`src/lib/ai/self-hosted-agents.ts`). The runner
pattern from agency-orchestrator, already present.

**REA reasoning loop** (`src/lib/ai/rea/`). Analysis-session +
reconstruction-ledger + stdio-client — a structured reasoning/analysis loop
beyond the simple workflow engine.

**Orchestrator layer** (`src/lib/orchestrator/`). A separate orchestration
system with its own engine, scheduler, contracts, platform-workers and
profiles — for long-running platform-level jobs, distinct from the workflow
engine.

**Automation profiles + templates** (`src/lib/ai/automation/template.ts`,
`templates.ts`). Versioned, named workflow templates that ship with the panel.

## Gaps closed by this branch

Three engine-level patterns from the reference repos were genuinely missing.
All three are filled in the project's own TypeScript conventions — no code was
copied from any reference repo.

### 1. Mechanical structural assertions — `verify.assert` node type

**The gap.** The engine had `logic.condition` (truthy/equals/contains/notEmpty)
but no way to check structural properties of a step's output without spending
tokens. agency-orchestrator's two-tier verification pattern (`core/verify.ts` +
`core/assert.ts`) separates "did the model produce good content?" (model-judged,
costs tokens) from "does the output have the shape we need to proceed?"
(mechanical, zero tokens). Without the second tier, a model that says "done"
but only produced 5 of 6 expected files, or omitted a required field, passes.

**The fix.** New node type `verify.assert` (added to `WORKFLOW_NODE_TYPES` in
`graph.ts`; implemented in `engine.ts`). Operators: `exists`, `equals`,
`notEquals`, `contains`, `matches` (regex), `minLength`, `maxLength`,
`minCount`, `maxCount`, `gte`, `lte`, `range`. Config: `{ from?: stepId, path?:
dotPath, operator, expected, message? }`. A failed assertion fails the step
(and by default the run) exactly like any other step failure — downstream nodes
are skipped, `continueOnError` still applies. JSON-path navigation blocks
`__proto__`/`constructor`/`prototype` segments. Zero AI calls are spent; this is
verified by tests asserting `result.aiCalls === 0`.

### 2. Causal trace IDs — threaded through every run + step

**The gap.** `AiWorkflowRun` had no `traceId`. `AgentTask` had an optional
`correlationId` but it was not threaded through workflow runs. `AuditLog` had
`requestId` but that is per-HTTP-request, not per-workflow-run. The
agency-agents pattern — "every agent call emits a structured log with a shared
`trace_id`" — was not implemented at the engine level.

**The fix.** `traceId` is now a first-class field: added to `AiWorkflowRun`
(Prisma migration `20261115120000_ai_workflow_assertions_trace`), threaded
through `RunOptions` → every `StepResult` → `WorkflowRunResult`, generated in
`runner.ts` (UUID if not supplied), persisted on the run row, returned in the
`POST /api/ai/workflows/:id/run` response, and included in the audit-log
metadata for every workflow run. When resuming a run, the original traceId is
reused for causal continuity. Indexed for lookup-by-trace so a log line with
only the traceId can find its run without knowing the runId.

### 3. Crash-resilient resumable runs — incremental persistence + priorSteps

**The gap.** `runner.ts` persisted only the **final** result after the whole
run completed. If the process crashed mid-run, the run stayed "running" forever
and all step progress was lost. agency-orchestrator's `FileJobStore` flushes
step results as they complete and supports `--resume` from a step.

**The fix.** The engine now accepts an `onStepComplete` callback (called for
every step — succeeded, failed, and skipped) and a `priorSteps` array.
`runner.ts` wires `onStepComplete` to flush the accumulated steps array to the
`AiWorkflowRun.steps` column after every step, so a crash retains partial
progress. `executeStoredWorkflow` accepts `resumeFromRunId`: it loads the
prior run's succeeded steps, passes them as `priorSteps`, and the engine
skips re-executing them (no duplicate AI calls, no duplicate tool calls —
verified by tests). Failed/skipped prior steps are NOT reused — they re-execute
so a transient error can be retried. For condition nodes, the taken branch is
re-derived from the prior step's recorded `output.result`.

## Deliberate non-goals

**Action / mutation tools in the workflow engine.** The engine stays read-only
by design (see the security comment at the top of `tools.ts`). Mutations
happen through the existing `AgentTask` system with `requiresApproval` and
blast-radius-appropriate gating, not by giving a workflow graph direct write
access to services. This is a deliberate safety boundary, not a gap.

**Full resume API route.** The resume capability is implemented in the library
(`executeStoredWorkflow({ resumeFromRunId })`) and exposed through the existing
run route's body (`{ resumeFromRunId }`). A dedicated
`POST /api/ai/workflows/runs/:id/resume` route is a follow-up — the current
entry point is sufficient.

**Eval suites.** The agency-agents "eval-driven development" pattern (≥20 case
eval suites + recorded baseline + regression gate) is a dev-time tooling
pattern, not a runtime engine feature. It belongs in a separate `scripts/eval/`
system and is out of scope for this branch.

**Incident-response runbooks (SEV1-4).** The agency-agents-zh incident-response
runbook is an ops/process feature. It would map to an `Incident` Prisma model +
API + a runbook template library. Out of scope for this engine-focused branch.

## Files changed

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | `+traceId String?` + `@@index([traceId])` on `AiWorkflowRun` |
| `prisma/migrations/20261115120000_ai_workflow_assertions_trace/migration.sql` | New migration |
| `src/lib/ai/automation/graph.ts` | `+verify.assert` in `WORKFLOW_NODE_TYPES` |
| `src/lib/ai/automation/engine.ts` | `verify.assert` case; `traceId` on StepResult/RunOptions/WorkflowRunResult; `priorSteps` pre-load; `onStepComplete` hook; assertion helpers |
| `src/lib/ai/automation/runner.ts` | traceId generation + persistence; incremental step flush via `onStepComplete`; `resumeFromRunId` loading |
| `src/app/api/ai/workflows/[id]/run/route.ts` | `traceId` + `resumeFromRunId` body params; traceId in response + audit metadata |
| `tests/ai-automation.test.ts` | +5 test groups covering verify.assert, traceId, onStepComplete, priorSteps resume, condition re-derivation |
