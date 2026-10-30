# Unverified facts and access blockers

The single list of **everything asserted without evidence**. If a claim is not
here, it is either verified (cite the source) or it should not exist.

## 1. Facts asserted with no verification

| # | Claim | Basis | Why unverified |
|---|---|---|---|
| U-1 | Server A is an HP ZBook on Ubuntu 22.04.5 | owner report | no host contact |
| U-2 | Server A hardware: i5-10310U / 16 GB / 476.9 GB NVMe | owner report | no host contact |
| U-3 | Server A addresses `192.168.0.197`, `100.94.234.101` | owner report | **no DNS from control plane** |
| U-4 | Server A runs 7 PM2 processes, 2 errored | owner report | no process query |
| U-5 | Server B hardware: Core2 Duo / 8 GB / 1 HDD + 2 SSD | owner report | no host contact |
| U-6 | Server B addresses `192.168.0.24`, `100.85.239.114` | owner report | **no DNS** |
| U-7 | Server B runs 5 PM2 processes; two restart counts truncated | owner report | no process query |
| U-8 | Server B had ~99.6 % CPU at one snapshot | owner report | single unverified observation |
| U-9 | `hosting.alolabs.net` points at Server B | assumption | DNS resolves; **not traced, not contacted** |
| U-10 | Server C is Hostinger with 4 cores / 4 GB / 100 GB | owner report | no provider evidence |
| U-11 | Server C is shared hosting | inference from plan shape | **could be VPS** — changes everything |
| U-12 | Server D is a separate provider from Server C | assumption | no evidence either way |
| U-13 | `aloeducation.com` mail is hosted on Server D | owner report | no provider evidence |
| U-14 | Three projects run on both A and B | owner report | names match; binaries unverified |
| U-15 | Which copy of those three is production | **unknown** | no evidence |
| U-16 | `/mnt/ssd2` is mounted | assumption | ~26 MB used on 117 GB suggests it may not be |
| U-17 | Any backup exists anywhere | assumption | none listed, none tested |
| U-18 | Current production release of the control plane | hypothesis `ec7ff40` | no release identity artefact; run #54 may have mutated host |
| U-19 | Production branch protection state | unreadable | API `403` |

## 2. Access blockers

| # | Blocker | Needs |
|---|---|---|
| B-1 | No access to A/B/C/D | A-1 read-only SSH / A-3 / A-4 |
| B-3 | Hostinger tier unknown | A-3 console evidence |
| B-4 | No cPanel token | A-4 provider-issued, least privilege |
| B-5 | Registrar / DNS authority unknown | A-5 read access |
| B-14 | Branch protection unreadable | A-2 admin token |

## 3. How each unverified fact gets resolved

| Fact | Resolution |
|---|---|
| U-1…U-8, U-16 | one read-only SSH session per host (checklists in `SERVER-A/B-FULL-CONFIGURATION.md`) |
| U-9 | `dig +short hosting.alolabs.net` + compare to verified Tailscale identity |
| U-10…U-13 | provider console export; no credential in chat |
| U-14, U-15 | `pm2 jlist` → `pm_cwd` → `git rev-parse HEAD` per directory |
| U-17 | list backup repositories; then **restore one into a scratch target** |
| U-18 | `cat release-identity.json`, `git rev-parse HEAD`, `pm2 jlist` on the deploy host |
| U-19 | admin-scoped API read |

## 4. Standing rule

A fact moves out of this table **only** when a command's output or a provider record
is attached. A document stating something is not evidence for it — including this
one. Where an earlier report and reality diverged, the divergence was recorded
(`VERIFICATION-2026-10-29-SESSION2.md` §2), not quietly corrected.
