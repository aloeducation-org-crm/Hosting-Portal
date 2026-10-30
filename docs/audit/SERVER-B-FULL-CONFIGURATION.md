# Server B — `hosting.alolabs.net` · full configuration profile

**Evidence status: ENTIRELY `[REPORTED]`.** No connection attempted; A-6 not granted.
`hosting.alolabs.net` resolves from the sandbox but was **not contacted** — DNS
resolution is not host identity, and A-6 authorises a host inspection, not a probe.

**Registry record:** `SERVER_B` in `src/lib/infrastructure/server-inventory.ts`
**Reported at:** `2026-10-29T00:00:00Z`.

| Field | Value as reported | Status |
|---|---|---|
| Label | Server B | `[REPORTED]` |
| Hostname | `hosting.alolabs.net` (domain reported; host behind it unverified) | `[REPORTED]` |
| Machine | generic desktop | `[REPORTED]` |
| Class | physical-desktop | `[REPORTED]` |
| Provider | **unknown** | `[BLOCKED]` |
| OS / kernel | Ubuntu 22.04.5 LTS, `5.15.0-198-generic`, x86-64 | `[REPORTED]` |
| CPU | Intel Core 2 Duo E7500, 2C/2T, 2.93 GHz | `[REPORTED]` |
| RAM | 8 GB installed (7.7 GiB detected) | `[REPORTED]` |
| HDD | Hitachi HDS72105 ~465.8 GB; root LVM ~456 GB | `[REPORTED]` |
| Root usage | ~74 GB used / ~363 GB free | `[REPORTED]` |
| `/boot` | ~2 GB | `[REPORTED]` |
| `sdb` | WD ~111.8 GB → `/mnt/ssd1` (~24 GB used / ~81 GB free) | `[REPORTED]` |
| `sdc` | WDS128G2G0A-00 ~119.2 GB → `/mnt/ssd2` FS ~117 GB (~26 MB used / ~111 GB free) | `[REPORTED]` |
| Swap | ~6 GB | `[REPORTED]` |
| Node | `v22.23.3` | `[REPORTED]` |
| LAN IPv4 / iface | `192.168.0.24` / `enp1s0` | `[REPORTED]` |
| Tailscale | `100.85.239.114` | `[REPORTED]` |

**Note on `100.85.239.114`:** this value also appears as the seeded `ip` in the
fabricated server record removed in Phase 0. Two different documents referring to
the same address is not corroboration — both trace back to the same operator
report.

## Reported PM2 processes

| Process | State | Memory | Restarts |
|---|---|---|---|
| `agentos-app` | online | ~142.3 MB | 0 |
| `alo-learning` | online | ~93.7 MB | truncated (`299…`) |
| `friendconnect` | online | ~93.5 MB | 0 |
| `friendconnect-soc…` | online | ~113.8 MB | — |
| `marketingos` | online | ~89.3 MB | truncated (`301…`) |

Names and restart counts are **truncated in the source** and must be read from the
live process list. A truncated `301…` is not evidence that a service is healthy;
it may be a restart loop.

## Resource concern

One historical snapshot reported **~99.6 % CPU**. A second observation suggested
it might be transient. Neither is proof of sustained saturation, and neither is
proof of health. It is a lead, recorded as such.

**Suitability:** a 2009-era dual-core is a poor fit for heavy build workloads.
Before assigning it any build or backup-staging role, measure. `[BLOCKED]`

## Failure-domain warning

Server B shares office power and internet with Server A. If the office loses
either, **both** become unreachable from the internet. Neither is an independent
external failover, and no HA design may treat them as separate failure domains.

## Refresh checklist — read-only, requires A-6

```bash
hostname; uname -srm; cat /etc/os-release | head -3
nproc; lscpu | grep -E 'Model name|Core|Thread|MHz'
free -h; swapon --show; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
df -h / /mnt/ssd1 /mnt/ssd2; sudo pvs; sudo vgs; sudo lvs
uptime; cat /proc/loadavg; vmstat 1 5
sudo smartctl -H /dev/sdb; sudo smartctl -H /dev/sdc   # disk health, benign
node -v; pm2 jlist | jq -r '.[] | [.name, .pm2_env.status, .pm2_env.restart_time] | @tsv'
ip -brief addr; tailscale status
ss -tlnp | head -30                                     # listening ports
sudo systemctl is-active caddy nginx 2>/dev/null
```

To resolve what `hosting.alolabs.net` actually points at:

```bash
dig +short hosting.alolabs.net
dig +short hosting.alolabs.net +trace | tail -5
```

Compare against the verified Tailscale identity. A domain pointing at a tunnel or
a reverse proxy is a different claim from a domain pointing at this host.

## Open questions

1. What is failing in the truncated PM2 process names, and are their restart
   counts recent or historical?
2. Is the ~99.6 % CPU snapshot reproducible, and if so what is consuming it?
3. Does `hosting.alolabs.net` reach this machine directly, via Caddy/nginx, via a
   tunnel, or somewhere else entirely?
4. Which of `/mnt/ssd1` and `/mnt/ssd2` holds real data versus a mount that is not
   actually mounted? (`~26 MB used` on a 117 GB FS is consistent with an
   unmounted mountpoint, which would silently write to the root filesystem.)
