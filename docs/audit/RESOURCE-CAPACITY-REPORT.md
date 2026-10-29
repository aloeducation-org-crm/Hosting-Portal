# Resource capacity report

**Date:** 2026-10-29 · **Source:** owner-reported leads only.
**Measured utilisation across all four servers: 0 fields.**

## 1. The distinction this report exists to preserve

The brief requires four figures never to be confused:

1. **Provider-allocated** — what the plan or hardware nominally provides.
2. **OS-visible** — what the operating system can actually address.
3. **Device capacity** — raw block-device size.
4. **Filesystem capacity** — what a filesystem exposes, after partitions/LVM.

A root LV of 100 GB on a 473.9 GB PV is neither free space nor unused capacity —
it is allocated-elsewhere. The brief's warning applies directly: the ~374 GB of
unallocated PV on Server A is **not** permission to grow the root volume, and is
not "free space" for applications.

## 2. By server

### Server A — laptop
| Layer | Value | Status |
|---|---|---|
| Device | Samsung NVMe ~476.9 GB | `[REPORTED]` |
| PV | ~473.9 GB | `[REPORTED]` |
| Root LV / FS | 100 GB / ~98 GB | `[REPORTED]` |
| Used / free | ~32 GB / ~62 GB | `[REPORTED]` |
| Unallocated PV | ~374 GB (implied) | `[REPORTED]`, **not usable without an approved LVM change** |
| Swap | ~4 GB, unused | `[REPORTED]` |

### Server B — desktop
| Layer | Value | Status |
|---|---|---|
| HDD | ~465.8 GB → root LVM ~456 GB | `[REPORTED]` |
| Root usage | ~74 GB used / ~363 GB free | `[REPORTED]` |
| `/mnt/ssd1` | WD ~111.8 GB, FS ~24 GB used / ~81 GB free | `[REPORTED]` |
| `/mnt/ssd2` | WDS128 ~119.2 GB, FS ~117 GB, ~26 MB used / ~111 GB free | `[REPORTED]` |
| Swap | ~6 GB | `[REPORTED]` |

**Flag on `/mnt/ssd2`:** ~26 MB used on a 117 GB filesystem is the signature of a
mountpoint that is present but **not mounted** — data written there lands on the
root filesystem instead. This is a common and silent way to fill `/`. Verify with
`findmnt /mnt/ssd2` before trusting the figure. `[BLOCKED]`

### Server C — Hostinger
| Layer | Value | Status |
|---|---|---|
| CPU / RAM / Disk quota | 4 cores / 4 GB / 100 GB | plan claim, `[REPORTED]` |
| Inodes | 2,000,000 | plan claim |
| Processes | 200 max, 100 PHP workers | plan claim |
| **Actual usage** | **unknown** | `[BLOCKED]` |

A 200-process ceiling says nothing about how many run. No utilisation percentage
is derived from these numbers anywhere in the codebase.

### Server D — cPanel
Entirely unknown: quotas, inode usage, mailbox storage, database limits. `[BLOCKED]`

## 3. Comparison, with what is deliberately absent

| | Allocated | OS-visible | Device | FS free | Utilisation |
|---|---|---|---|---|---|
| A | reported | reported | reported | reported | **unknown** |
| B | reported | reported | reported | reported | **unknown** |
| C | claim | unknown | claim | unknown | **unknown** |
| D | unknown | unknown | unknown | unknown | **unknown** |

**No aggregate row.** Summing separate machines into one capacity figure would
imply resources are interchangeable and available to a single project. They are
not. That is why `ALL-SERVERS-COMPARISON.md` omits a total and the inventory route
computes no such sum.

## 4. Capacity alerts that would matter once measured

| Alert | Threshold | Rationale |
|---|---|---|
| Root FS > 85 % | warn | A and B both live on single root LVs |
| Inodes > 80 % on C | warn | shared hosting fails on inode exhaustion before bytes |
| Swap actively used on B | warn | 6 GB swap on a 10-year-old HDD is a thrash risk |
| `/mnt/ssd*` not mounted | **critical** | silent writes to `/` |
| Process count near 200 on C | warn | hard ceiling |

None of these is active: no monitoring agent is connected. `[BLOCKED]`
