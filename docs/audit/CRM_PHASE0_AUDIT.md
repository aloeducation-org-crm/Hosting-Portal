# ALO Education CRM — Phase 0 Audit

**Repository:** `tech360-bd/ALO_WEB_CRM_TECH` (public)
**Inspected at:** `main`, `pushed_at 2026-10-29T02:02:16Z`
**Method:** read-only shallow clone to `/tmp/crm-audit`, 68,417 tracked files, 269 MB
**Audited from:** the `aloeducation-org-crm/Hosting-Portal` working session
**Status of this document:** READ-ONLY AUDIT. No file in the CRM repository was
modified, and none can be from this session — see §7.

---

## 1. Headline finding

**The CRM is substantially more complete than the implementation brief assumes.**
The brief asks to "build" a central communication hub, automatic Student ID,
omnichannel ingestion, document vault, AI memory, consent handling and follow-up
automation. Every one of those already exists in the CRM, most of it with tests,
and several with more rigour than the brief specifies.

The genuinely missing component is the **ALO Hosting AI integration** — and the
missing half of that lives in *Hosting-Portal*, not in the CRM. The CRM contains
no reference to Hosting-Portal at all:

```
grep -rn "hosting.alolabs\|alo-hosting\|Hosting-Portal\|alolabs.net" src/ prisma/ docs/
→ 1 hit: an unrelated email address in a UI string
```

Meanwhile every Hosting-Portal storage endpoint was `requireSession`-only (a
browser session), which a server-side CRM cannot present. That gap is what this
session closed — see `CRM_INTEGRATION_CONTRACT.md`.

**Consequence for sequencing:** the highest-value work is the integration, not
rebuilding CRM subsystems. Building a "new" communication hub or Student ID engine
would duplicate working, tested code and — per §4 — risk creating conflicting
identifiers on a live system.

---

## 2. System inventory

| Property | Value |
|---|---|
| Package | `alo-education-erp` v0.3.0 |
| Framework | Next.js (App Router), TypeScript |
| Database | **MySQL** (`datasource db { provider = "mysql" }`) |
| Canonical schema | `prisma/schema.prisma` — **610 models** |
| Migrations | **45** in `prisma/migrations/`, plus `prisma/legacy-migrations-20261001/` |
| `src/` files | 2,670 |
| Test files | **531** (`.test.ts` / `.spec.ts`) |
| Seed scripts | 20+, including `prisma/seed-omnichannel.ts`, `seed-marketing.ts`, `seed-counselor.ts`, `seed-employee-access.ts` |
| CI workflows | `ci.yml`, `codeql.yml`, `deploy-production.yml`, `deploy-recovery.yml`, `health-monitor.yml` |
| Build | `next build --webpack` + `prepare-standalone.mjs`, gated by `assert-node22.cjs` |
| Verification harness | `awf:verify` / `awf:audit` — independent SQLite mirror verification |

Build/test commands available and real: `lint`, `typecheck`, `test` (vitest),
`test:integration`, `test:e2e` (playwright), `db:validate`, `db:deploy`.

---

## 3. The 25 mandated inspection items

Classification key: **Complete** = implemented and evidenced · **Partial** =
present but incomplete or unverified · **Duplicated** = more than one
implementation · **Not verifiable** = cannot be confirmed without live access.

