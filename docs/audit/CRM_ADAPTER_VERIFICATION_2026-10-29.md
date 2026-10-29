# CRM Adapter Verification — 2026-10-29

**Purpose:** record evidence obtained by direct repository inspection, separate from
documentation claims and earlier session summaries.

**Scope of this pass:** the two lowest-risk items from the review — the CRM-side specification
issue and the production approval gate. No merge, no deployment, no migration, no credential,
no vault activation was performed.

**CRM baseline inspected:** `tech360-bd/ALO_WEB_CRM_TECH` `main` @ `642f4f9`
(`642f4f9e9256e6f47ad6d1f5703250678505d46c`)
**Provider contract inspected:** `CRM_INTEGRATION_CONTRACT.md` v1.0.0 @ `7cf8516`
(`7cf851674a49f1d4327e5bc74ad0d2c702f4ece5`), carried on PR #19 head `a4c9b32`

---

## 1. Production approval gate — VERIFIED OPEN (not protected)

| Fact | Value | Source |
|---|---|---|
| `production` environment exists | yes, created `2026-10-25T05:32:00Z` | `GET /repos/…/environments` |
| `protection_rules` | **`[]` — empty** | `GET /repos/…/environments/production` |
| Required reviewers configured | **no** | same |
| `can_admins_bypass` | `true` | same |
| `deployment_branch_policy` | `null` (unrestricted) | same |
| Repository visibility | **public** | `GET /repos/…` |

**Why it matters.** `.github/workflows/ci-cd.yml` declares `environment: production` on the
`deploy` job, which runs on `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.
With no protection rule, **merging any PR to `main` starts a production deployment immediately,
with no human approval.**

The repository is public, so GitHub's required-reviewer protection **is available** — this is a
configuration gap, not a platform limitation. It is a repository-admin action and cannot be set
from a workflow file.

**Current production state — UNCONFIRMED, and internally inconsistent.**

Two facts do not agree, and neither can be reconciled from available evidence:

| Evidence | Value |
|---|---|
| Deploy job for the PR #11 merge run `40439634377` (`ec7ff40`) | **success** |
| Every `production` environment deployment record | `54e3454` — PR **#9**'s merge commit, `2026-10-26` |
| Most recent deployment record `7383720425`, created `2026-10-28T11:09:30Z` | status **failure** |

A deployment created on `2026-10-28` that records `54e3454` — a `2026-10-26` commit, two merges
behind — is consistent with the stale/backwards-release hazard PR #19 exists to fix, and not
consistent with a clean fast-forward to `main`.

Runs since then have not reached a successful deploy:

| Run | Commit | Deploy job |
|---|---|---|
| `40794019187` (PR #17 merge) | `7fc3d15` | **skipped** — preflight failed |
| `40780568808` (PR #16 merge) | — | failure |
| `40662370310`, `40515206388` | — | cancelled |
| `40493667038`, `40455213982` | — | failure |

**Conclusion:** the exact commit running in production **cannot be established** from the
available evidence. This is precisely the review item "confirm the exact production deployment
target and current release", and it stays **OPEN**. It is not a documentation gap — the records
disagree with each other.

Today the dirty-checkout preflight failure (R-05) is the only thing preventing unattended
deploys. **Clearing R-05 without first configuring a required reviewer converts the blocker into
an unattended-deploy path.** Reviewer configuration must precede the merge.

**Branch protection on `main`: NOT VERIFIED.** `GET /repos/…/branches/main/protection` returns
`403 Resource not accessible by integration`. The available token has read-only `pull`
permission. This is recorded as unverified rather than assumed either way.

---

## 2. Malware scanning — VERIFIED PRESENT, NOT UNIFORMLY ENFORCED

This closes the open question in risk **R-17** ("was not located in the CRM"). It has now been
located and read.

**Implementation:** `src/lib/documents/malware-scan.ts`

- Layer 1 — built-in signatures, always runs, no external dependency: EICAR Standard Anti-Virus
  Test File, PE `MZ` header, ELF header, PowerShell `-enc` / `DownloadString`, Office `AutoOpen`.
  Pure and unit-testable.
- Layer 2 — ClamAV `clamd` **INSTREAM** over TCP, used when `CLAMAV_HOST` is set. Bytes are
  streamed, never written to the scanner's filesystem. `FOUND` → infected; any other non-`OK`
  reply is treated as infrastructure failure, not a verdict.
- `scanPolicy()` — `NODE_ENV === 'production'` ⇒ **fail-closed** (unreachable scanner rejects the
  upload); otherwise fail-open so local development is not blocked.
- **This is genuine scanning, not file-type validation.**

**Tests:** `tests/unit/malware-scan.test.ts` — 14 cases, including "still rejects EICAR, because
the built-in layer always runs" and "refuses to vouch for a clean file in production when no
scanner is reachable".

**Enforcement gap — 2 of 9 write paths are scanned:**

| Write path | Scanned |
|---|---|
| `src/app/api/documents/route.ts` | ✅ |
| `src/app/api/crm/ucc/documents/upload/route.ts` | ✅ |
| `src/app/api/counselor/documents/upload-on-behalf/route.ts` | ❌ |
| `src/app/api/documents/auto-upload/route.ts` | ❌ |
| `src/app/api/employee/documents/route.ts` | ❌ |
| `src/app/api/partner/documents/route.ts` | ❌ |
| `src/app/api/student/documents/route.ts` | ❌ |
| `src/app/api/whatsapp/webhook/route.ts` | ❌ |
| `src/lib/whatsapp-media-ingestion.ts` | ❌ |

**Direct consequence for the integration.** Contract §8.4 nominates `whatsapp-webhook-handler.ts`
as the vault wiring point. The WhatsApp media path
(`whatsapp-media-ingestion.ts:151`, `whatsapp/webhook/route.ts:831`) calls `storePrivateFile`
with **no scan**. Wiring the vault there would forward unscanned WhatsApp attachments — the
sharpest risk in the pipeline — into a third-party vault.

**Verdict: keep `ALO_HOSTING_VAULT_ENABLED=false`.** A scanner exists, but uniform enforcement
does not. Activation requires the §6 ordering in CRM issue #44 to be implemented and tested.

---

## 3. Contract defects found by verification

1. **§8.4 `sha256` pass-through is wrong for documents.** In
   `whatsapp-webhook-handler.ts:79`, the `image` branch extracts `sha256`; the `document` branch
   (line 80) extracts only `filename` and `mime_type`. A document forwarded with the image's
   digest would be rejected `422 CHECKSUM_MISMATCH`. The adapter must compute the digest.
2. **§7 cites a non-existent path.** `src/lib/webhook-idempotency.ts` does not exist. The module
   is `src/lib/communications/webhook-idempotency.ts`.
3. **PR #19's description under-describes PR #19.** The title foregrounds deploy/security fixes;
   the CRM vault work (`7cf8516`, 8 endpoints, 80 conformance tests, both contract documents) is
   in the same diff, in 42 changed files. Anyone reviewing by title alone will miss the
   integration surface. This is a reviewability problem, not a defect in the code.

---

## 4. Student ID safeguard — VERIFIED SINGLE ALLOCATION PATH

Independently confirmed that both apparent generators share one path:

```
whatsapp-webhook-handler.ts:generateStudentId  ─┐
student-auth.ts                                ─┼─> allocateIdentifierCommitted('AE')
canonical-student.ts                           ─┘            │
                                                              v
                    src/lib/identity/student-id.ts :: allocateIdentifier(tx, scope)
