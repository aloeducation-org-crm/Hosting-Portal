# AI automation server

The panel can execute server-side AI workflows: a validated DAG of steps that
combines model calls with **read-only** hosting queries, with per-step logs and a
replayable run history.

- Engine: `src/lib/ai/automation/engine.ts`
- Graph + validation: `src/lib/ai/automation/graph.ts`
- Tools: `src/lib/ai/automation/tools.ts`
- Runner (wiring + persistence): `src/lib/ai/automation/runner.ts`
- Templates: `src/lib/ai/automation/templates.ts`
- API: `/api/ai/workflows*`
- UI: `/ai/automations`

Provider configuration lives in [AI-PROVIDER-INTEGRATION.md](../AI-PROVIDER-INTEGRATION.md).

---

## 1. Data model

Workflows reuse the existing `ai_workflows` table (`nodes`/`edges` as JSON text).
One new table stores runs (migration
`prisma/migrations/20261025180000_ai_workflow_runs`):

```
ai_workflow_runs
  id, workflowId, userId, trigger, status, dryRun,
  input, output, steps, error, providers,
  aiCalls, tokensUsed, durationMs, startedAt, finishedAt
```

`steps` is the JSON array of `StepResult`s, so a run can be audited without
re-executing anything. Deleting a workflow cascades its runs.

---

## 2. Graph format

```json
{
  "nodes": [
    { "id": "start", "type": "trigger", "label": "Manual run" },
    { "id": "sites", "type": "hosting.listSites", "config": { "limit": 50 } },
    { "id": "digest", "type": "ai.complete", "config": {
        "system": "You are an SRE. Use only the data provided.",
        "prompt": "Sites: {{ steps.sites.output }}\n\nWrite a 100-word digest.",
        "temperature": 0.2, "maxTokens": 700 } },
    { "id": "out", "type": "output", "config": { "value": "{{ steps.digest.output.text }}" } }
  ],
  "edges": [
    { "from": "start", "to": "sites" },
    { "from": "sites", "to": "digest" },
    { "from": "digest", "to": "out" }
  ]
}
```