| # | Component | Status | Evidence |
|---|---|---|---|
| 1 | Student models + Student ID generation | **Complete** | `src/lib/identity/student-id.ts`, model `StudentIdSequence` |
| 2 | Lead and Inquiry models | **Complete** | `src/app/api/crm/leads/counselling/route.ts`, lead scoring in `src/lib/ai-whatsapp-engine.ts` |
| 3 | Contact models | **Complete** | `src/lib/student/canonical-student.ts`, `api/communications/contacts/match` |
| 4 | WhatsApp integration | **Complete** | 87 files; `src/lib/whatsapp-webhook-handler.ts`, `src/lib/whatsapp-number-pool.ts`, `src/lib/whatsapp-followup-engine.ts`, 21 `api/whatsapp/*` routes |
| 5 | Facebook / Instagram | **Complete** | 18 + 12 files; `src/app/api/facebook/webhook/route.ts`, `api/communications/social-accounts` |
| 6 | SMS integration | **Complete** | 30 files; `src/app/api/integrations/httpsms/webhook/route.ts`, `api/integrations/3cx/*` |
| 7 | Webhook handlers | **Complete** | 17 webhook routes across whatsapp, facebook, httpsms, 3cx, marketing, google-business, ucc |
| 8 | Message / conversation models | **Complete, Duplicated** | `CommunicationThread`, `CommunicationMessage`, `CommunicationThreadParticipant`, `InboundMessage`, `AloMessage`, `SocialInbox`, `MarketingSocialMessage` — see §5 |
| 9 | Counselor assignment logic | **Complete** | `CounselorTask`, `CounselorResponseMetric`, `EmployeeReassignment`, `api/whatsapp/routing`, `src/lib/sla-engine.ts` |
| 10 | Employee roles and permissions | **Complete** | `prisma/seed-employee-access.ts`, `EmployeePermissionPackageAssignment`, `PartnerPackageAssignment`, `src/app/admin/access-control-center`, `employee-control` |
| 11 | Marketing automation | **Complete** | `MarketingCampaign`, `EmailCampaign`, `Campaign`, `CampaignPost`, `api/marketing/*`, `src/lib/marketing-consent.ts` |
| 12 | AI agents and routing | **Complete** | `src/lib/ai-whatsapp-engine.ts` (`detectIntent`, `detectLanguage`, `detectSentiment`, `generateAiReply`, `logAiOperation`, `calculateLeadScore`), `api/whatsapp/ai-intent`, `ai-reply` |
| 13 | Document storage | **Complete, Duplicated** | `src/lib/storage-service.ts`, `src/lib/storage/private-file-store.ts`; 12+ document models — see §5 |
| 14 | Document verification | **Complete** | `api/communications/...`, `tests/unit/document-rejection.test.ts`, `application-document-review-security.test.ts`, `AiDocumentClassification` |
| 15 | Student dashboard | **Complete** | `PortalStudentProfile`, `PortalStudentApplication`, `PortalStudentDocument`, `tests/unit/document-portal-student-scope.test.ts` |
| 16 | Partner dashboard | **Complete** | `prisma/seed-partner-portal.ts`, `PartnershipCommunication`, `PhdCommissionDocument` |
| 17 | Admin dashboard | **Complete** | 30+ `src/app/admin/*` routes incl. `audit-logs`, `document-security`, `data-conflicts`, `approvals`, `change-approval`, `crm-command` |
| 18 | Notification system | **Complete** | `CommunicationSlaEvent`, `CommunicationSlaIncident`, `CommunicationSlaRule`, `CommunicationSlaJustification` |
| 19 | Audit logs | **Complete** | `DocumentAudit`, `CommunicationLog`, `CommunicationRoutingLog`, `api/admin/audit-logs` |
| 20 | Background workers | **Complete** | `api/cron/webhook-dispatch`, `src/lib/sla-engine.ts`, `whatsapp-followup-engine.ts` |
| 21 | Database migrations | **Complete** | 45 migrations + legacy archive |
| 22 | GitHub CI workflows | **Complete** | 5 workflows including CodeQL and a deploy-recovery path |
| 23 | Deployment architecture | **Not verifiable** | `deploy-production.yml` and `deploy/` exist; no access to the target host or its run history |
| 24 | **ALO Hosting AI integration** | **MISSING** | Zero references. This is the real gap. |
| 25 | ALO Labs AI integration | **Partial** | `.env.ai-gateway.example`, AI gateway scripts and `ai-whatsapp-engine` exist; the provider policy (free/local only, no paid fallback) was not verified end to end |

---

## 4. Student ID — verified implementation detail

This is the most safety-critical subsystem in the brief, so it was read line by
line rather than inferred from file names.

