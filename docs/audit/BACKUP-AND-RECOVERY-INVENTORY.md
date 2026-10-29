# Backup and recovery inventory

**Backups verified: 0. Restores performed: 0.**
No backup system was inspected, no repository listed, no restore attempted.

## 1. By server

| | A | B | C | D |
|---|---|---|---|---|
| Backup destination | unknown | unknown | unknown | unknown |
| Schedule | unknown | unknown | unknown | unknown |
| Retention | unknown | unknown | unknown | unknown |
| Encryption | unknown | unknown | unknown | unknown |
| Last successful | unknown | unknown | unknown | unknown |
| Last verified restore | **never** | **never** | **never** | **never** |
| Offsite copy | unknown | unknown | unknown | unknown |

Every cell `[BLOCKED]`.

## 2. The rules this inventory enforces

**R-1 · A backup is not verified until a restore succeeds.** The codebase already
implements this correctly: `/api/internal/crm/storage/backup` returns
`restoreVerified: false` unconditionally, with a note that verification requires an
actual restore it does not perform. That behaviour is deliberate and must not be
"fixed" into a green badge. Any dashboard tile claiming "backups verified" fed by
that endpoint would be displaying a claim the provider refuses to make.

**R-2 · Replication is not backup.** A file copied to a second disk is not a
backup — a deletion or corruption propagates. `ReplicationStatus` exists as a model
with no reconciler; nothing is replicated today.

**R-3 · A backup inside the same failure domain is not a backup.** A and B share
office power and ISP. An archive on B does not protect against an event that takes
out the office. Offsite is required and currently unverified.

**R-4 · Server A is not Server B's disaster recovery.** The brief is explicit and
the network map confirms it: one power cut removes both.

## 3. Known structural risk

Server B's root is a **single Hitachi HDS72105 HDD**. There is no RAID reported.
One disk failure loses the root filesystem and every project on it. Its two SSDs
are small and near-empty; whether they hold anything is unknown.

Server A's root is a **100 GB LV on a single Samsung NVMe** — also single-device.

Neither host has verified redundancy at any layer. `[REPORTED]` for the disk
inventory, `[BLOCKED]` for health — SMART data has not been read.

## 4. What a compliant backup design would need

| Requirement | Why | Current |
|---|---|---|
| Encrypted offsite repository (e.g. Restic) | R-3 | **missing** — `alo-server-kit/backup.sh` exists, no Restic integration in the app |
| Restore rehearsal in a disposable environment | R-1 | **never done** |
| Documented RPO/RTO | planning | not defined |
| Backup of *configuration*, not only data | SSH, Tailscale, Caddy, PM2, env | unknown |
| Retention policy with deletion audit | compliance | unknown |
| Alerting on failed backup | silent failure is the dangerous mode | **missing** |

## 5. Restore-test protocol (when authorised)

Must run against a disposable target, never production:

1. List the repository and record the snapshot id and timestamp.
2. Restore **one non-critical file tree** to a scratch path on a different host.
3. Verify checksums against the manifest.
4. Restore a **database dump** into a throwaway instance and run a read query.
5. Record elapsed time — that is the only evidence for an RTO figure.
6. Only then may `restoreVerified` be set, and only for that snapshot.

Steps 4 and 5 have never been performed anywhere in this project. Until they are,
**no backup claim may be made**, and the readiness label cannot exceed
`READY FOR HUMAN REVIEW`.
