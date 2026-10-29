# Complete project inventory

**Every entry is `[REPORTED]`.** No process was queried; no repository was opened
on a host; no directory was listed. This is an *inventory of leads*, and the
registry renders it as `OBSERVED` → `STALE`, never `VERIFIED`.

## 1. Reported PM2 workloads

### Server A — 7 processes, 2 failing

| Project | State | Mem | Restarts | Repo/branch | Domain | Production? |
|---|---|---|---|---|---|---|
| `alaminn` | online | ~77.1 MB | 0 | unknown | unknown | **unverified** |
| `alo-desktop` | online | ~66.5 MB | 0 | unknown | unknown | **unverified** |
| `alo-hosting` | online | ~76.9 MB | 0 | unknown | unknown | **unverified** |
| `alo-learning` | **errored** | — | 15 | unknown | unknown | **unverified** |
| `alo-sub-apps` | online | ~67.5 MB | 0 | unknown | unknown | **unverified** |
| `friendconnect` | online | ~77.2 MB | 0 | unknown | unknown | **unverified** |
| `marketingos` | **errored** | — | 15 | unknown | unknown | **unverified** |

### Server B — 5 processes, names/counts truncated in source

| Project | State | Mem | Restarts | Notes |
|---|---|---|---|---|
| `agentos-app` | online | ~142.3 MB | 0 | |
| `alo-learning` | online | ~93.7 MB | `299…` | **same name as a failing process on A** |
| `friendconnect` | online | ~93.5 MB | 0 | **also on A** |
| `friendconnect-soc…` | online | ~113.8 MB | — | name truncated |
| `marketingos` | online | ~89.3 MB | `301…` | **also on A, where it is errored** |

## 2. Findings that matter more than the list

**F-1 · Three projects exist on both servers with different states.**
`alo-learning`, `friendconnect` and `marketingos` appear on A and B. `marketingos`
is **errored on A and online on B**; `alo-learning` likewise inverted. Two copies
of the same application running simultaneously is a split-brain risk for any shared
database, and it means "which one is production" has two candidate answers today.
This must be resolved before any project is described as deployed.

**F-2 · Truncated restart counts are a health signal, not a formatting detail.**
`299…` and `301…` indicate sustained restart loops. A process showing `online` with
300 restarts is not healthy; it is crash-looping and currently in its brief running
phase. The inventory records them as-is and flags them rather than rounding to
"online".

**F-3 · The same process name does not mean the same code.** Until the git SHA and
working-tree state of each directory are read, two `marketingos` entries may be
different builds, different branches, or one abandoned copy.

**F-4 · No domain is mapped to any process.** Nothing in the reported material
links a project to a public endpoint. Every public URL claim is therefore
unverified.

## 3. Not discovered at all

| Server | Reason |
|---|---|
| C (Hostinger) | no provider access; may host websites, unknown |
| D (cPanel) | no provider access; may host email only |

## 4. Schema this list will fill in

When discovery runs, each project needs: repo URL, branch, deployed SHA, working
tree state, runtime + version, process manager + name, PID, port, bind address,
domain, reverse-proxy route, environment class, deploy workflow, artifact, health
endpoint, last successful check, CPU/RAM/disk/restarts, database engine +
dependency, storage deps, scheduled jobs, owner, evidence source, observedAt.

Populated: **none**. See `PROJECT-TO-SERVER-MAP.md`.