**Production format is `AE-YYYYNNNN`** — e.g. `AE-20260001`. Established by:

```ts
// src/lib/identity/student-id.ts
export function formatIdentifier(scope, year, sequence) {
  if (!SCOPES.includes(scope)) throw new IdentifierAllocationError(...);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw ...;
  const maxSequence = scope === 'AE' ? MAX_STUDENT_SEQUENCE : MAX_SEQUENCE;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > maxSequence)
    throw new IdentifierAllocationError('Identifier sequence exhausted for this year.');
  const width = scope === 'AE' ? 4 : 5;
  return `${scope}-${year}${String(sequence).padStart(width, '0')}`;
}
```

The allocator is genuinely concurrency-safe, using MySQL's atomic
`LAST_INSERT_ID` sequence idiom rather than a read-then-write race:

```sql
INSERT INTO StudentIdSequence (id, scope, year, lastValue, updatedAt)
VALUES (?, ?, ?, 0, NOW(3))
ON DUPLICATE KEY UPDATE id = id;

UPDATE StudentIdSequence SET lastValue = LAST_INSERT_ID(lastValue + 1), updatedAt = NOW(3)
WHERE id = ?;

SELECT LAST_INSERT_ID() AS value;
```

Properties verified by reading the code:

- **Database uniqueness** — `StudentIdSequence @@unique([scope, year])`, and
  `AloStudent.studentId String @unique`.
- **Transactional** — `allocateIdentifier(tx, …)` runs inside the caller's
  transaction; `allocateIdentifierCommitted(…)` wraps it in its own committed
  transaction.
- **No reuse** — documented explicitly: *"A later failure leaves a gap, never a
  reused number."*
- **Legacy collision avoidance** — every candidate `AE` identifier is checked
  against **both** `tx.student` and `tx.portalStudentProfile` before being
  returned, up to `MAX_STUDENT_SEQUENCE` attempts.
- **Exhaustion fails loudly** — throws rather than wrapping or reusing.
- **P2002 retry** — `canonical-student.ts` retries up to 5× on a unique violation.

### 4.1 Two generators — verified NOT to conflict

The brief forbids creating conflicting identifiers. Two entry points exist and
were traced to confirm they share one allocator:

| Entry point | Delegates to |
|---|---|
| `generateStudentId()` in `src/lib/whatsapp-webhook-handler.ts:117` | `allocateIdentifierCommitted('AE')` |
| `generateCanonicalStudentCode()` in `src/lib/student/canonical-student.ts:37` | `allocateIdentifierCommitted('AE')` |

Both resolve to `src/lib/identity/student-id.ts`. **No conflict.** The second
surface is `ensureCanonicalStudent`, which is idempotent by email and returns
`mode: "LINKED"` when a record already exists and `"CREATED"` only when it does
not — and which refuses with `STUDENT_EXISTS_DIFFERENT_OWNER` rather than
silently taking over a record owned by someone else.

### 4.2 First-contact auto-creation — a deliberate existing safeguard

`src/lib/whatsapp-webhook-handler.ts:22` states:

> *"Existing phone normalization, signature verification, routing and message
> processing stay in place; **student IDs are generated only by the reviewed
> student-creation workflow.**"*

This directly contradicts brief §4.1, which requires first contact to mint a
Student ID with no registration form. **This was not changed.** Per instruction,
the safeguard is preserved: the long-term requirement stands, but it must be
implemented inside the CRM's reviewed student-creation workflow, in the CRM
repository, with its own idempotency, concurrency, verified-identity-match,
ambiguous-review, duplicate-prevention, audit and regression tests. Reversing it
from a different repository, without the ability to run the CRM's 531 tests,
would be exactly the kind of unverified change the brief prohibits.

---

## 5. Webhook, communication and identity — verified detail

**Signature verification is real and correct**
(`src/app/api/whatsapp/webhook/route.ts`):

```ts
function verifySignature(rawBody: string, signature: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);   // timing-safe
}
// ...
if (!signatureValid) return NextResponse.json({ error: "Invalid signature — webhook not verified" }, { status: 401 });
```

