# Real Ubuntu Lifecycle Proof

**Status: NOT TESTED.** No Ubuntu server was connected to this workspace. No test domain, certificate, database, service, firewall rule, cron job, backup, mail account or DNS record was created. This document is a test plan/evidence ledger, not a claim of success.

| # | Acceptance check | Result | Required evidence on a disposable Ubuntu VPS |
|---:|---|---|---|
| 1 | Server health/discovery | NOT TESTED | Captured API response matched with `uname -a`, `/etc/os-release`, `lscpu`, `free -b`, `df -hT`, `ss -lntup`, `systemctl --failed`, and uptime. |
| 2 | Create static test site | NOT TESTED | Operation ID + helper exit status + real `/srv/alo-sites/<domain>` contents/ownership + Caddy fragment. |
| 3 | Create database and user | NOT TESTED | MariaDB/Postgres query proving DB/user/grants; authenticated connection and audit record. Password excluded from evidence. |
| 4 | Create Node app | NOT TESTED | Real systemd unit, process PID, `ss` listener, bounded health request. |
| 5 | Reverse proxy | NOT TESTED | `caddy validate`, successful reload, `curl -i http://<domain>` and Caddy journal. |
| 6 | App process lifecycle | NOT TESTED | systemctl stop/start/restart and independent PID/port/HTTP verification after each step. |
| 7 | DNS | NOT TESTED | `dig A`, `dig AAAA`, `dig CNAME` as applicable, comparing expected public IP and TTL/propagation. |
| 8 | SSL | NOT TESTED | Certificate subject/SAN/issuer/expiry and `curl --fail https://<domain>` with verified chain. |
| 9 | Cron | NOT TESTED | Valid `/etc/cron.d` entry naming an unprivileged user, test-run timestamp/output and ownership review. Blocked pending cron helper correction. |
| 10 | Backup | NOT TESTED | Archive file, timestamp, bytes, SHA-256 and successful `tar -tzf`/DB dump validation. |
| 11 | Restore | NOT TESTED | Pre-restore snapshot, restored file/DB checksums, service health and rollback test after injected failure. |
| 12 | Suspend/resume | NOT TESTED | Real Caddy response/service status before, during and after; matching DB lifecycle state. |
| 13 | Logs | NOT TESTED | Bounded real journal/Caddy/app log lines; prove secrets are redacted and output/time limits enforced. |
| 14 | Firewall | NOT TESTED | `ufw status numbered` before/after; verify SSH management reachability from a second session. |
| 15 | Audit | NOT TESTED | DB audit row per privileged operation: actor, operation ID, target, status/exit code and sanitized output. |
| 16 | Delete/cleanup | NOT TESTED | Verify only intended systemd/Caddy/site/DB/cron resources removed; show no unrelated resources affected. |
| 17 | Failure/rollback | NOT TESTED | Inject invalid Caddy config, occupied port, DB unavailable and disk/permission failure; show rollback and preserved prior service. |

## Required test safeguards

- Use a disposable VPS and a domain controlled by ALO Labs; do not test against customer/production data.
- Keep a second verified SSH session and console access. Do not enable/alter UFW until SSH access rules are checked.
- Snapshot/backup host configuration first. Record server UTC time, package versions and sanitized logs.
- Never include passwords, private keys, tokens, `.env`, or full connection strings in proof artifacts.
- A passing HTTP response alone is insufficient: verify corresponding OS process, listener, Caddy/systemd state, database query, certificate metadata and audit row.
- Clean up only test-owned resources and verify each removal independently.

## Evidence template

For each test above, append: UTC timestamp; host identifier; app commit; operation ID; API/helper action; exit code; actual OS/database/DNS verification command and sanitized output; audit-row ID; rollback/cleanup result; reviewer. Mark PASS only after the real server-side state is independently checked. No evidence has been appended because no VPS test occurred.
