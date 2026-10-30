# Server A — `alo-server-lap` · full configuration profile

**Evidence status: ENTIRELY `[REPORTED]`. Not one field has been observed by this
control plane.** No connection has been attempted; A-6 is not granted.

**Registry record:** `SERVER_A` in `src/lib/infrastructure/server-inventory.ts`
**Reported at:** `2026-10-29T00:00:00Z` — after 24 h every value below renders `STALE`.

| Field | Value as reported | Status |
|---|---|---|
| Label | Server A | `[REPORTED]` |
| Hostname | `alo-server-lap` | `[REPORTED]` |
| Machine | HP ZBook Firefly 14 G7 laptop | `[REPORTED]` |
| Class | physical-laptop | `[REPORTED]` |
| Provider | **unknown** — a hostname is not a provider | `[BLOCKED]` |
| OS / kernel | Ubuntu 22.04.5 LTS, `5.15.0-198-generic`, x86-64 | `[REPORTED]` |
| CPU | Intel Core i5-10310U, 4C/8T, 1.70 GHz base, 4.4 GHz max | `[REPORTED]` |
| RAM | 16 GB installed, 15 GiB detected | `[REPORTED]` |
| Storage | Samsung NVMe ~476.9 GB; EFI ~1 GB; `/boot` ~2 GB; LVM PV ~473.9 GB; root LV 100 GB; root FS ~98 GB | `[REPORTED]` |
| Root usage | ~32 GB used / ~62 GB free | `[REPORTED]` |
| Swap | ~4 GB, unused at snapshot | `[REPORTED]` |
| Node | `v24.22.1` | `[REPORTED]` |
| LAN IPv4 | `192.168.0.197` | `[REPORTED]` |
| Tailscale | `100.94.234.101` | `[REPORTED]` |
| Wi-Fi iface / adapter | `wlp0s20f3` / Intel Wi-Fi 6 AX201, driver 23.170.1.1 | `[REPORTED]` |
| Wi-Fi link | 5 GHz ch149 11ac, 780/433 Mbps, `ALO Education_5G`, WPA2-Personal | `[REPORTED]` |
| DNS servers | 8.8.8.8, 45.125.222.187 | `[REPORTED]` |
| Public IP | **not confirmed** | `[BLOCKED]` |

## Connection

| Item | Status |
|---|---|
| Authorised SSH access | **not established** |
| Username / endpoint | **unknown** |
| Approved SSH key | **unknown** |
| Reachability from control plane | **failed** — `getent hosts` returns no DNS for either address; `tailscale` binary absent |
| Blocked by | **A-6**, and no network route |

## Reported PM2 processes

| Process | State | Memory | Restarts |
|---|---|---|---|
| `alaminn` | online | ~77.1 MB | 0 |
| `alo-desktop` | online | ~66.5 MB | 0 |
| `alo-hosting` | online | ~76.9 MB | 0 |
| `alo-learning` | **errored** | — | 15 |
| `alo-sub-apps` | online | ~67.5 MB | 0 |
| `friendconnect` | online | ~77.2 MB | 0 |
| `marketingos` | **errored** | — | 15 |

Two processes are in a failed state and their restart counts are non-zero. The
cause of `alo-learning` and `marketingos` is **unknown** and is the highest-value
thing to collect once access exists.

## Capacity risk — this is not an independent failover

The machine is a **laptop on office power and Wi-Fi**. It cannot be described as
disaster recovery for Server B: both sit behind the same office supply and the
same ISP link, so a power cut or ISP outage takes both. This is recorded in the
registry as a `[REPORTED]` capacity risk and must stay visible in the dashboard.

The reported unallocated LVM capacity is **not** permission to resize the root
volume.

## Refresh checklist — read-only, requires A-6

```bash
hostname; uname -srm; cat /etc/os-release | head -3
nproc; lscpu | grep -E 'Model name|Core|Thread|MHz'
free -h; swapon --show; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
df -h /; sudo pvs; sudo vgs; sudo lvs
node -v; npm -v; pm2 -v
pm2 jlist | jq -r '.[] | [.name, .pm2_env.status, .pm2_env.restart_time, .monit.memory] | @tsv'
ip -brief addr; tailscale status
```

Then confirm identity **before** recording anything as verified: hostname, machine
model, and the Tailscale node identity must agree. An IP is not identity.

## What would change this document

One authorised read-only session + the cluster above. Until then every row stays
`[REPORTED]` and the registry reports this server with **zero verified facts**.