Plus `hub.verify_token` validation on the GET subscription handshake.

**Idempotency is real, and better specified than the brief**
(`src/lib/communications/webhook-idempotency.ts`). Its header comment records
that the previous implementation fell back to `Date.now()` for event ids in three
places — *"every retry of the same provider event produced a NEW id, so duplicate
processing was possible"* — and replaced it with ids derived from the provider
payload. It also encodes that **"API accepted" is not "delivered"**: `mapProviderStatus`
returns `null` for unknown values so they can never become `delivered`, and
explicitly excludes Meta's `warning` status because it is a business-quality
notice, not a delivery state.

**Relevant existing tests** (of 531 total):
`tests/integration/whatsapp-student-journey.test.ts`,
`tests/integration/webhook-security-live-db.test.ts`,
`tests/integration/communication-ownership.test.ts`,
`tests/unit/identity-match-policy.test.ts`,
`tests/unit/contact-identity.test.ts`,
`tests/unit/document-rejection.test.ts`,
`tests/unit/document-portal-student-scope.test.ts`,
`tests/unit/application-document-review-security.test.ts`,
`tests/unit/communication-draft-security.test.ts`,
`tests/unit/call-recording-consent.test.ts`.

**AI Memory exists but is loosely typed.** `AiStudentMemory` stores
`studentId`, `category`, `key`, `value`, `metadata` — with `studentId` a plain
`String` and **no foreign key**, so a memory row can outlive or misspell the
student it describes. `InboundMessage` is the same shape (`studentId String
@default("")`). This is *Partial*, not broken: it works, but it cannot enforce
referential integrity, and the brief's requirement that memory be
source-linked and auditable is only partly met — `metadata` is a JSON string, so
source references are conventional rather than structural.

---

## 6. Duplicated and divergent components

Recorded, **not** reconciled. Per instruction, `prisma/schema.prisma` is treated
as canonical and historical schema copies were left untouched; reconciling them
needs its own migration plan.

### 6.1 Five divergent Prisma schemas in-tree

| Path | Models | Note |
|---|---|---|
| **`prisma/schema.prisma`** | **610** | **canonical** |
| `deploy-build/prisma/schema.prisma` | 276 | build snapshot |
| `.repair-backup-20260819/schema.prisma` | 276 | repair backup |
| `alo-education-web-crm-final/prisma/schema.prisma` | 217 | older full app tree |
| `imports/alo-education-full/prisma/schema.prisma`, `imports/alo-education-source/prisma/schema.prisma` | — | imported source trees, each with their own `node_modules` |

Risk: a contributor edits the wrong schema, or a deploy tooling path reads a
276-model schema while the application expects 610. The `imports/*` trees contain
committed `node_modules`, which is how the repository reaches 68,417 files.

### 6.2 Overlapping model families within the canonical schema

| Concern | Competing models |
|---|---|
| Documents | `Document`, `OfficialDocument`, `AloDocument`, `ApplicationDocument`, `EmployeeDocument` + `EmployeeDocumentVersion`, `KnowledgeDocument`, `PhdDocument`, `PhdDocumentRequirement`, `PortalStudentDocument`, `AiGeneratedDocument`, `DocumentVersion`, `DocumentAudit`, `DocumentChecklist` |
| Messages | `CommunicationMessage`, `InboundMessage`, `AloMessage`, `MarketingSocialMessage`, `PartnershipCommunication` |
| Consent | `ConsentRecord`, `CommunicationConsent`, `ParentGuardianConsent`, `CommunicationPreference`, `CommunicationDeleteRequest` |
| Campaigns | `Campaign`, `MarketingCampaign`, `EmailCampaign`, `CampaignPost`, `MarketingCampaignSource` |

These are **not** assumed to be redundant — several are legitimately
domain-specific (PhD commissions, employee HR documents, parental consent for
minors). But the brief's own §8 warns against duplicating existing tables, and
any new work must first establish which family is authoritative for its use case.

### 6.3 Duplicate application tree

