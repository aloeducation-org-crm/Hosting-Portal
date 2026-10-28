# Incident: two Next.js sites crash-looped after deploy (2026-10-27)

**Status:** mitigated by `scripts/repair-nextjs-site.sh`; permanently prevented in detection, packaging and deploy scripts.
**Host:** alo-server-lap (Ubuntu 22.04, Nginx 1.18, PM2 7.1.1, Node v22)
**Affected:** `alo-learning` → learn.aloeducation.com:3060, `marketingos` → marketing.alolabs.net:3061

## Symptoms

The deploy log reported `Build exit code: 0` for both applications, then:

```
ALO-LEARNING health: HTTP 000
MARKETINGOS health: HTTP 000
```

and `pm2 status` showed both processes `errored` with **15 restarts** and `0b` memory:

```
3|alo-lear | Error: Cannot find module '/home/aloedu/projects/ALO-LEARNING-JOURNEY/.next/standalone/server.js'
4|marketin | sh: 1: bun: not found
```

`ss -tlnp` confirmed neither port was ever bound (only unrelated services on 3011/3014).

## Root cause

Both `package.json` files declared the same start script, which is what this
repository's own deploy guide (`scripts/generate-deploy-guide-v2.py`, Chapters 5
and 9) instructed operators to publish:

```json
"start": "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
```

`scripts/deploy-new-site.sh` then ran `pm2 start npm --name <app> -- start`. PM2
therefore supervised `npm`, which spawned `sh`, which ran a **pipeline**. Three
independent failures hid behind one line of log output:

| # | Failure | Effect |
|---|---------|--------|
| 1 | `bun` is not installed on the host | `sh: 1: bun: not found` → immediate exit |
| 2 | the pipeline's exit status is `tee`'s, not the server's | PM2 never observes the real process; restarts loop to `max_restarts` |
| 3 | `.next/standalone/server.js` was not produced at that path | `MODULE_NOT_FOUND`, while `next build` still exits 0 |

Cause 3 is a Next.js behaviour: it emits the standalone bundle at
`.next/standalone/server.js` only when the output file tracing root **is** the
app directory. When a workspace/root lockfile sits above the app, Next infers a
higher root and writes `.next/standalone/<subdir>/server.js` instead. The build
succeeds; the start command points at a file that does not exist.

The `HTTP 000` lines in the deploy log were a health check executed before either
process could bind a port, so nothing in the pipeline ever contradicted the
"success" message.

## Immediate repair

Run on the host, from a checkout of this repository:

```bash
# ALO Learning Journey
./scripts/repair-nextjs-site.sh \
  --app alo-learning \
  --dir ~/projects/ALO-LEARNING-JOURNEY \
  --port 3060 \
  --domain learn.aloeducation.com

# MarketingOS
./scripts/repair-nextjs-site.sh \
  --app marketingos \
  --dir ~/projects/MarketingOS \
  --port 3061 \
  --domain marketing.alolabs.net
```

The script is idempotent and does not modify application source. It:

1. prints the current PM2 record (status, restarts, script, interpreter);
2. diagnoses the declared `scripts.start` (shell pipeline? missing runtime?);
3. locates the real standalone bundle, including the nested case;
4. stages `.next/static` and `public/` **into** the bundle (`next build` never
   copies them — without this the site serves HTML and 404s every asset);
5. writes `ecosystem.alo.cjs` with an argv `script` + `interpreter: "node"`;
6. deletes the broken PM2 entry and re-creates it from that file (a plain
   `pm2 restart` would silently keep running the old broken `npm` script);
7. health-gates on real HTTP and prints the PM2 log tail if it fails.

If the build output is missing entirely, add `--build` (or run the project's
build first). `--dry-run` shows the plan without changing anything.

`bun` is still a legitimate requirement of these projects (they commit a bun
lockfile), so provisioning it is a host task, not an app workaround:

```bash
curl -fsSL https://bun.sh/install | bash   # or re-run the repair with --install-bun
```

It is **not** required to run the site: the standalone server is a Node script.

## Verification

```bash
pm2 status                                   # both online, restart count stable
ss -tlnp | grep -E '3060|3061'               # both bound on 127.0.0.1
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3060/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3061/
curl -I https://learn.aloeducation.com
curl -I https://marketing.alolabs.net
```

Repeat the health check after two minutes: a healthy process must not accumulate
restarts.

## Prevention (changes in this branch)

| Area | Change |
|------|--------|
| `src/lib/deploy/start-command.ts` | New resolver: parses `scripts.start`, strips env prefixes and shell plumbing, validates the entry path, and always returns an argv command with `node`. |
| `src/lib/deploy/detect.ts` | Next.js detection uses the resolver instead of copying `scripts.start` verbatim; emits warnings for pipelines and missing static staging. |
| `src/lib/deploy/engine.ts` | `prepareNextStandalone()` locates a nested bundle (and says so), stages `.next/static` + `public`, and fails the `package` stage with an actionable message instead of publishing an unbootable release. Packaging no longer deletes `.next/static` from inside a standalone bundle. |
| `scripts/resolve-start-entry.mjs` | Same rules as a CLI, plus PM2 ecosystem generation, used by both shell entry points. |
| `scripts/deploy-new-site.sh` | Refuses to start an app with an unresolvable entry; provisions bun/pnpm from the committed lockfile; never uses `pm2 start npm -- start`; health-gates before printing success. |
| `scripts/repair-nextjs-site.sh` | The runbook above, as an idempotent script. |
| `scripts/generate-deploy-guide-v2.py` | Guide no longer publishes `bun … | tee` as a PM2 start command; documents the static-asset copy and the health check. |
| `tests/deploy-start-command.test.ts`, `tests/resolve-start-entry.test.ts`, `tests/deploy-detect.test.ts` | Regression cover for the exact incident manifest. |

## Rules of thumb

1. A process supervisor runs **argv**, never a shell pipeline. If a start script
   contains `|`, `&`, `;` or `>`, it is not a start command — it is a shell program.
2. `npm run start` inherits the same problem when `start` is a pipeline; resolve
   the real entry point instead.
3. Next.js standalone needs `.next/static` and `public` copied **into the bundle**.
4. `next build` exiting 0 does not mean a runnable bundle exists. Check for
   `server.js` and pin `outputFileTracingRoot` to the app directory.
5. A deploy is not finished until an HTTP health check returns 2xx from the port
   the proxy targets.
