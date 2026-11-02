# Internal Software Factory Delivery Workflow

Date: 2026-10-31
Status: **Design / operating specification — not an implemented approval system.**

## 1. Scope and precedence

This specification extends, without replacing or deleting, the existing structure in:

- `../SOFTWARE-FACTORY-REPORT.md`: reuse Industry System Registry, Service Catalog, CRM, Projects/Tasks and App Center patterns; preserve its phase boundaries.
- `../SELF-HOSTED-ACCEPTANCE-GATE.md`: hosting safety and release evidence take priority.
- `../EXTERNAL-TOOLS-EVALUATION-BACKLOG.md`: optional tools remain deferred until core acceptance gates pass.
- `../DATABASE-RECOVERY-RUNBOOK.md` and existing deployment/rollback runbooks: preserve recovery options and additive migration rules.

The owner requires an internal, admin/supervisor-controlled process, preservation of existing content and client-specific delivery. This is not authorization for production deployment, DNS changes, destructive cleanup, automatic third-party installation or a new production workflow.

## 2. Preservation and traceability

1. Inventory each existing repository, module, document, template, configuration and data store before proposing changes. Record its commit/version and original path.
2. Follow the existing project's headings, fields, module keys, naming and technology conventions. Add supplemental sections where needed; do not silently reinterpret or replace existing formats.
3. Update by reviewed diffs. Preserve original substantive content and historical evidence; mark outdated statements with dated corrections rather than deleting history or treating stale claims as current verification.
4. No file/content deletion, database rebuild, configuration replacement or data removal without separate explicit approval, a verified recovery copy and a documented reason. Do not make "cleanup" an implicit step.
5. Preserve existing routes and contracts unless an approved compatibility plan exists. Schema changes are additive by default; production schema operations follow the recovery runbook.
6. Record upstream version, internal changes, tests, compatibility and recovery path for every adapted project. Do not copy upstream dependencies into this repository simply to catalogue them.

## 3. Internal confidentiality and truthful delivery

Keep implementation notes, prompts, model/tool choices, internal costs, task routing, security details and credentials behind server-side authorization. Hiding a UI element or using an obscure URL is not access control.

Client-facing output contains approved scope, requirements, milestones, real progress, deliverables, limitations, acceptance evidence and relevant support/security information. Exclude internal operational detail by explicit response field allowlists, not ad-hoc masking of entire internal records.

Confidentiality does not mean fabricated success, false claims about implemented features, suppressed failures, removal of licence notices or withholding required disclosures. Contracts and applicable licence obligations determine what must be supplied with client deliverables. Secrets must never appear in either internal audit output or client exports.

## 4. Authority model

Existing roles in `src/lib/auth.ts` include SUPER_ADMIN, ADMIN, DEVOPS, SUPPORT, VIEWER, CLIENT and RESELLER. **SUPERVISOR is not currently an implemented application role.** Do not silently map every administrator or support user to a supervisor.

| Responsibility | Intended authority | Required implementation/evidence |
| --- | --- | --- |
| Super administrator | Assign scoped staff authority, approve policy and integration admission | Audited role changes; no approval bypass implied by this document |
| Administrator | Own project intake, scope, assignments and release request | Server-side role plus organization/project permission checks |
| Supervisor | Review assigned work, request changes, approve specified milestones | Explicit scoped capability/delegation, expiry/revocation and tests before enabling; no implicit infrastructure access |
| Developer / AI worker | Produce patches, analysis and test evidence for assigned tasks | Least privilege, sandbox limits; cannot approve own work or obtain production secrets by default |
| Operations executor | Execute a specifically approved job | Target/action-bound authorization, job ID, lease/lock, expiry and independent postconditions |
| Client | View approved deliverables and approve their agreed scope | Own-tenant records only; no internal task/tool/secret visibility |

Every API, worker claim, file download and export must enforce authority independently. Require a reviewer distinct from the implementer for high-risk changes; identities must be real accounts, not two agents acting as the same approving principal. If a second authorized reviewer is unavailable, high-risk work remains Requires approval.

## 5. Project record format

Reuse existing Project/Task and catalog identities. The following is a proposed supplemental record, not a new deployed schema:

| Field group | Required content |
| --- | --- |
| Identity | Project ID, organization ID, industry slug, service slug(s), owner, assigned supervisor |
| Baseline | Repository URL, approved upstream version/commit, original format/template references |
| Rights review | Licence identifier/text location, attribution, dependency obligations, permitted adaptation/distribution, reviewer |
| Scope | Client requirements, acceptance criteria, deliverables, exclusions, dependencies, change requests |
| Internal execution | Assigned staff/worker, task IDs, permitted tools, sandbox, resource/network limits, secret references only |
| Verification | Tested SHA, test commands/results, evidence references, security findings and unresolved risks |
| Approval | Actor, project/tenant, exact target/action/SHA, reason, expiry, review result; invalidate on material scope/artifact change |
| Recovery | Backup identity, verification result, restore/rollback plan, approved test target |
| Handover | Approved artifact identity, client-visible notes, required notices/source offers, support and recovery instructions |