`alo-education-web-crm-final/` is a second, older full application tree with its
own Prisma schema. This mirrors a defect already documented in Hosting-Portal
(`alo-hosting-portal/`, residual R-03 in `PRODUCTION_READINESS.md`) — the same
anti-pattern in both repositories.

---

## 7. What could NOT be verified from this session

Stated plainly, because an audit that omits its own blind spots is not an audit.

| Not verified | Why |
|---|---|
| Any runtime behaviour | No CRM database, no staging host, no provider credentials. **Nothing was executed.** The 531 tests were inventoried, not run. |
| Deployment architecture (item 23) | No access to the CRM's deploy target or its Actions run history |
| ALO Labs AI provider policy (item 25) | `.env.ai-gateway.example` and the gateway scripts were read, but the no-paid-inference guarantee was not traced end to end |
| Live WhatsApp/Meta/SMS connectivity | Requires provider credentials and registered webhooks |
| Document malware scanning (brief §10 step 4) | No scanner integration was located; **not confirmed present or absent** — flagged as needing verification in the CRM repository |
| Whether any migration has been applied to production | No database access |
| Data retention/deletion workflows (brief §12) | `CommunicationDeleteRequest` exists; the policy around it was not traced |

**Repository-access constraint:** this session is bound to the branch
`arena/c02ea3c0-hosting-portal` in `aloeducation-org-crm/Hosting-Portal`. The CRM
repository was cloned **read-only** for inspection. No branch was created, no
commit made, and no pull request opened against `tech360-bd/ALO_WEB_CRM_TECH`,
both because this session cannot track work on another repository's branch and
because pushing to it was explicitly out of scope.

---

## 8. Recommended CRM-side sequence

For a session bound to the CRM repository. Ordered by value and by risk.

1. **Adopt the Hosting-Portal vault adapter** — see
   `CRM_INTEGRATION_CONTRACT.md`. This is the missing integration and it is now
   unblocked from the Hosting-Portal side. Highest value, lowest risk: additive,
   no schema change in the CRM required to start.
2. **Verify document malware scanning** (brief §10 step 4). Either locate the
   existing scanner or add one before attachments flow into the vault. A
   passport PDF arriving from WhatsApp and being stored unscanned is the sharpest
   risk in the document pipeline.
3. **Decide the first-contact Student ID policy** (§4.2) inside the reviewed
   student-creation workflow, with the regression tests the brief requires. Do
   not bypass `whatsapp-webhook-handler.ts:22`'s safeguard; extend it.
4. **Add referential integrity to `AiStudentMemory` and `InboundMessage`** —
   `studentId` as a real FK, so AI memory cannot drift from the student record it
   describes. Requires a migration plan and a backfill for existing rows.
5. **Reconcile the model families in §6.2** before adding any new communication
   or document model. Establish which of each family is authoritative and record
   it, so the next contributor does not add a thirteenth document model.
6. **Retire or archive the duplicate trees** (`alo-education-web-crm-final/`,
   `imports/*`, and their committed `node_modules`) as its own reviewable commit,
   with a maintainer decision — not a drive-by deletion.
7. **Verify the AI provider policy** end to end (no paid inference, no automatic
   paid fallback, model allowlists, quotas).

---

## 9. Assessment

The brief's premise — that these systems need building — is **not supported by
the evidence**. They exist, they are tested, and in two places (webhook
idempotency semantics and Student ID allocation) they are implemented more
carefully than the brief asks for.

What is genuinely absent is the bridge between the CRM and ALO Hosting AI. That
bridge has now been built on the Hosting-Portal side, with conformance tests, and
is documented in `CRM_INTEGRATION_CONTRACT.md` together with the exact CRM-side
adapter specification.

The largest residual risks in the CRM are **not** missing features. They are the
five divergent schemas, the overlapping model families, the unverified malware
scanning step, and the loose typing of AI memory. Those are reconciliation and
verification problems, and they are riskier to guess at from another repository
than to fix in place with the CRM's own test suite as the safety net.
