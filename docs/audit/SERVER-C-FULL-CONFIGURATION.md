# Server C — Hostinger · full configuration profile

**Evidence status: NO PROVIDER EVIDENCE.** The adapter exists; it has never made a
live call. Every figure below is an owner-reported **plan claim**, not a measured
resource.

**Registry record:** `SERVER_C` in `src/lib/infrastructure/server-inventory.ts`
**Blocked by:** B-3 (product tier), A-3 (console evidence)

| Field | Value | Status |
|---|---|---|
| Label | Server C | `[REPORTED]` |
| Provider | Hostinger | `[REPORTED]` |
| **Product tier** | **unknown** — shared / Cloud / VPS unresolved | `[BLOCKED]` |
| Hostname | unknown | `[BLOCKED]` |
| Account reference | unknown | `[BLOCKED]` |
| Region / DC | unknown | `[BLOCKED]` |

## Plan claims — not utilisation

| Claim | Value |
|---|---|
| CPU | 4 cores |
| RAM | 4 GB |
| Disk | 100 GB |
| Inodes | 2,000,000 |
| Websites | unlimited (per plan) |
| Max processes | 200 |
| PHP workers | 100 |
| Bandwidth | unlimited |

**These are ceiling limits, not usage.** They say nothing about what the account
is currently consuming. A plan permitting 200 processes does not mean 200 are
running. `actualUtilization` is recorded as `UNKNOWN` in the registry, and no
percentage is derived from these numbers.

## Why the tier decides everything

The first question is not "how much RAM" but "what is this product":

| Tier | Root | SSH | Docker | PM2 | Custom daemons |
|---|---|---|---|---|---|
| Shared / Cloud Web Hosting | no | restricted (often SFTP only) | no | **no** | no |
| VPS | yes | yes | yes | yes | yes |

If Server C is shared hosting — the most likely case for a 4-core / 4 GB / 100 GB
plan in this price bracket — then **none** of the container or process-management
design applies to it, and the brief's warning is exactly right: it cannot be
treated as a Docker host. `[BLOCKED]` until A-3.

## Discovery steps once authorised

1. From hPanel, record: plan name, product type, account reference, server
   hostname, data-centre region. Screenshot or export, do not retype.
2. Determine supported access: SSH enabled? API token? hPanel only? SFTP?
3. If SSH is available, run the OS-visible checks and **compare against the plan**:

```bash
nproc; free -h; df -h; node -v 2>/dev/null; php -v | head -1
```

4. Record measured vs claimed side by side, and leave any metric the provider does
   not expose as `UNKNOWN` rather than inferring it.

Existing adapter: `src/lib/providers/hostinger.ts` (token auth against
`developers.hostinger.com`). `src/lib/providers/registry.ts` tracks
`VerifiedAt` and refuses to report a provider as verified without one — that
mechanism should gate this server, so it cannot be marked verified by assertion.

## Prohibited without approval

No settings change, no DNS change, no database change, no file change, no plan
change. Discovery is read-only.
