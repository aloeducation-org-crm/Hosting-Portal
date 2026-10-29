# Server D — cPanel & email infrastructure · full configuration profile

**Evidence status: NO PROVIDER EVIDENCE.** Adapter exists (`src/lib/providers/cpanel.ts`),
never called. **Blocked by:** B-4 (scoped API token), A-5 (account authority).

**Registry record:** `SERVER_D` in `src/lib/infrastructure/server-inventory.ts`

| Field | Value | Status |
|---|---|---|
| Label | Server D | `[REPORTED]` |
| Hosting interface | cPanel | `[REPORTED]` |
| **Provider** | **unknown — not assumed to be Server C** | `[BLOCKED]` |
| Hostname / primary domain | unknown | `[BLOCKED]` |
| Account identifier (non-secret) | unknown | `[BLOCKED]` |
| Classification | unknown (shared / reseller / VPS / dedicated) | `[BLOCKED]` |
| Email domain | `aloeducation.com` | `[REPORTED]` |
| Mailboxes / storage usage | unknown | `[BLOCKED]` |
| MX / SPF / DKIM / DMARC | **not inspected** | `[BLOCKED]` |
| TLS coverage | not inspected | `[BLOCKED]` |
| Backup retention / last backup | unknown | `[BLOCKED]` |

## Identity is genuinely unresolved

Nothing available supports any of these assumptions, and each would be a distinct
error:

- that Server D is the same account as Server C;
- that it is the same machine as Server B;
- that it hosts **any** website under `aloeducation.com`;
- that it hosts only email.

The only fact is that the operator reports `aloeducation.com` mail is here. The
registry therefore stores the provider as `UNKNOWN` and the class as `unknown`.

## What must not be touched

MX records, SPF/DKIM/DMARC, mail routing, mailbox settings, TLS certificates, and
DNS at the registrar are **out of bounds** without explicit approval. A website
deployment must never alter MX — that is how an outage becomes an email outage.

## Discovery once authorised

Read-only, via the cPanel API (never by pasting credentials into the dashboard):

| Query | Purpose |
|---|---|
| `list_pops` | mailbox inventory |
| `list_forwarders`, `list_aliases` | routing surface |
| `get_disk_usage` / `list_pops_with_disk` | quota + usage |
| `Email::list_mx` / DNS zone fetch | MX, SPF, DKIM, DMARC presence |
| `SSL::installed_hosts` | certificate coverage |
| `Backup::list_backups` | retention and last success |

Record only presence/absence and quota figures. **Never** retrieve message
contents or student data.

## Adapter readiness

`src/lib/providers/cpanel.ts` exists but a token is required. The token must be
least-privilege: mail and DNS-read scopes only, no account-management scope. It is
issued by the provider and held in the secret store — never committed, never
entered into a dashboard form, never logged.
