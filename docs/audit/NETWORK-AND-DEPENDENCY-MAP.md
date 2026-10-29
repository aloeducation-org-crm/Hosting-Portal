# Network and dependency map

**No address in this document was contacted.** `getent hosts` returns no DNS for
any of them from the control plane; `tailscale` is not installed there. A reported
address is a lead, not a route.

## 1. Reported addressing

| | A | B | C | D |
|---|---|---|---|---|
| LAN | `192.168.0.197` | `192.168.0.24` | — | — |
| Interface | `wlp0s20f3` (Wi-Fi) | `enp1s0` (ethernet) | — | — |
| Tailscale | `100.94.234.101` | `100.85.239.114` | — | — |
| Public IP | **not confirmed** | not confirmed | provider-managed | provider-managed |
| DNS resolvers | 8.8.8.8, 45.125.222.187 | not reported | — | — |
| Public endpoint | unknown | `hosting.alolabs.net` (reported) | unknown | unknown |

All `[REPORTED]`, none verified.

## 2. Why "reachable" is not established

| Claim | Test | Result |
|---|---|---|
| Tailscale reachability | `getent hosts 100.94.234.101`, `100.85.239.114` | **no DNS** |
| LAN reachability | `getent hosts 192.168.0.197`, `192.168.0.24` | **no DNS** |
| Tailnet membership | `command -v tailscale` | **absent** |
| `hosting.alolabs.net` | `getent hosts` | **resolves** — not contacted |

Resolution is not identity and is not authorisation. A-6 authorises a *host*
inspection; probing a public endpoint is a different action and was not taken.

## 3. Topology as reported

```
                 Internet
                    │
             office router / ISP
                    │
        ┌───────────┴───────────┐
     Server A                 Server B
   (laptop, Wi-Fi)          (desktop, ethernet)
  192.168.0.197            192.168.0.24
  100.94.234.101           100.85.239.114
                            hosting.alolabs.net ?
        └────── SAME POWER + SAME ISP ──────┘
                    │                        │
                Hostinger                cPanel
                (Server C)               (Server D)
               aloedu? unknown        aloeducation.com mail
```

The bracket is the important part: **A and B share a single power domain and a
single ISP link.** Losing either takes both off the internet. Neither is a
failover for the other, and any design that assumes otherwise is wrong.

## 4. Dependencies

| Dependency | Affects | Verified? |
|---|---|---|
| Office mains power | A, B | no |
| Office ISP link | A, B | no |
| Wi-Fi on A (`wlp0s20f3`) | A availability — a laptop on Wi-Fi drops on sleep/roam | no |
| Tailscale control plane | all remote admin of A, B | no |
| `hosting.alolabs.net` DNS record | any external reachability of B | no |
| Registrar account | domain resolution for all ALO domains | no — holder unknown (B-5) |
| cPanel account | `aloeducation.com` mail | no (B-4) |
| Hostinger account | Server C | no (B-3) |

## 5. Unknowns that block an honest network diagram

1. Does `hosting.alolabs.net` reach B directly, via Caddy/nginx on B, via a
   Cloudflare tunnel, or a different machine entirely?
2. Is there a purchased static public IP, and is it routed to the office router or
   still behind CGNAT? (The brief mentions a paid static IP; nothing here confirms
   it terminates anywhere.)
3. What listens on A and B, and on which bind addresses? A process bound to
   `0.0.0.0` on a laptop that joins untrusted Wi-Fi is a different risk from
   `127.0.0.1`.
4. Which of C or D terminates TLS for public domains?

**CGNAT check** matters most: if the office link is behind CGNAT, no inbound port
forwarding can work regardless of a static IP purchase, and the external gateway
path is mandatory rather than optional. It is unverified. `[BLOCKED]`

## 6. Read-only checks for the discovery session

```bash
ip -brief addr; ip route; cat /etc/resolv.conf | head -5
tailscale status; tailscale ip -4
ss -tlnp                                  # listeners + owning process
curl -s --max-time 5 https://ifconfig.me   # egress IP (one outbound request)
dig +short hosting.alolabs.net
dig +short TXT _dmarc.aloeducation.com; dig +short MX aloedu.com
sudo ufw status; sudo iptables -S | head -20
```

Compare the egress IP against the purchased static IP. If they differ, the static
IP is not terminating at the office and inbound hosting must go through an
external gateway or tunnel. Do **not** change router, firewall, or DNS settings to
test this.
