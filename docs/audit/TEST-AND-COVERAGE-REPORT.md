# Test and Coverage Report

> Measured at `b5a523e` on 2026-11-12. Every number below came from a command run
> in this session; where a number is absent, it is absent because no tool
> produces it, and that is stated rather than guessed.

## 1. Headline result

```
$ npm test          # vitest run
 Test Files  74 passed (74)
      Tests  1174 passed | 1 skipped (1175)
   Duration  82.38s
```

| Gate | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **74 files / 1174 passed, 1 skipped** |
| Type check | `npx tsc --noEmit` | **clean** (strict, `noUncheckedIndexedAccess`) |
| Lint | `npx eslint src/` | **clean** |
| Env/repo audit | `npm run audit:repo` | **17/17 checks passed** |
| Full gate | `npm run verify` | lint + typecheck + test + build + build:worker + audit:repo |

Test code: **20,493 lines across 74 files**.

## 2. The single skipped test

```
tests/build-isolation.test.ts:301
it.skipIf(!enabled)("hides a host file from a build running in a namespace", …)
```

`enabled` is true only when a working namespace sandbox (`bwrap`, `unshare` or
`sandbox-exec`) is present. This sandbox has none — user namespaces are denied at
the OS level. The test is skipped, **not deleted and not weakened**, so it will
run on any host that can create a namespace. This is the only honest way to hold
that assertion without pretending to have proven containment.

## 3. What is deliberately *not* claimed

- **No line-coverage percentage is reported.** No coverage provider is installed
  or configured (`vitest.config.ts` has no `coverage` block, `package.json` has
  no coverage script). Producing a number would mean installing a tool and
  inventing a target, so none is stated. A future task can add
  `@vitest/coverage-v8` and report real figures.
- **No end-to-end browser suite** is configured. Route behaviour is tested at the
  handler and middleware level; no Playwright/Cypress run exists.
- **No real-vendor integration test** runs (see `INTEGRATION-STATUS.md`).

## 4. Suites that carry the security guarantees

| Suite | Cases | Guarantee |
|---|---|---|
| `tests/billing-entitlements.test.ts` | 26 | no path grants a paid plan without a verified authorization |
| `tests/build-isolation.test.ts` | 23 | argv-only construction, fail-closed policy, secret-name refusal, namespace escape (skipped) |
| `tests/agent-task-signing.test.ts` | 23 | forged/replayed/tampered agent messages refused |
| `tests/deploy-tenant-isolation.test.ts` | 23 | cross-tenant connection access denied |
| `tests/account-verification.test.ts` | 21 | unverified accounts refused; `RESELLER` not self-selectable |
| `tests/health-reporting.test.ts` | 21 | schema-behind vs unreachable; identifier validation |
| `tests/client-identity.test.ts` | 20 | spoofed forwarding headers ignored by default |
| `tests/csrf.test.ts` | 24 | cross-site mutating requests refused |
| `tests/migration-safety.test.ts` | 27 | additive contract, interrupted-recovery, lock, `--check`/`--verify` |
| `tests/orchestrator.test.ts` | 32 | durable jobs, leases, retries, approvals, dead letter |

## 5. Mutation check of the new tests

Each security suite was written *after* the defect was real, and the fix was
reverted mentally or in-task at least once during development. Two concrete
examples preserved from the session:

- `decideVerificationAccess`'s exempt tier initially returned `{allowed:false}`.
  Only the test that drives the **real** `@/proxy` module caught it — the unit
  test of the policy alone passed. This is why the integration cases exist.
- The `/api/auth/` prefix initially carried a trailing slash and failed to match
  `/api/auth/verify-email`, locking every user out of email verification mid-flow.

## 6. Gaps, ranked

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | No coverage measurement | Low | Add `@vitest/coverage-v8`, set a floor, report it |
| 2 | No end-to-end browser test | Medium | Playwright against the dev server for the five core flows |
| 3 | No real-vendor integration test | High (blocked) | Land with the credentials in `INTEGRATION-STATUS.md` §3 |
| 4 | Namespace containment unverified | High (environment) | Run `tests/build-isolation.test.ts` on a host with `bwrap` |
| 5 | No load/soak test | Medium | Measure the rate limiter and worker backlog under load |
| 6 | No restore drill in CI | High | Drive a backup → destroy → restore cycle on a scratch DB |

## 7. Reproducing this report

```bash
npm ci --no-audit --no-fund
npm test
npx tsc --noEmit
npx eslint src/
npm run audit:repo
npm run verify        # full gate, includes production build
```

The numbers in §1 are from `npm test` at this commit. `npm run verify` also runs
the production build and the worker bundle; it passed on `main` in CI and is the
gate a release must satisfy.