Until durable approval records and enforcement exist, these fields are a specification and must not be rendered as successfully configured controls.

## 6. Delivery stages and gates

| Stage | Owner | Exit requirement |
| --- | --- | --- |
| Intake | Administrator | Existing structure inventoried; client need and authorized scope recorded |
| Authorized analysis | Assigned developer | Source/behaviour/dependency map; security and licence review; preserve baseline |
| Plan | Administrator + supervisor | Task decomposition, compatible extension design, risks, tests and recovery plan approved |
| Implement | Assigned developer / sandboxed worker | Reviewable additive patch; no production access; tests and evidence linked |
| Review | Independent authorized supervisor | Requirements, code, security, permissions, preservation and licence checklist reviewed |
| Staging verification | Approved operations executor | Real target deployment, failure recovery, backup restore and actual monitoring evidence |
| Client acceptance | Client + administrator | Agreed deliverables verified; limitations accurately stated; changes returned to scope review |
| Release request | Administrator | All core acceptance gates passed, exact release identity and recovery path recorded |
| Production release | Explicit owner approval + authorized executor | Separate release permission; approval is not inferred from review, client acceptance, CI or this design |
| Handover | Supervisor + administrator | Tested artifact, notices, agreed documentation and support responsibilities delivered |

Analysis/adaptation means inspecting source and behaviour that the company is authorized to access, understanding interfaces/data flows, and implementing compatible changes. Do not bypass access controls, licensing mechanisms or obtain private source/credentials. Open-source availability is not permission to remove attribution or ignore redistribution/source obligations. Unclear permissions block reuse pending review.

## 7. Operational states and evidence

Use the existing acceptance-gate vocabulary: **Available, Configured, Running, Failed, Requires setup, Requires approval**. Record queued, review and completion substates where needed, but a completed task is not a completed deployment.

- Missing credentials/agent/domain or unsupported runtime: Requires setup.
- Missing, expired, revoked or artifact-mismatched approval: Requires approval.
- Running: durable job identity and current lease/heartbeat, never a browser timer.
- Failed: sanitized error, preserved evidence and explicit recovery action.
- Completion: independently checked postconditions tied to the intended artifact and target; no model-generated assertion of success.

Audit attempt, approval, rejection, execution, verification and recovery with actor, project/tenant, action, target, artifact SHA, timestamps and operation ID. Logs must redact secrets and be access-controlled. Retention and append-only/tamper-evident storage require an operational review; this document does not establish them.

## 8. Acceptance tests required before implementation can be called complete

- Anonymous and client accounts cannot read internal workflows, prompts, staff notes or approval endpoints.
- Cross-tenant IDs, exports, attachments and task/job lookups are denied.
- Scoped supervisors cannot approve unrelated projects, change roles, access secrets or self-approve high-risk work.
- Revoked/expired approvals and changed artifacts cannot execute; approval consumption and duplicate jobs are concurrency-tested.
- Workers cannot issue arbitrary shell commands, escape allowed paths or claim work outside their scope.
- External/provider failure, worker crash and stale heartbeat produce truthful states and recoverable jobs.
- Before/after inventory confirms existing content and unrelated project resources are preserved.
- Licence/notice review is completed for each included upstream project, not inferred from repository popularity.
- Client responses and exports use allowlisted fields and never include internal records or secrets.
- Real staging deployment, rollback, isolated restore and monitoring checks meet the existing acceptance gate; no production mutation for these tests.

## 9. Implementation sequence

1. Finish current hosting release-safety remediation; retain manual-only production operation.
2. Map existing endpoints and project/task models to this specification; produce a gap and permission matrix before adding schema or roles.
3. Implement scoped internal workflow/approval records and APIs additively, with denial/concurrency tests first. Do not seed a broad supervisor role as a shortcut.
4. Add an internal admin UI only after backend enforcement; add client-safe projections separately.
5. Complete staging evidence and owner review. Optional integrations remain in the separate backlog until core acceptance gates pass.

Current outcome: specification added, not a functioning internal workflow feature. No role, migration, API, server operation or external integration was enabled by this document.

## Own-agent reconstruction supplement — 2026-10-31

See [`OWN-AGENT-RECONSTRUCTION-RESEARCH.md`](OWN-AGENT-RECONSTRUCTION-RESEARCH.md) for pinned external-source findings and the proposed own-agent change/review/sandbox workflow. The new `src/lib/ai/code-change-proposal.ts` helper only validates review proposals; it does not implement supervisor delegation, durable approvals or execution. Previous authority, preservation, licensing and production-release restrictions above remain unchanged.
