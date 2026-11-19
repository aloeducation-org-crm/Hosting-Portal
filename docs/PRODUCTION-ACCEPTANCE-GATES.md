# Production acceptance — HOLD

Evidence date: **2026-11-19 UTC**. Reviewed baseline:
`82b54a5924905eb562c3f60d46fd9a57803bfa02`, PR #52. The baseline PR run
`44583575962` passed verification and build; it published no production
candidate. The new pre-extraction gate is covered by automated fixtures; it
has no accepted staging artifact digest. A local PM2 rehearsal from the prior
session used disposable SQLite and synthetic upgrade/failure candidates, not
an exact CI artifact from an authorized release run.

| # | Gate | Status | Evidence / next action |
|---|---|---|---|
| 1 | Repository and commit integrity | PASS | Authorized baseline matched PR head at start, clean checkout; review the updated PR head before release. |
| 2 | GitHub CI | BLOCKED | Baseline passed; require the updated PR run and eventual release-SHA run. |
| 3 | Restricted staging runner | BLOCKED | Runner inventory API returned 403; admin must configure and verify dedicated group, label and account. |
| 4 | Restricted production runner | BLOCKED | Same API blocker; use a separate runner group/account and verify no staging access. |
| 5 | Environment protection | FAIL | Production returned no protection rules or branch policy; staging GET 404 and configuration PUT 403. Repository admin must install independent reviewers, prevent self-review and allow only main. |
| 6 | Exact CI artifact digest | BLOCKED | No published baseline candidate; use the next eligible release run and record archive and payload hashes. |
| 7 | Staging deployment | BLOCKED | Restricted staging host and exact artifact unavailable. |
| 8 | Automatic rollback | NOT TESTED | Real PM2 sandbox recovered; repeat on representative staging using an isolated failure candidate. |
| 9 | Manual rollback | NOT TESTED | Sandbox restored predecessor; repeat on staging and record both identities. |
| 10 | Restart and reboot | NOT TESTED | Named restart passed in sandbox; verify worker restart and reboot on staging. |
| 11 | PM2 configuration | NOT TESTED | Repository tests and sandbox passed; verify actual runner account and paths. |
| 12 | Port 3062 ownership | BLOCKED | Read-only production host access not available. Verify OS listener and persisted tenant assignments. |
| 13 | Nginx configuration | BLOCKED | No host access; test the actual portal vhost without changing unrelated projects. |
| 14 | Public HTTPS | NOT TESTED | Verify externally after authorized staged ingress setup. |
| 15 | SSL renewal | NOT TESTED | Identify issuer and rehearse renewal without a production cutover. |
| 16 | Production database identity | BLOCKED | No authorized host session/env metadata; verify portal and all workers, without printing values. |
| 17 | Isolated production backup restore | BLOCKED | Fixture restore is not production evidence; provision an isolated destination and approved backup access. |
| 18 | Prisma compatibility | NOT TESTED | Sandbox SQLite passed; verify restored production schema with the exact release. |
| 19 | Two-account tenant isolation | NOT TESTED | Automated API coverage exists; rehearse browser/API/worker access with two staging accounts. |
| 20 | GitHub App webhook | BLOCKED | Dedicated test installation and publicly reachable staging endpoint needed. |
| 21 | Monitoring alert delivery | NOT TESTED | Configure a staging receiver and capture actual delivery. |
| 22 | Backup automation | NOT TESTED | Verify real schedule, encryption, offsite retention and failure alert. |
| 23 | Security review | NOT TESTED | Actions pinned and transport checks added; full app, host, secret history, worker isolation and settings review remain. |
| 24 | Customer acceptance | NOT TESTED | Run desktop/mobile customer and Super Admin flows on staging. |
| 25 | 500+ concurrent users | NOT TESTED | Provision representative staging, agree thresholds and run controlled 50/100/250/500 ramps. |
| 26 | Rollback and recovery documentation | PASS | Versioned [PM2 runbook](PM2-IMMUTABLE-RELEASES.md) and [database recovery runbook](DATABASE-RECOVERY-RUNBOOK.md); host-specific recovery targets remain unmeasured. |
