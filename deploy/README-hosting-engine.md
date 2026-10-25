# Hosting lifecycle deployment notes

This repository now contains the implementation and deployment artifacts; no privileged host changes are made by a checkout, build, or test run. Install scripts and units only when you intentionally deploy them on a Linux host.

## Node 20 isolated stack

`Dockerfile.node20` and `docker-compose.node20.yml` build and run the app on Node 20, expose it on loopback TCP/8080, and use a persistent SQLite volume. Prepare a real (untracked) env file with production secrets, then run:

```sh
cp deploy/env/alo-hosting-panel.env.example deploy/env/alo-hosting-panel.env
# Edit the file: set unique NEXTAUTH_SECRET, JWT_SECRET, and SSL_STATUS_HOOK_TOKEN values.
docker compose -f docker-compose.node20.yml up -d --build
```

The one-shot `db-init` service applies `prisma/schema.prisma` with `prisma db push --skip-generate`, sets the data volume owner to the runtime UID, and creates an initial SUPER_ADMIN with a cryptographically random 32-character password. It never uses `--accept-data-loss` or publishes a default password. The credential file is stored mode 0600 at `/var/lib/alo-hosting/admin-credentials`; retrieve it as the host operator with `docker compose -f docker-compose.node20.yml run --rm --no-deps --entrypoint cat db-init /var/lib/alo-hosting/admin-credentials`, then move the password to an approved password manager and remove the file after confirming login.

## Host installation (Nginx + systemd)

1. Install a supported Node runtime, Nginx, Certbot, SQLite tooling and the dedicated `alo-panel` service account. Install the release under `/opt/alo-hosting/current`, ensure release files are readable by `alo-panel`, and create `.next/cache` owned by `alo-panel` so Next.js can persist runtime cache data.
2. Run the database bootstrap as root with `APP_DIR` pointing at the full checkout/release containing `db/custom.db`, `prisma/schema.prisma`, and full npm dependencies. The script preserves an existing DB, applies Prisma's non-destructive schema update, checks schema drift, and writes any generated 32-character admin password to a root-only file (not stdout).
3. Install `helpers/provision-site.sh` and `helpers/ssl-lifecycle.sh` using `helpers/install-helpers.sh`. Install and validate the matching sudoers policy with `visudo -c`; helper files and sudoers policy must remain root-owned and non-writable by `alo-panel`.
4. Create `/etc/alo-hosting/panel.env` from `deploy/env/alo-hosting-panel.env.example`, set owner `root:alo-panel`, mode `0640`, and set the same random hook secret in `/etc/alo-hosting/ssl-hook.token` as root:root mode `0600`.
5. Install `deploy/systemd/alo-hosting-panel.service`, run `systemctl daemon-reload`, then enable/start it. The unit listens on loopback port 3051, has `Restart=always` / `RestartSec=5s`, `LimitNOFILE=65535`, and a 2 GiB cgroup memory cap.

For the existing Actions deployment, the database bootstrap keeps its backward-compatible `alamin` account default. When adopting the hardened `alo-panel` unit above, set `ALO_APP_USER=alo-panel` (and `ALO_APP_GROUP=alo-panel` if needed) on the database bootstrap command, and ensure the account exists first.

## Validation and recovery behavior

`scripts/server-doctor.sh` is read-only and reports current runtime, proxy, DB access, upstream bind/listener, and sudoers checks. `scripts/validate-port-8080.sh` is a root-run periodic checker; its service/timer are in `deploy/systemd/`. Configure `/etc/alo-hosting/monitor.env` with the actual systemd service that owns port 8080, then enable the timer. It checks HTTP health and process RSS; on failure/threshold it requests a service restart, guarded by a cooldown.

A process exception is recovered by systemd's `Restart=always` policy; systemd kills the unit cgroup on OOM (`OOMPolicy=kill`) and starts a fresh process after five seconds. The new process receives fresh address space and can use memory up to `MemoryMax=2G`. This is **not** dynamic RAM allocation: neither this repository nor a single-node systemd service can add host RAM or shift workloads to another machine. Real horizontal/vertical scaling requires an external orchestrator/cloud autoscaler and a stateless/shared-storage architecture.

## Security and cross-origin policy

The middleware uses an exact allowlist from `CORS_ALLOWED_ORIGINS`; it does not reflect arbitrary origins or allow `*` with credentials. Same-origin requests work when the list is empty. `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` are configurable through environment variables. The private SSL callback uses constant-time bearer-token comparison and should not be exposed through a public proxy route except as a normal secret-protected API endpoint.
