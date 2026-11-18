# Incident Response Runbook

> Severity classes, first actions, and the commands that actually exist. Nothing
> here requires a tool that is not in the repository.

## 1. Severity

| Sev | Definition | Response |
|---|---|---|
| **S1** | Data loss, cross-tenant exposure, host compromise, payment granted without payment | Immediate; notify owner; freeze deploys |
| **S2** | Panel down, deploys failing for all customers, DB unreachable | Within the hour |
| **S3** | One site down, agent offline, backup failure | Same day |
| **S4** | Degraded metrics, alert rule misfire | Next working day |

## 2. First five minutes (any severity)

```bash
# 1. Is the platform up, and if not, why?
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
curl -sS http://127.0.0.1:3000/api/health | jq '.checks[]? | select(.ok==false)'

# 2. Which process is wrong?
systemctl status alo-hosting-panel alo-automation-worker --no-pager
journalctl -u alo-hosting-panel -n 100 --no-pager
journalctl -u alo-automation-worker -n 100 --no-pager

# 3. Is the worker actually doing work, or just alive?
stat /run/alo-hosting/automation-worker.json
ls -l /var/lib/alo-hosting/
```

The `/api/health` `reason` field tells you which class of failure you have:

| Reason | Meaning | First action |
|---|---|---|
| `OK` | DB reachable, schema matches | Look elsewhere (app logic, proxy) |
| `DATABASE_UNREACHABLE` | cannot connect | check `DATABASE_URL`, disk, permissions |
| `SCHEMA_MISSING` | tables absent | wrong database file, or schema never applied |
| `SCHEMA_OUT_OF_DATE` | schema behind code | **do not** blindly migrate — read the migration audit |
| `QUERY_FAILED` | probe ran, query failed | check the database log |

A `503` is not an outage by itself; a `503` with `DATABASE_UNREACHABLE` is.

## 3. S1 playbooks

### 3.1 Suspected cross-tenant exposure

1. **Freeze** deploys: `sudo systemctl stop alo-automation-worker`.
2. Capture evidence *before* changing anything:
   ```bash
   journalctl -u alo-hosting-panel --since '-24h' --no-pager > /tmp/incident-panel.log
   sqlite3 "$DB_PATH" ".backup '/tmp/incident-$(date -u +%Y%m%dT%H%M%SZ).db'"
   ```
3. Denials are logged by `src/lib/deploy/connections.ts` with `connectionId` and
   `connectionOwnerId`:
   ```bash
   grep -i "cross-tenant\|connection.*denied" /tmp/incident-panel.log
   ```
4. Identify affected tenant ids from the log. Do **not** write into another
   tenant's audit feed while investigating.
5. Rotate the credentials that could have been exposed (Git connection tokens are
   the highest risk — they grant repository read).
6. Only after rotation, re-enable the worker.

### 3.2 Payment granted without payment

The platform has no payment provider configured, so a `paid` plan with a
`payment` authorization should be **impossible**. If one appears:

1. Query the entitlements audit trail (`transactionRef` is recorded per grant).
2. Check for any `admin_grant` that used a `payment` authorization.
3. Suspend the affected subscription, not the user's whole account.
4. The regression test that should have caught it is
   `tests/billing-entitlements.test.ts`; if it passed, the path is outside that
   suite's coverage — add a case before closing the incident.

### 3.3 Host compromise

1. Assume the panel is root-equivalent (18 passwordless sudo grants,
   `NoNewPrivileges=false`). **Treat the host as fully compromised.**
2. Isolate the host at the network layer; do not try to clean it in place.
3. Preserve disk image; rotate every credential the host could read
   (`/etc/alo-hosting/panel.env`, DB, agent secrets, Git tokens, TLS keys).
4. Rebuild from a known-good release; restore data from the last verified backup.
5. Post-incident: this is exactly what SEC-14 predicts. Do not accept "we cleaned
   it" as a resolution.

## 4. S2 playbooks

| Symptom | Check | Fix |
|---|---|---|
| Panel 502 from the proxy | `ss -lntp \| grep 3000` | start the unit; check the proxy upstream |
| Panel up, health 503 | `reason` field | follow §2 table |
| All deploys stuck `QUEUED` | `systemctl is-active alo-automation-worker`; heartbeat file mtime | restart the worker; check for a poisoned job |
| Deploys fail with `BUILD_ISOLATION_UNAVAILABLE` | `command -v bwrap; unshare -Ur true` | install `bubblewrap`; **do not** set `DEPLOY_BUILD_ISOLATION=auto` in production to "fix" it |
| Agent offline | agent unit + heartbeat | restart; check HTTPS reachability and clock skew (5-min envelope window) |

## 5. Things that make an incident worse

- Running a rebuild-class migration to "fix" `SCHEMA_OUT_OF_DATE` without a
  verified backup. That is how a schema drift becomes data loss.
- Setting `DEPLOY_BUILD_ISOLATION=auto` in production to unblock a build. It
  trades containment for convenience, silently.
- Editing the live database to revoke a session instead of locking the user;
  the JWT claim refreshes every 60 s, so a lock takes effect on its own.
- Restarting the worker mid-job without its drain window (the unit allows 1900 s
  for a reason).

## 6. After the incident

1. Write a timeline from journal logs with UTC timestamps.
2. State the **root cause**, not the symptom.
3. Add a regression test that fails on the root cause. If one cannot exist
   (configuration or host issue), say so and name the check that would catch it.
4. Update `docs/audit/ISSUE-AND-REMEDIATION-MATRIX.md` with the new row.
5. Do not close an S1 until the affected tenants have been told.