Validation before storage **and** before execution: node ids must match
`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, node types must come from the allowlist, edges
must reference existing nodes, no self-loops or duplicate edges, max 40 nodes /
120 edges, and the graph must be acyclic (Kahn's algorithm).

Edge conditions: `when: "always" | "true" | "false"`. A `logic.condition` node
routes `true`/`false` edges; unmatched branches and their descendants are recorded
as `skipped` with a reason.

---

## 3. Node types

| Type | Config | Output |
|---|---|---|
| `trigger` | — | the run input |
| `ai.complete` | `prompt` (required), `system`, `model`, `temperature`, `maxTokens`, `json` | `{ text, model, provider, tokensUsed }` |
| `ai.extract` | `prompt`, `from` (default: previous output) | parsed JSON (throws if the model returns prose) |
| `hosting.listSites` | `limit` (1–100) | `{ count, sites[] }` — no env vars, no secrets |
| `hosting.siteHealth` | `domain` | `{ found, domain, website }` with SSL + last 3 deployments |
| `hosting.sslExpiring` | `days` (1–365) | `{ windowDays, count, certificates[] }` |
| `logic.condition` | `value`, `operator` (`truthy`/`equals`/`contains`/`notEmpty`), `compare` | `{ value, operator, compare, result }` + branch selection |
| `transform.template` | `template` | rendered string (or the raw value for a lone `{{ … }}`) |
| `output` | `value`, `format` (`text`/`json`) | final workflow output |

Templating is `{{ input.foo }}`, `{{ steps.<nodeId>.output.text }}` and
`{{ vars.* }}`. Missing paths render as an empty string. Prototype-polluting
segments (`__proto__`, `constructor`, `prototype`) are rejected, and nothing is
`eval`-ed.

---

## 4. Safety model

- **Read-only tools.** The engine can inspect sites, SSL expiry and site health.
  It cannot suspend a site, run a backup, touch the filesystem or invoke a
  privileged helper (`helpers/*` → `/usr/local/sbin`). Those need a separate
  approval flow — see §8.
- **Budgets.** Max 12 AI calls per run (`maxAiCalls`), 120 s per step, strict DAG,
  ≤100 KB input, ≤200 KB persisted output per field.
- **Fail closed.** No provider ⇒ `503 AI_NOT_CONFIGURED`. No tool ⇒ the step
  fails. No JSON from the model ⇒ the `ai.extract` step fails instead of guessing.
- **Dry run** validates the graph and returns the plan **without** calling a
  provider or a tool. Use it before pointing an automation at production.
- **Auth + ownership.** Every route requires a session; non-admins only see and
  run their own workflows. Each create/update/delete/run writes an audit log entry.
- **Prompt injection.** Model output is data, not instructions. Because no
  mutating tool exists, injected text can only produce a wrong summary — never a
  shell command. Keep it that way, and never interpolate untrusted content into a
  privileged command.

---

## 5. API

```bash
# 1. See which provider will answer
curl -s -b "$COOKIE" http://127.0.0.1:3101/api/ai/providers | jq .
curl -s -b "$COOKIE" "http://127.0.0.1:3101/api/ai/status?probe=1" | jq .

# 2. Create an automation from a template
curl -s -b "$COOKIE" -X POST http://127.0.0.1:3101/api/ai/workflows \
  -H 'content-type: application/json' \
  -d '{"templateId":"ssl-expiry-triage"}' | jq .

# 3. Dry run (no provider/tool calls)
curl -s -b "$COOKIE" -X POST http://127.0.0.1:3101/api/ai/workflows/<ID>/run \
  -H 'content-type: application/json' -d '{"dryRun":true,"input":{"windowDays":14}}' | jq .

# 4. Real run
curl -s -b "$COOKIE" -X POST http://127.0.0.1:3101/api/ai/workflows/<ID>/run \
  -H 'content-type: application/json' -d '{"input":{"windowDays":14}}' | jq '.data.steps[] | {nodeId,status,provider,tokensUsed}'

# 5. History
curl -s -b "$COOKIE" "http://127.0.0.1:3101/api/ai/workflows/<ID>/runs?limit=5" | jq .
```

Run response shape:

```json
{
  "success": true,
  "data": {
    "runId": "…", "status": "succeeded", "dryRun": false,
    "output": "…",
    "steps": [{ "nodeId": "…", "type": "ai.complete", "status": "succeeded",
                "durationMs": 812, "provider": "llm7", "model": "…", "tokensUsed": 431 }],
    "durationMs": 1904, "aiCalls": 1, "tokensUsed": 431, "providers": ["llm7"]
  }
}
```

---

## 6. Adding a tool

1. Write a function in `src/lib/ai/automation/tools.ts` with a narrow input
   schema, hard limits and no secret-bearing output.
2. Add it to `HOSTING_TOOLS` under the name used by the node type.
3. Add a node type in `graph.ts` **and** a case in the engine switch (the
   `never` check makes this mandatory).
4. Add a unit test with a stubbed tool; add a template only if it is genuinely
   read-only.

Keep every new tool idempotent and side-effect free unless you also implement
§8.

---

## 7. Scheduling (not implemented)

The `trigger` field on a run already distinguishes `manual`. To add schedules:

1. Add `schedule String?` (5-field cron), `nextRunAt DateTime?`,
   `lastRunAt DateTime?` to `AiWorkflow` + a migration; validate with the existing
   `isValidCron` helper in `src/app/api/cron/route.ts` (currently duplicated —
   extract it to `src/lib/cron.ts`).
2. Add `POST /api/internal/automations/tick` protected by `INTERNAL_SECRET`,
   which selects workflows with `nextRunAt <= now`, runs each with
   `trigger: 'schedule'`, and advances `nextRunAt`.
3. Drive it from a systemd timer (there is already
   `deploy/systemd/alo-port-8080-validator.timer` as a template) — not from the
   Next.js process, so a restart cannot silently stop your automations.
4. Cap concurrency (e.g. 2 runs) and reuse the AI budget so one workflow cannot
   drain a free-tier quota.

Do not add an in-process `setInterval` in a Next.js app: it runs per worker and
will fan out unpredictably behind a reverse proxy.

---

## 8. Mutating tools (deliberately absent)

Automations that change infrastructure (restart a site, create a backup, rotate a
key) need, at minimum:

- an explicit `AI_WORKFLOW_ALLOW_MUTATIONS` flag, off by default;
- a per-tool allowlist **and** a role check (the acting user, not the model);
- a human confirmation step for anything destructive;
- idempotency keys + a compensating action for rollback;
- the existing helper layer (`callHelper`, allowlisted binaries, timeouts) as the
  only execution path — never `exec` from the model's text;
- an audit entry that records the model, prompt hash, tool args and result.

Until that exists, generate a *plan* with an automation and execute it with the
normal, permissioned UI.

---

## 9. Tests

```bash
npx vitest run tests/ai-automation.test.ts tests/ai-client.test.ts tests/ai-providers.test.ts
```

They cover: template validity, cycle/type/dangling-edge rejection, prototype-safe
templating, linear runs, conditional branching, failure propagation, dry-run
isolation, AI budget exhaustion, missing tools, provider resolution/redaction,
failover, retries, secret-free errors, JSON extraction and cancellation.
