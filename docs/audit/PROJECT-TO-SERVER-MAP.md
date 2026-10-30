# Project → server relationship map

**Status: NO RELATIONSHIP IS VERIFIED.** This document defines the map and records
what is known — which is only that process *names* appear on two hosts.

Required chain per project:

```
Project → Repository → Commit → Artifact → Server
        → Runtime → Process → Port → Reverse Proxy
        → Domain → Database → Storage → Backup → Monitoring
```

Every link carries: evidence source, timestamp, verification status, limitation.

## 1. Current state of the chain

| Link | A | B | C | D |
|---|---|---|---|---|
| Repository | unknown | unknown | unknown | unknown |
| Commit / SHA | unknown | unknown | unknown | unknown |
| Artifact | unknown | unknown | unknown | unknown |
| Runtime version | reported (node 24.22.1) | reported (node 22.23.3) | unknown | unknown |
| Process | 7 names reported | 5 names reported | unknown | unknown |
| Port / bind | unknown | unknown | unknown | unknown |
| Reverse proxy | unknown | unknown | n/a or unknown | n/a or unknown |
| Domain | unknown | unknown | unknown | `aloeducation.com` (email, reported) |
| Database | unknown | unknown | unknown | unknown |
| Storage | unknown | unknown | unknown | unknown |
| Backup | unknown | unknown | unknown | unknown |
| Monitoring | none connected | none connected | none | none |

## 2. Ambiguity register — must fail safe, never guess

| Ambiguity | Risk | Rule applied |
|---|---|---|
| `marketingos` on A **and** B | cannot tell which is production | **`PRODUCTION LOCATION UNVERIFIED`** |
| `alo-learning` on A **and** B, both differing in state | same | **`PRODUCTION LOCATION UNVERIFIED`** |
| `friendconnect` on A **and** B | same | **`PRODUCTION LOCATION UNVERIFIED`** |
| `friendconnect` vs `friendconnect-soc…` | truncated name; could be a distinct service or a suffix duplicate | list both, resolve neither |
| `hosting.alolabs.net` → which host? | domain is not identity | **unresolved** |

Per the brief, every operation must target a uniquely identified server **and**
project, and ambiguous targets must fail safely. Three project names in this
inventory are ambiguous today, so **no command may target them**.

## 3. Duplicate and orphan candidates — identified, not acted on

| Candidate | Status |
|---|---|
| `marketingos` ×2, `alo-learning` ×2, `friendconnect` ×2 | duplicates — **never deleted automatically** |
| Possible unallocated LVM (~374 GB on A) | not a project; recorded so nobody assumes it is free space |
| `/mnt/ssd2` possibly unmounted | would make "project storage there" an illusion |

## 4. Single points of failure

| SPOF | Affects |
|---|---|
| Office power | A and B simultaneously |
| Office internet / ISP | A and B simultaneously |
| One HDD on B (root is a single Hitachi) | every B project |
| No verified backups anywhere | everything |

## 5. Verification command set (read-only, needs A-6)

```bash
for d in ~/projects/* /opt/*/ ~/*/ ; do
  [ -d "$d/.git" ] && git -C "$d" rev-parse --abbrev-ref HEAD \
    && git -C "$d" rev-parse HEAD && git -C "$d" status --porcelain | head -3
done
pm2 jlist | jq -r '.[] | [.name, .pm2_env.pm_cwd, .pm2_env.status] | @tsv'
ss -tlnp | awk 'NR>1{print $4, $6}'
```

`pm_cwd` is what turns a process name into a directory, and a directory into a
repository — the first real link in the chain.
