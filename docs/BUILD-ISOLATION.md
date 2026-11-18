# Build Isolation Guide

**Status:** implemented and unit-tested on 2026-11-16 (`tests/build-isolation.test.ts`).
Kernel-level enforcement on a production host is **not re-verified** here — rehearse on staging.

## What the panel does before a build starts

Untrusted customer code is never executed on the control-plane host directly. The deploy
engine (`src/lib/deploy/engine.ts`) wraps every build command through the isolation layer in
`src/lib/deploy/sandbox.ts`:

| Mechanism | Linux | macOS | Notes |
| --- | --- | --- | --- |
| Namespace sandbox | `unshare --user --mount --pid [--net]` | — | loopback-only netns by default; rlimits optional (`DEPLOY_BUILD_RLIMITS=1`) |
| Bubblewrap | `bwrap` (if installed) | — | read-only system paths, fresh tmp workspace, no network unless allowed |
| sandbox-exec | — | `sandbox-exec` profile | denies network; read-only system paths |
| Policy | `DEPLOY_BUILD_ISOLATION=auto\|required\|unshare\|bwrap\|sandbox-exec\|none` | | `required` refuses to build when no isolation primitive exists; `none` is refused in production builds |

Resource bounds via `prlimit`: `DEPLOY_BUILD_MAX_CPU_SECONDS` (default 3600), address space,
process count, file size, open files. Build timeouts are enforced by the engine independently
(`DEPLOY_TIMEOUT_SECONDS`, default 1800).

## What isolation does and does not give you

- It confines **filesystem writes**, **process trees** and (by default) **network**.
- It is not, by itself, a guarantee against kernel exploits. Defense-in-depth on hosts:
  dedicated unprivileged build user, no control-plane secrets in the build environment,
  workspace wiped after each build, artifact checksums recorded.
- Build logs are redacted (`src/lib/deploy/redact.ts`) before persistence — but treat any
  secret echoed by a build script as compromised and rotate it.

## Operator checklist (host)

1. `id <build-user>` — non-root, no sudo.
2. `which unshare bwrap` — at least one present; else set `DEPLOY_BUILD_ISOLATION=required` so builds **fail closed**.
3. No `.env*`, helper tokens or Cloudflare/GitHub credentials visible to the build user.
4. `DEPLOY_BUILD_RLIMITS=1` set.
5. After a build: workspace directory removed; no orphan processes (`ps -u <build-user>`).

## Verification

```bash
npm test -- tests/build-isolation.test.ts   # argv construction, policy fail-closed, rlimit wiring
```

A green unit test proves the sandbox is **requested correctly**. Only a staging build with a
deliberately hostile fixture (write-to-etc, curl-to-metadata, fork bomb) proves it is **enforced**.
That host rehearsal is a required pre-production step and is tracked as a limitation
(L2/L16 in `docs/KNOWN-LIMITATIONS.md`).
