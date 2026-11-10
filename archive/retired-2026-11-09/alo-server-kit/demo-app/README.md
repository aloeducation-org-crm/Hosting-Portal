# alo-app (demo)

Demo Next.js 14 app deployed to `/srv/alo-app` on `alo-server-lap` via the
alo-server-kit, served by PM2 cluster (2 instances) behind Nginx.

## Local dev
```bash
npm ci
npm run dev
```

## Production (handled by the kit)
The kit's `02-webapp` stage builds & starts this app under PM2. GitHub Actions
triggers redeploy via SSH on every push to `main`.