```

`allocateIdentifier` advances the sequence with one atomic `UPDATE` + `LAST_INSERT_ID` inside the
caller's transaction, fails closed on overflow (> 9999 for `AE`), never reuses a number, and uses
the `Asia/Dhaka` business year. Concurrency behaviour is stated as verified only by the
real-database integration test, which needs a disposable MySQL instance. The safeguard was **not
modified**.

---

## 5. Deliverable produced

CRM-side specification issue:
**https://github.com/tech360-bd/ALO_WEB_CRM_TECH/issues/44**

It carries the module layout, configuration, the eight endpoints with their required scopes, all
twelve contract conformance scenarios plus four CRM-specific tests, timeout/retry/error/
idempotency/audit requirements, credential storage and rotation, compatibility analysis against
the CRM's identity, consent and document workflows, and the §0 scanning decision.

---

## 6. Blocker status after this pass

| # | Blocker | Status |
|---|---|---|
| B-1 | Required reviewer on `production` environment | **OPEN** — verified absent; admin action |
| B-2 | Branch protection on `main` | **BLOCKED** — token lacks scope; cannot read or verify |
| B-3 | Malware scanning uniformly enforced | **OPEN** — scanner verified present, 2/9 paths enforced |
| B-4 | CRM adapter implemented | **OPEN** — specified in issue #44; no code exists |
| B-5 | Contract defects §7 / §8.4 corrected | **OPEN** — recorded, not yet patched |
| B-6 | Production database migration applied | **OPEN** — not run |
| B-7 | Storage pools provisioned (`bucketPath`) | **OPEN** — all six `null` |
| B-8 | Backup restore test | **OPEN** — no restore has been performed; do not claim verified |
| B-9 | Exact commit running in production | **OPEN** — deployment records all say `54e3454` while the PR #11 deploy job reported success at `ec7ff40`; the two cannot both be true |
| B-10 | Rollback plan documented | **VERIFIED as documented** — `docs/audit/DEPLOYMENT_RUNBOOK.md` on PR #19. Not rehearsed against a live host. |
| B-11 | Provider conformance suite | **PARTIAL** — contract §9 asserts 47 + 33 = 80 tests; CI on PR #19 head `a4c9b32` shows *Lint, typecheck, and tests* **pass**. The suite was **not** re-run by this pass, and the per-suite counts were not independently reproduced. |
| B-12 | Student ID single allocation path | **VERIFIED** — confirmed in CRM source at `642f4f9` |

---

## 7. What this pass did not do

No merge, no deployment, no migration, no credential creation, no vault activation, no DNS /
email / firewall / SSH / TLS change, no branch-protection or environment-protection change, no
CRM code change, no document deletion. No unexecuted test, migration, restore or deployment is
claimed to have succeeded.
