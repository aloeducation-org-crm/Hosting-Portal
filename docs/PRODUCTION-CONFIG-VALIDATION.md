# Production configuration validation

`src/lib/config/production-config.ts` answers one question before a release:

> Is this host configured the way we say it is, and is anything dangerous switched on?

It returns a **redacted** report. `scripts/validate-prod-config.mjs` prints it.

```bash
# Ambient environment (a PM2 systemd unit, a shell, CI):
npm run config:validate

# The real production baseline, read from the panel's env file without sourcing it:
node scripts/validate-prod-config.mjs \
  --env-file /etc/alo-hosting/panel.env \
  --app-dir "$HOME/Hosting-Portal" \
  --check-paths

# A release gate that also fails on warnings:
node scripts/validate-prod-config.mjs --env-file /etc/alo-hosting/panel.env --fail-on-warnings
```

Exit codes: `0` no errors, `1` at least one error (or a warning, with
`--fail-on-warnings`), `2` bad usage or an unreadable env file.

## The redaction guarantee

The report contains only:

* environment variable **names**,
* severities and fixed, value-free messages,
* structurally derived facts — a URL's scheme, the application port, whether two
  URLs agree, whether a database file is inside the Git checkout, whether a
  secret is `set` / `unset` / `placeholder` / `weak`,
* things that are public by definition, such as the application's own hostname.

It never contains a secret, a token, a cookie value, a private key, a database
path or a connection string. `tests/production-config.test.ts` asserts this by
placing distinctive values in the environment and proving none of them appear in
the serialized report or the CLI's stdout.

The env file is **parsed, not sourced**: no `source`, no `eval`, no command
substitution. A hostile `.env` cannot execute anything, which is asserted with a
canary file in `tests/production-config.test.ts`.

## What it checks

| Area | Errors | Warnings |
| --- | --- | --- |
| Application URLs | `APP_URL` / `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` missing, not absolute, not `https` in production, or disagreeing with each other | `PORT` not a plain integer |
| Secrets | `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET` missing, or still a documented placeholder / CI-only value | a secret shorter than 32 characters |
| Browser leakage | a `NEXT_PUBLIC_*` variable whose name says secret, or whose value equals a server secret | — |
| Database | no `DATABASE_URL`; a relative SQLite path; an unsupported scheme; a missing SQLite file (`--check-paths`); the database **inside the Git checkout** | PostgreSQL configured (the shipped datasource is SQLite); the in-checkout database accepted via `ALLOW_DB_IN_CHECKOUT=1` |
| Directories | a configured directory that exists but is not writable | a directory that is missing or not absolute |
| AI | `AI_ALLOW_ANONYMOUS=true` | — (and `info`: no provider configured; `AI_FREE_ONLY=false`; a paid key that `AI_FREE_ONLY` will not use) |
| Deploy binding | `DEPLOY_BIND_HOST` not loopback in production; `DEPLOY_ALLOW_LOCAL_SOURCE=true`; `CORS_ALLOWED_ORIGINS=*` | non-loopback bind outside production |
| Hardening flags | `ALLOW_INSECURE_WEBHOOK_HTTP=true`; `ALLOW_PREVIEW_EMBED=true` | `SSO_ENABLED=true`; `DEPLOY_DISABLE_BOOT_RESTORE` not `true` |
| Limits | — | upload limit above 1 GiB; rate limit above 10 000 requests |

`info` findings are not problems. They exist so a deliberately disabled
capability is reported rather than hidden: with `AI_PROVIDER=none` the report says
that no provider is configured, which is exactly what `/api/ai/status` returns
(`UNCONFIGURED`) and what an AI request must reflect. Nothing in this system may
claim that inference happened when no provider processed it.

## The finding that matters on the current host

The documented production baseline is:

```
DATABASE_URL=file:/home/alamin/Hosting-Portal/prisma/db/hosting.db
```

That path is **inside the Git checkout**, and two independent controls already
refuse it:

* `scripts/deploy-release.sh` fails closed with *"the production database is
  inside the Git checkout … a checkout reset would destroy live data"* unless
  `ALLOW_DB_IN_CHECKOUT=1` is set deliberately;
* this report classifies it as an **error** for the same reason.

`git reset --hard` during an inline deployment rewrites the working tree, and the
running application keeps writing to the SQLite file, so the checkout is also
never clean enough for a pull. The safe fix is an operator action on the host, in
a maintenance window, and it is deliberately not automated here:

1. stop the panel (`pm2 stop alo-hosting-portal`);
2. take a consistent copy of the SQLite file and verify it (`sqlite3 … "PRAGMA
   integrity_check"`, see `docs/DATABASE-RECOVERY-RUNBOOK.md`);
3. move it outside the tree, e.g. `/var/lib/alo-hosting/hosting.db`, with
   `chown alamin:` and mode `0640`;
4. set `DATABASE_URL=file:/var/lib/alo-hosting/hosting.db` in
   `/etc/alo-hosting/panel.env`;
5. start the panel, re-run this report until the `DATABASE_URL` error is gone, and
   then deploy.

Until step 4 happens, a deployment can only proceed with `ALLOW_DB_IN_CHECKOUT=1`,
which takes a restore copy of the database before it moves the tree. That is a
deliberate, audited acceptance of risk — not a fix.
