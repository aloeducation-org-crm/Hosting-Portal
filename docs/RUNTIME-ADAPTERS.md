# Runtime Adapters & Framework Detection

**Status:** detection implemented and unit-tested (`tests/deploy-detect.test.ts`,
`tests/deploy-pipeline.test.ts`, `tests/native-build.test.ts`). Detection is evidence-based on
repository contents — it never guesses a start command for ambiguous projects.

`src/lib/deploy/detect.ts` inspects the cloned repository (via an `FsReader`, so tests use
in-memory fixtures) and produces a `DetectionResult`: language, framework, package manager,
lockfile, install/build/start commands, output directory, env-var names, port (default 8080),
health path, **confidence**, and an **`ambiguous` flag with reasons and warnings**.

## Detected ecosystems (with detection signals)

| Ecosystem | Key files / signals | Notable output |
| --- | --- | --- |
| Next.js | `package.json` deps `next` | build `next build`, output `.next` |
| Nuxt | deps `nuxt` | `.output` |
| SvelteKit / Remix / Astro | deps `@sveltejs/kit`, `@remix-run/*`, `astro` | adapter-specific; warns to confirm output |
| Vite / CRA | deps `vite`, `react-scripts` | `dist` / `build` |
| NestJS / Express / Fastify / Koa / Hono | deps | `node`/`nest build` |
| Node (generic) | `package.json` + lockfile (npm/pnpm/yarn/bun) | start from `scripts.start` |
| Python: Django / FastAPI / Flask / generic | `manage.py`, `requirements.txt`/`pyproject.toml` with django/fastapi/flask | **ASGI/WSGI module never guessed** — operator confirmation required |
| Go | `go.mod` | `go-http` |
| Rust | `Cargo.toml` | `rust-cargo` |
| Flutter / Dart | `pubspec.yaml` | `flutter` (analytics) / `dart-server` |
| Android (Gradle) | `settings.gradle(.kts)` | `android-gradle` |
| PHP: Laravel / Composer | `artisan`, `composer.json` | `laravel` / `php-composer` |
| Docker | `Dockerfile` / compose | `docker` / `docker-compose` |
| Expo / Capacitor / React Native / Ionic | `app.json`, `capacitor.config.*`, deps | mobile artifact paths |
| Static HTML | no manifest found | serve directory as-is |

Supported-for-hosting runtimes in the panel are narrower than detectable frameworks: static,
PHP 8.2 (`WebsiteRuntime.PHP82`), Node, Next.js. "Detected" ≠ "deployable today" — the
deploy wizard offers only what the host can actually run.

## Rules that keep customers safe

1. **Never silently pick an unsafe build.** If confidence is low or the result is ambiguous,
   deploys require explicit manual configuration (install/build/start/output) instead of a guess.
2. **Python and SvelteKit always warn**: ASGI module and adapter output must be confirmed by the operator.
3. **Env names are collected from source** (`$_ENV[…]`, `process.env.X`-style scans) to pre-fill the
   env-var form — values are never read or printed.
4. **Port is 8080 unless evidence says otherwise**; health path defaults to `/` and is
   overridable per project.
5. **Manual override always wins** over detection (`src/lib/deploy/config.ts`).

## What is not claimed

- Detection ≠ a successful build. No adapter is "supported" until a real build+deploy is witnessed.
  Today: unit-tested detection; deploy pipeline integration-tested with fixtures; **no witnessed
  deploy for most frameworks** — see `docs/KNOWN-LIMITATIONS.md` L3.
- Native/CMake (OBS Studio) builds are planned by `src/lib/deploy/native-build.ts` and unit-tested;
  no full OBS compile has completed in verification.
