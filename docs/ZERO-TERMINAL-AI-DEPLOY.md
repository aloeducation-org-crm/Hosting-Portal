# Zero-Terminal Built-In AI Deploy Assistant (`hosting.alolabs.net`)

`Hosting-Portal` ships a built-in **Zero-Terminal AI Deploy Assistant** at `/ai/assistant` (backed by `/api/ai/deploy-assistant` and `src/lib/ai/deploy-assistant.ts`) plus a global floating AI copilot (`AIChatWidget`) mounted across both the public landing page and authenticated dashboard.

Users can launch full-stack projects **without writing a single terminal or SSH command** — either by describing their application in plain English (planned via the OpenAI-compatible provider chain: GLM-5, UnoRouter, LLM7, Groq, OpenRouter, Qwen, Ollama) or by selecting a **1-Click Environment Preset**.

---

## Capability Mapping Across 10 Managed Visual VPS Benchmarks

| Benchmark Provider | Reference Capability | Built-In `hosting.alolabs.net` Implementation |
|---|---|---|
| **A2 Hosting** | Managed visual panels, automated backups & 1-click Node.js / Python environments | 1-click stack presets (`nodejs-api`, `python-app`, `nextjs-app`, `static-spa`, `php-cms`) + automated `CronJob` backup schedules (`every-6h`, `daily`, `weekly`) |
| **InMotion Hosting** | Automated control panel for multi-project sites, isolated databases & domains without terminal | Single-page visual launcher managing multiple `Website` records, per-project `Application` DB blueprints (`POSTGRESQL` / `MARIADB`), and `Domain` bindings |
| **SiteGround** | Automated visual dashboard with multi-tenant separation & built-in security | Isolated workspace paths (`/srv/alo-sites/<workspace-slug>/<domain>/current`) + `strict-waf` / `standard` security profiles |
| **Bluehost** | Simplified layout automating multi-site orchestration & seamless SSL setup | Unified visual form + 1-click Auto-SSL provisioning (`Domain.sslEnabled` + `SslCertificate` with `autoRenew: true`) |
| **DreamHost** | Custom panel automating server resources, custom domains & database setup | Visual CPU / RAM / NVMe tier selector (`Starter`, `Growth`, `Performance`) + custom domain & zero-code DB configuration |
| **FastComet** | Interactive guided setup, free global SSL & automated system optimizations | Plain-English AI blueprint generator + visual Edge Caching (`ALO_EDGE_CACHE`) & Brotli/Gzip (`ALO_COMPRESSION`) toggles |
| **Namecheap FastCloud** | Combined domain management with visual server partitioning | Automatic `*.apps.alolabs.net` subdomain generation or custom domain DNS verification + partitioned directory layout |
| **Liquid Web** | Automated server self-healing, rollback & zero-coding database configuration | Continuous `HealthCheck` endpoint registration (`/api/health` or `/health`), automatic rollback on failed verification, and automatic `DB_*` env wiring |
| **InterServer** | Lightweight visual stack selection at launch for full-stack web + DB setup | Instant 5-card visual stack selector pre-populating build commands, start commands, output paths, and recommended database engines |
| **HostGator** | Point-and-click organization of multiple project folders & company configs under one roof | Multi-company `Organization` workspaces grouping projects, teams, isolated folders, and `AuditLog` trails |

---

## Security & Operational Guarantees

1. **Human-Led, AI-Planned (No Prompt-Injection-to-Shell):**
   - `POST /api/ai/deploy-assistant` (`action: "plan"`) is strictly read-only planning: the AI returns structured JSON validated against `deployBlueprintSchema`.
   - Provisioning (`action: "deploy"`) only executes when an authenticated non-viewer user explicitly clicks **"Deploy Project Visually (No Terminal)"**.
2. **Allowlisted Inputs & Zero Shell Execution:**
   - Domains, database identifiers, git repositories, branches, output directories, environment keys, and build/start commands are validated with strict regular expressions that reject shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `>`, `<`, `\`) and path traversal (`..`).
3. **Honest AI Telemetry:**
   - AI-generated blueprints report the real upstream `provider`, `model`, `tokensUsed`, and `latencyMs`, and record token usage in `TokenUsage`.
   - 1-Click Stack Presets are explicitly labeled `source: "preset"` and work offline or without external API keys.
4. **Complete Audit Trail:**
   - Every zero-terminal provisioning writes an `AuditLog` entry (`action: "AI_ZERO_TERMINAL_PROVISION"`) recording actor identity, workspace slug, domain, SSL state, database engine, backup cron, and health check policy.
