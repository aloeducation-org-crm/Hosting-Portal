# Self-Hosted AI Agent & Inference Platform Guide (`Hosting-Portal` + `alo-server-kit`)

> **Audit date:** October 2026 (`Agenta-AI/awesome-ai-agent-platforms` + upstream GitHub repository & `LICENSE` verification)  
> **Scope:** ALO Labs Hosting Portal (`https://hosting.alolabs.net`) and `alo-server-kit` Ubuntu server provisioning.  
> **Legal disclaimer:** License triage labels in this document are conservative engineering & operational risk classifications based on inspecting upstream `LICENSE` files and `enterprise/`/`ee/` directories. They are **not legal advice**. Obtain formal legal review before redistributing or white-labeling conditional/commercial software.

---

## 1. Architecture Overview: Three Distinct Layers

Self-hosted AI on ALO infrastructure separates **inference**, **portal-native execution**, and **tenant-isolated container runtimes** so a slow or unavailable local model never takes down the control plane:

1. **Inference Provider & Gateway Layer (`src/lib/ai/providers.ts`, `src/lib/ai/client.ts`)**
   - Unified OpenAI-compatible adapter supporting cloud/free tiers (`llm7`, `groq`, `openrouter`, `openai`, `unorouter`, `qwen`, `glm`) and opt-in local runtimes (`gateway` on `:4000`, `ollama` on `:11434`, `localai` on `:8080`/`:18080`).
   - Enforces metadata/wildcard SSRF blocking (`169.254.0.0/16`, `100.100.100.200`, `metadata.google.internal`, `0.0.0.0`, `[::]`), HTTP redirect blocking (`redirect: "error"`), capability-bounded `max_tokens`, per-provider circuit breakers, and `x-request-id` correlation IDs.
2. **Portal-Native Multi-Tenant AI & Workflow Layer (`src/lib/ai/automation/`, `/api/agents/*`)**
   - Built-in 15-agent catalog + deterministic DAG workflow runner (`maxSteps`, per-step timeouts, token budget caps).
   - Strictly tenant-scoped (`website.ownerId === user.id` for non-admins; `AiAgentRun` scoped to `user.id`).
3. **Zero-Terminal Self-Hosted Agent Container Layer (`src/lib/ai/self-hosted-agents.ts`, `src/lib/ai/deploy-assistant.ts`, `helpers/alo-docker-helper`)**
   - Deploys verified single-container presets with **pinned image tags**, **loopback-only port bindings** (`127.0.0.1:<hostPort>:<containerPort>`), **dropped Linux capabilities** (`--cap-drop=ALL`, `--security-opt=no-new-privileges:true`), **cgroup limits** (`--cpus`, `--memory`, `--pids-limit=512`), **named Docker volumes** (never host path mounts or `/var/run/docker.sock`), and **ephemeral `0600` `--env-file` secret injection**.

---

## 2. Revalidation of Candidate Platforms & Ecosystem Audit

Every candidate was audited against its upstream GitHub repository, release activity, `LICENSE`, and `ee/`/`enterprise/` directory structure:

| Platform | Category | Upstream Version Audited | License & EE Split | Triage Label | Multi-Tenant SaaS? | Portal Decision |
|---|---|---|---|---|---|---|
| **Langflow** (`langflow-ai/langflow`) | Visual Agent Builder | `v1.13.0` | MIT (no EE trap) | `License verified for intended use` | **Yes** | **ADD** (Primary visual builder preset) |
| **LibreChat** (`danny-avila/LibreChat`) | AI Coworker Workspace | `v0.8.8` | MIT | `License verified for intended use` | **Yes** | **ADD** (Compose stack for multi-user/white-label chat) |
| **LocalAI** (`mudler/LocalAI`) | Local Inference | `v4.12.1` | MIT | `License verified for intended use` | **Yes** | **ADD** (Provider registry + container preset) |
| **Ollama** (`ollama/ollama`) | Local Inference | `v0.40.11` | MIT (check model weight licenses separately) | `License verified for intended use` | **Yes** | **KEEP** (Hardened loopback preset + provider) |
| **Qdrant** (`qdrant/qdrant`) | Vector Memory DB | `v1.20.0` | Apache-2.0 | `License verified for intended use` | **Yes** | **ADD** (Vector memory preset with API key auth) |
| **Agno** (`agno-agi/agno`) | Python Agent SDK/OS | `v3.1.10` | Apache-2.0 | `License verified for intended use` | **Yes** | **ADD** (Recommended Python SDK) |
| **Pydantic AI** (`pydantic/pydantic-ai`) | Python Agent SDK | `v2.61.0` | MIT | `License verified for intended use` | **Yes** | **OPTIONAL** (Recommended typed Python SDK) |
| **vLLM** (`vllm-project/vllm`) | GPU Production Serving | `v0.32.0` | Apache-2.0 | `License verified for intended use` | **Yes** | **OPTIONAL** (Dedicated GPU nodes) |
| **Flowise** (`FlowiseAI/Flowise`) | Visual Agent Builder | `3.1.4` | Apache-2.0 core + **Commercial `packages/server/src/enterprise/`** | `Conditional, requires additional review` | **Conditional** (Single-tenant OSS only) | **OPTIONAL** (Gated behind license ack) |
| **Activepieces** (`activepieces/activepieces`) | Workflow Automation | `0.92.2` | MIT core + **Commercial `packages/ee/`** | `Conditional, requires additional review` | **Conditional** (MIT edition only) | **ADD** (Compose stack replacing n8n for OSS workflows) |
| **Agenta** (`agenta-ai/agenta`) | Eval & Prompt Ops | `v0.125.0` | MIT core + **Commercial `ee/`** | `Conditional, requires additional review` | **Conditional** | **OPTIONAL** (Compose stack for LLMOps) |
| **Langfuse** (`langfuse/langfuse`) | Tracing & Observability | `v4.70.1` | MIT Expat core + **Commercial `ee/`** | `Conditional, requires additional review` | **Conditional** | **OPTIONAL** (Heavy ClickHouse/Postgres Compose stack) |
| **LiteLLM** (`BerriAI/litellm`) | AI Gateway Proxy | `v1.106.4` | MIT core + **Commercial `enterprise/`** | `Conditional, requires additional review` | **Conditional** (OSS proxy features only) | **IMPROVE** (Fixed SQLite/`max_budget:0` bugs in `alo-server-kit`) |
| **LangGraph** (`langchain-ai/langgraph`) | Graph Agent SDK | `1.2.17` | MIT SDK; **LangGraph Platform Server commercial** | `Conditional, requires additional review` | **Yes (SDK only)** | **OPTIONAL** (Embed MIT SDK in apps; do not confuse with commercial server) |
| **CrewAI** (`crewAIInc/crewAI`) | Multi-Agent SDK | `1.15.30` | MIT SDK (AMP cloud proprietary) | `License verified for intended use` | **Yes (SDK only)** | **OPTIONAL** (Python library, not a web server) |
| **Letta / MemGPT** (`letta-ai/letta`) | Stateful Memory | `0.16.8` / `letta-code v0.34.24` | Apache-2.0 | `License verified for intended use` | **Yes** | **DEFER** (V1 server archived upstream during `letta-code` transition) |
| **AutoGen / AG2** (`microsoft/autogen`) | Multi-Agent SDK | `python-v0.7.5` | MIT (`LICENSE-CODE`) / CC-BY-4.0 (`LICENSE`) | `Conditional, requires additional review` | **Yes (SDK)** | **DEFER** (Converging with `microsoft/agent-framework`) |
| **Open WebUI** (`open-webui/open-webui`) | Chat Workspace | `v0.12.4` | **Open WebUI License** (Clause 4 branding restriction >50 users) | `Internal use recommended` | **No (white-label)** | **INTERNAL ONLY** (<=50 internal users, unmodified branding; `pipelines` stale) |
| **OpenHands** (`All-Hands-AI/OpenHands`) | Coding / SWE Agent | `v1.33.0` | MIT + `enterprise/` | `Internal use recommended` | **No on shared Docker** | **INTERNAL ONLY** (Requires `/var/run/docker.sock` or nested VM sandbox) |
| **n8n** (`n8n-io/n8n`) | Workflow Automation | `2.44.7` | **Sustainable Use License** + `.ee` | `Commercial permission required or potentially required` | **No** | **INTERNAL ONLY** (Internal ALO ops only; never resell hosted n8n) |
| **Dify** (`langgenius/dify`) | LLMOps Platform | `1.18.0` | **Dify Open Source License** | `Commercial permission required or potentially required` | **No (Explicitly prohibited)** | **REJECT** (Clause 1a forbids multi-tenant service without written Dify license) |
| **LobeChat** (`lobehub/lobe-chat`) | Chat Workspace | `v2.2.20` | **LobeHub Community License** | `Commercial permission required or potentially required` | **Conditional/Restricted** | **REJECT** (Use MIT LibreChat instead) |
| **Skyvern** (`Skyvern-AI/skyvern`) | Browser Automation | `v1.0.56` | **AGPL-3.0** | `Not approved pending legal review` | **Copyleft trigger** | **REJECT** (Use MIT `browser-use` in isolated worker instead) |
| **Rivet** (`Ironclad/rivet`) | Desktop Visual IDE | `app-v1.11.3` | MIT | `License verified for intended use` | N/A (Desktop app) | **REJECT** as hosted server preset (desktop IDE + TS SDK) |
| **SuperAGI** (`TransformerOptimus/SuperAGI`) | Autonomous Agent | `v0.0.14` | MIT | `Not approved pending legal review` | **No (Abandoned)** | **REJECT** (Unmaintained since Jan 2025) |
| **Drevon** (`csakash/drevon`) | Prompt Config CLI | `v0.2.0` | MIT | `License verified for intended use` | N/A (CLI scaffolder) | **REJECT** as hosted runtime (`npx drevon init` CLI tool only) |

---

## 3. 13-Use-Case Platform Decision Matrix

The programmatic matrix lives in `src/lib/ai/self-hosted-agents.ts` (`AGENT_PLATFORM_DECISION_MATRIX`) and is rendered in `/ai/self-hosted`:

1. **Non-technical visual / low-code agent builder:** **Langflow (`MIT`)** primary; Sim Studio (`Apache-2.0`) or single-tenant Flowise (`Apache-2.0` core) secondary. Avoid Dify for multi-tenant SaaS.
2. **Code-first Python / TypeScript agents:** **Pydantic AI (`MIT`)** or **Agno (`Apache-2.0`)** in Python; **Hosting Portal Workflow Engine** in TypeScript.
3. **Multi-agent orchestration:** **LangGraph SDK (`MIT`)** or **Agno Teams (`Apache-2.0`)**; CrewAI SDK (`MIT`) secondary. Always enforce `maxSteps` loop bounds.
4. **Persistent memory agents:** **Qdrant (`Apache-2.0`)** or **pgvector (`PostgreSQL`)** + **Mem0 OSS (`Apache-2.0`)**. Defer Letta standalone server until V2 packaging stabilizes.
5. **Workflow & business automation:** **Activepieces MIT Edition** (visual) or **Temporal (`MIT`)** / **Trigger.dev (`Apache-2.0`)** (durable code workflows). Never resell n8n without commercial license.
6. **Coding & DevOps SWE agents:** **OpenHands (`MIT`)**, **Goose (`Apache-2.0`)**, or **Cline (`Apache-2.0`)** strictly on **dedicated single-tenant VMs** — never on shared Docker hosts.
7. **Browser automation agents:** **Browser Use (`MIT`)** inside an isolated Playwright container with RFC1918/metadata egress firewalling. Avoid AGPL-3.0 Skyvern for SaaS.
8. **Customer support, CRM, & ALO Education assistants:** **Portal Native Agents + Qdrant/pgvector RAG + Self-Hosted/DPA Gateway**. Never send student PII, passport numbers, or financial records to anonymous free-tier APIs.
9. **Internal ALO team copilots:** **LibreChat (`MIT`)** (unlimited users) or **Open WebUI** (`<=50` internal users, original branding).
10. **Multi-tenant SaaS / white-label offerings:** **Langflow (`MIT`) + LibreChat (`MIT`) + Qdrant (`Apache-2.0`) + vLLM/Ollama/LocalAI (`Apache-2.0`/`MIT`)**.
11. **Air-gapped / strict data-residency local inference:** **vLLM / Ollama / LocalAI** with `AI_PROVIDER_ORDER=gateway,ollama,localai`, `AI_ALLOW_ANONYMOUS=false`, and zero external API keys.
12. **Low-resource VPS (`2–4 vCPU`, `4–8 GB RAM`, no GPU):** Thin orchestration on VPS + remote OpenAI-compatible inference (`Groq`/`OpenRouter`/dedicated GPU node). Do **not** co-locate ClickHouse, Dify, or `>=14B` local LLMs.
13. **Dedicated GPU production model serving:** **vLLM (`Apache-2.0`)** behind **LiteLLM OSS Gateway (`127.0.0.1:4000`)** with FP8/AWQ quantization and bounded `--max-model-len`.

---

## 4. Hardware, GPU/VRAM, KV-Cache, RAM, & Disk Sizing Guide

Implemented in `src/lib/ai/hardware-sizing.ts` (`calculateInferenceSizing`, `evaluateHardwareFit`). Total inference memory is **never** just model weights:

$$\text{Total VRAM} = (\text{Weights} + \text{KV Cache}(\text{context} \times \text{concurrency}) + \text{Runtime Overhead}) \times 1.12_{\text{fragmentation}}$$

| Profile | Model & Quant | Context × Concurrent Users | Weights | KV Cache | Total VRAM (incl. 12% reserve) | Min Sys RAM | Min Free Disk | Recommended Hardware |
|---|---|---|---|---|---|---|---|---|
| Edge / Helper | 3B `Q4_K_M` | `8K × 1` | ~1.7 GB | ~0.38 GB | **~3.7 GB** | 9 GB | 22 GB | 8 GB GPU or 8 vCPU + 16 GB RAM CPU-only (~8–15 tok/s) |
| Single-Tenant Assistant | 8B `Q4_K_M` | `16K × 4` | ~4.5 GB | ~8.0 GB | **~16.0 GB** | 12 GB | 28 GB | 1× 24 GB GPU (L4 / RTX 4090 / A10G) |
| Coding & Tool Calling | 14B `Q4_K_M` | `32K × 4` | ~8.0 GB | ~24.0 GB (FP16) / ~13.2 GB (FP8 KV) | **~25.5–37.9 GB** | 16 GB | 35 GB | 1× 48 GB GPU (L40S) or 24 GB GPU with FP8 KV & `<=16K` ctx |
| Departmental Agent Hub | 32B `AWQ-4bit` | `32K × 8` | ~17.3 GB | ~64.0 GB (FP16) / ~35.2 GB (FP8 KV) | **~62–94 GB** | 32 GB | 55 GB | 1× A100/H100 80 GB (with FP8 KV) or 2× L40S 48 GB |
| Enterprise Multi-Tenant | 70B `FP8` + `FP8 KV` | `32K × 8` | ~66.5 GB | ~44.0 GB (FP8 KV) | **~128 GB** | 96 GB | 160 GB | 2× A100 80 GB or 2× H100 80 GB (tensor-parallel) |

**CPU-only reality check:** On a 15 GB RAM host (`alo-server-lap`), `qwen2.5:7b` (`Q4_K_M`, `MemoryMax=8G`, `OLLAMA_NUM_PARALLEL=2`) fits alongside Nginx/PostgreSQL/Next.js for **1–2 concurrent internal users**, but `>=14B` models or high concurrency will exhaust RAM and swap-thrash the box.

---

## 5. Security, Sandboxing, SSRF, PII, & Data Residency Boundaries

1. **Loopback-only container & inference binding:** `alo-docker-helper run-hardened` rejects any port mapping not prefixed with `127.0.0.1:` and any host port `< 1024`. Ollama (`127.0.0.1:11434`), LiteLLM (`127.0.0.1:4000`), and LocalAI (`127.0.0.1:18080`) never bind to `0.0.0.0` on the host.
2. **Container sandboxing:** Every container deployed by the portal runs with `--security-opt=no-new-privileges:true`, `--cap-drop=ALL` (retaining only minimal `CHOWN/SETUID/SETGID/NET_BIND_SERVICE`), `--pids-limit=512`, `--cpus`, `--memory`, no `--privileged`, and **zero `/var/run/docker.sock` or arbitrary host-path bind mounts**.
3. **Ephemeral `0600` secret injection & API redaction:** Secrets are written to a temporary `0600` `--env-file` deleted immediately after `docker run`, never passed via CLI `-e` flags, and masked (`[REDACTED]`) in `GET /api/containers` and `GET /api/ai/deploy-assistant`.
4. **SSRF & redirect protection:** `normalizeBaseUrl()` blocks `169.254.0.0/16`, `100.100.100.200`, `metadata.google.internal`, `0.0.0.0`, and IPv6 link-local/IMDS addresses. `completeWithAI()` sets `redirect: "error"` on every `fetch()`. Readiness probes strictly target `http://127.0.0.1:<hostPort><healthPath>`.
5. **Student PII & CRM data handling (ALO Education):**
   - **Never** route student passport numbers, visa documents, transcripts, or CRM PII to anonymous/free cloud providers (`llm7`, free `groq`).
   - For PII workloads, enforce `AI_PROVIDER_ORDER=gateway,ollama,localai` and `AI_ALLOW_ANONYMOUS=false` (strict on-server residency) OR use an enterprise cloud endpoint covered by a signed zero-data-retention DPA.

---

## 6. Zero-Terminal Deployment Assistant & Reverse Proxy Exposure

1. Open **Dashboard → Self-Hosted AI** (`/ai/self-hosted`).
2. Select a `Click Deploy` (`single-container-verified`) preset (`langflow`, `flowise`, `ollama`, `localai`, `qdrant`, `open-webui`).
3. Leave auto-generated secret fields blank to generate 24-byte cryptographic secrets automatically, or supply custom credentials.
4. Click **Validate Pre-Flight Plan** (`POST /api/ai/deploy-assistant` with `action: "plan"`) to verify port availability, license gates, and live host CPU/RAM fit.
5. Click **Provision Hardened Container** (`action: "deploy"`, requires `SERVER_MANAGE` permission). Notice any `127.0.0.1` upstream gateway URL is automatically rewritten to `http://host.docker.internal:<port>/v1` so the isolated container reaches the host gateway cleanly.
6. Click **Verify Readiness** (`GET /api/ai/deploy-assistant?readiness=<id>`) to confirm real HTTP 2xx readiness (`STARTING` vs `READY` vs `UNREACHABLE`).
7. **Optional HTTPS Exposure:** Keep inference/vector services (`ollama`, `localai`, `qdrant`) loopback-only. If exposing a UI (`langflow`) on a subdomain, terminate TLS in Nginx/Caddy with rate limiting and `LANGFLOW_AUTO_LOGIN=false` — never open container ports directly in UFW.

---

## 7. Multi-Service Compose Stacks, Backups, Upgrades, & Rollback

### Multi-Service Compose Stacks (`librechat`, `activepieces`, `agenta`, `langfuse`)
Platforms requiring dedicated MongoDB, PostgreSQL+pgvector, Redis, or ClickHouse clusters are marked `multi-service-compose` in the catalog rather than forced into fragile single containers. Provision them on a dedicated VM (`>=8–16 GB RAM`) inside an internal Docker bridge network with loopback-only reverse-proxy ingress.

### Backup & Restore Procedures
- **Langflow:** Back up named volume `alo-agent-<name>` (`/app/langflow`) or `pg_dump` external Postgres DB.
- **Flowise:** Back up `/root/.flowise` **including `encryption.key` and `database.sqlite` together** (without `encryption.key`, stored credentials cannot be decrypted).
- **Qdrant:** Create a Qdrant snapshot (`POST /snapshots`) with `api-key` header before archiving `/qdrant/storage`.
- **Host Databases (`alo-server-kit`):** Automated daily `0600` root-only dumps in `/var/backups/alo-db/{daily,weekly,monthly}` (never shared over Samba).

### Safe Version Upgrades
1. Back up the container's named volume (`docker run --rm -v alo-agent-<name>:/src:ro -v /var/backups/alo:/dst alpine tar czf /dst/<name>-pre-upgrade.tgz -C /src .`) and verify the archive before modifying anything.
2. Uninstall the old container via `/ai/self-hosted` (**Uninstall**) or `sudo /usr/local/sbin/alo-docker-helper remove-force <name>` (if supported by the installed helper version; otherwise `stop` + `remove`), confirm the container is stopped and removed, and verify `alo-agent-<name>` remains intact (`docker volume inspect alo-agent-<name>`).
3. Deploy the newly verified pinned image version attached to the same instance name / volume, then click **Verify Readiness**.

---

## 8. Rollback Procedure

### Application rollback
1. Identify the last known-good release commit and build artifact.
2. Restore the previous application release using the established deployment procedure (see `DEPLOY.md` and `docs/RECOVERY-hosting.alolabs.net.md`).
3. Restore `/var/backups/alo/alo-docker-helper.bak` to `/usr/local/sbin/alo-docker-helper` only after verifying the backup and its ownership and permissions (`root:root`, `0750` or `0755` per sudoers policy).
4. Validate the restored helper syntax and permissions (`sudo bash -n /usr/local/sbin/alo-docker-helper`, `stat -c '%U:%G %a' /usr/local/sbin/alo-docker-helper`, `sudo visudo -cf /etc/sudoers.d/alo-hosting-portal`).
5. Run `pm2 reload alo-hosting-portal` using the deployment's configured PM2 environment (or restart the active systemd unit if managed via `alo-hosting-panel.service`).
6. Verify PM2/service process health, `/api/health`, authentication, tenant isolation, and critical application workflows.
7. Review logs and confirm that no new errors or secret leaks have appeared.

### Database rollback
No Prisma schema migration was introduced in this release. This does not, by itself, guarantee compatibility across SQLite and PostgreSQL (`prisma/schema.prisma` is currently locked to `provider = "sqlite"`) or across future schema changes. Before changing the production datasource, create and verify backups, rehearse the migration, validate data integrity, and document the cutover and recovery procedure. Database rollback must account for writes made after cutover.

### Agent container rollback
Use the **Uninstall** action in `/ai/self-hosted`, or run `sudo /usr/local/sbin/alo-docker-helper remove-force <name>` if that command is supported by the installed helper version (falling back to `stop` followed by `remove` on older helpers). Confirm the container is stopped and removed, and verify whether the named volume `alo-agent-<name>` remains intact (`docker volume inspect alo-agent-<name>`). Preserve and back up the volume before any cleanup or redeployment. Validate recovery in a non-production environment before relying on volume preservation.

---

## 9. Observability & Troubleshooting

- **`CONFIGURED` vs `HEALTHY` (`/api/ai/status`):** `GET /api/ai/status` checks env resolution and circuit-breaker cooldowns with zero network calls; `GET /api/ai/status?probe=1` performs a real 1-token round-trip (cached 60s; `?force=1` restricted to Admin/DevOps).
- **Container `STARTING` vs `READY`:** Python/JVM/ML containers (Langflow, LocalAI) can take 15–45 seconds on first boot to initialize migrations before returning HTTP 200 on `/health_check` or `/readyz`. Inspect sanitized logs via `sudo /usr/local/sbin/alo-docker-helper logs <name> 200`.
- **Container cannot reach host LiteLLM/Ollama:** Use `http://host.docker.internal:4000/v1` (not `127.0.0.1`), and ensure host UFW allows `docker0` (`172.17.0.0/16`) to reach the host gateway port if firewall rules restrict `docker0` input.


---

# Self-Hosted AI Agent & Local Inference Architecture Guide (`hosting.alolabs.net`)

> **Primary-Source Audit Date:** `2026-10-26`
> **Reference Catalog:** [`Agenta-AI/awesome-ai-agent-platforms`](https://github.com/Agenta-AI/awesome-ai-agent-platforms)
> **Notice:** License triage labels below represent engineering review of upstream `LICENSE` files and repository structure — not formal legal counsel sign-off.

---

## 1. Architecture Overview (Control Plane vs Inference Plane vs Sandbox Plane)

`Hosting-Portal` separates AI workloads into three strict trust boundaries:

1. **Control & Workflow Plane (`Hosting-Portal` Next.js 16 + Prisma)**:
   - OpenAI-compatible multi-provider failover chain (`src/lib/ai/providers.ts` & `src/lib/ai/client.ts`): `unorouter` → `llm7` → `groq` → `glm` (`GLM-5`) → `gateway` (`LiteLLM`) → `ollama` → `localai`.
   - SSRF & IMDS guard (`src/lib/security/url-guard.ts`) blocks `169.254.0.0/16`, `100.100.100.200`, `metadata.google.internal`, `fd00:ec2::254`, and `fe80::/10` across all provider URLs and customer webhooks.
   - Built-in synchronous DAG workflow engine (`src/lib/ai/automation/`) capped at 40 nodes, 120s per step, and 12 AI calls per run, with strict `ownerId` tenant isolation (`createHostingToolsForActor`).
   - Zero-Terminal AI Studio (`/ai/assistant`, `src/lib/ai/deploy-assistant.ts`) with **11 pinned stack presets** (5 web stacks + 6 permissive self-hosted agent stacks) and honest HTTP readiness verification (`CONFIGURED_AWAITING_RELEASE` vs `LIVE_HEALTHY`).
2. **Private Inference Plane (`alo-server-kit/stages/04-ai-infra.sh` or Dedicated GPU Node)**:
   - **LiteLLM Proxy (`1.106.4`)** bound to `127.0.0.1:4000` (and LAN/Tailscale-allowlisted `/ai/` behind Basic Auth), issuing virtual keys and routing to local **Ollama** (`127.0.0.1:11434`), **LocalAI** (`127.0.0.1:8080`), **vLLM/SGLang**, or encrypted cloud fallbacks (`GLM-5`, `Groq`).
3. **High-Risk Execution / Browser Plane (Dedicated Isolated VMs Only)**:
   - Coding agents (**OpenHands**) and headless browser agents (**Browser Use**) MUST NEVER run on shared multi-tenant web/DB hosts or mount host `/var/run/docker.sock`. They require dedicated isolated VMs + Squid SSRF egress proxies.

---

## 2. Revalidated Platform Catalog & Primary-Source License Triage

| Platform | Upstream Repo & Verified Version | Inspected License | Engineering Triage Label | Multi-Tenant Customer Safe? | Decision |
|---|---|---|---|---|---|
| **Langflow** | `langflow-ai/langflow` (`v1.13.0`) | Pure **MIT** | `License verified for intended use` | **Yes** (isolated DB/process per tenant) | **ADD** (`langflow-agent` preset) |
| **Agno** | `agno-agi/agno` (`v3.1.10`) | Pure **Apache-2.0** | `License verified for intended use` | **Yes** | **ADD** (`agno-agent` preset) |
| **LangGraph** | `langchain-ai/langgraph` (`1.2.17`) | Pure **MIT** | `License verified for intended use` | **Yes** | **KEEP** (`langgraph-agent` preset) |
| **CrewAI** | `crewAIInc/crewAI` (`1.15.30`) | Pure **MIT** | `License verified for intended use` | **Yes** | **KEEP** (`crewai-service` preset) |
| **Letta** | `letta-ai/letta` (`0.34.12`) | Pure **Apache-2.0** | `License verified for intended use` | **Yes** | **KEEP** (`letta-memory` preset) |
| **LocalAI** | `mudler/LocalAI` (`v4.12.1`) | Pure **MIT** (check model weights separately) | `License verified for intended use` | **Yes** (internal inference backend) | **KEEP** (`localai` provider) |
| **LibreChat** | `danny-avila/LibreChat` (`main`) | Pure **MIT** | `License verified for intended use` | **Yes** (Docker Compose stack) | **ADD** (customer/team chat workspace) |
| **Flowise** | `FlowiseAI/Flowise` (`flowise@3.1.4`) | **Apache-2.0 core** + Commercial (`packages/server/src/enterprise`, `IdentityManager.ts`) | `Conditional, requires additional review` | **No** (single-tenant OSS core only) | **IMPROVE** (pinned + warning; prefer Langflow for resale) |
| **Langfuse** | `langfuse/langfuse` (`v4.70.0`) | **MIT Expat core** + Commercial (`ee/`) | `Conditional, requires additional review` | **No** (internal OSS observability) | **ADD** (OTel trace sink) |
| **Agenta** | `Agenta-AI/agenta` (`v0.125.0`) | **MIT Expat core** + Commercial (`ee/`) | `Conditional, requires additional review` | **No** (internal OSS eval/prompts) | **OPTIONAL** |
| **Trigger.dev** | `triggerdotdev/trigger.dev` (`v4.8.1`) | Pure **Apache-2.0** | `License verified for intended use` | **Yes** | **OPTIONAL** (>120s durable jobs) |
| **Temporal** | `temporalio/temporal` (`v1.32.1`) | Pure **MIT** | `License verified for intended use` | **Yes** | **DEFER** (multi-node scale) |
| **Activepieces** | `activepieces/activepieces` (`0.92.3-hotfix.1`) | **MIT Expat core** + Commercial (`packages/ee/`) | `Conditional, requires additional review` | **No** (`AP_EDITION=ce` single-org) | **OPTIONAL** |
| **Haystack / LlamaIndex / Pydantic AI** | `v3.4.1` / `v0.14.25` / `v2.61.0` | **Apache-2.0** / **MIT** / **MIT** | `License verified for intended use` | **Yes** | **OPTIONAL** (`python-app` SDKs) |
| **Rivet** | `Ironclad/rivet` (`app-v1.11.3`) | Pure **MIT** *(corrected from Apache-2.0)* | `License verified for intended use` | **Yes** | **OPTIONAL** (`nodejs-api` SDK) |
| **Agent Framework / AG2** | `microsoft/agent-framework` / `ag2ai/ag2` (`v1.2.1`) | **MIT** / **Apache-2.0** *(`microsoft/autogen` root is `CC-BY-4.0`)* | `Conditional, requires additional review` | **Yes** (with code execution disabled/sandboxed) | **OPTIONAL** |
| **Open WebUI** | `open-webui/open-webui` (`v0.12.4`) | **Open WebUI License** (Clause 4 branding restriction >50 users/30d) | `Internal use recommended` | **No** | **INTERNAL_ONLY** (ALO staff <=50 users, keep branding) |
| **Dify** | `langgenius/dify` (`1.18.0`) | **Dify Open Source License** (Clause 1a prohibits multi-tenant) | `Commercial permission required or potentially required` | **No** | **INTERNAL_ONLY** |
| **n8n** | `n8n-io/n8n` (`n8n@2.44.7`) | **Sustainable Use License v1.0** + `LICENSE_EE.md` | `Commercial permission required or potentially required` | **No** (internal business use only) | **INTERNAL_ONLY** |
| **OpenHands** | `All-Hands-AI/OpenHands` (`v1.33.0`) | Pure **MIT** (high-risk Docker sandbox execution surface) | `Internal use recommended` | **No** (dedicated VM required) | **INTERNAL_ONLY** |
| **Browser Use** | `browser-use/browser-use` (`0.13.13`) | Pure **MIT** | `License verified for intended use` | **No** (requires isolated microVM + SSRF proxy) | **DEFER** |
| **Skyvern** | `Skyvern-AI/skyvern` (`v1.0.56`) | **AGPL-3.0** | `Not approved pending legal review` | **No** | **REJECT** |
| **SuperAGI** | `TransformerOptimus/SuperAGI` (`v0.0.14`) | MIT *(unmaintained since `2025-01-22`)* | `Not approved pending legal review` | **No** | **REJECT** |
| **Drevon** | Unverified third-party blog entry | Unverified | `Not approved pending legal review` | **No** | **REJECT** |

---

## 3. Data Residency & Telemetry Honesty Rules

Setting an arbitrary environment variable such as `DATA_RESIDENCY=on-premise` **does not** enforce data residency. True on-premise data residency requires verifying all four layers simultaneously:

1. **Inference Routing**: `AI_PROVIDER_ORDER=gateway,ollama,localai` with `AI_ALLOW_ANONYMOUS=false` and zero external cloud keys in `configs/litellm/config.yaml.tpl`.
2. **Embeddings & Reranking**: Local embedding models (`nomic-embed-text`, `bge-m3`) via Ollama/LocalAI rather than `api.openai.com`.
3. **Framework Telemetry Disabled**:
   - Flowise: `DISABLE_FLOWISE_TELEMETRY=true`, `DO_NOT_TRACK=1`
   - Langflow: `LANGFLOW_DO_NOT_TRACK=true`, `DO_NOT_TRACK=1`
   - LangGraph/LangChain: `LANGCHAIN_TRACING_V2=false` (or pointed to self-hosted Langfuse)
   - CrewAI: `CREWAI_DISABLE_TELEMETRY=true`, `OTEL_SDK_DISABLED=true`
   - Agno: `AGNO_TELEMETRY=false`
   - Chroma / Letta / Open WebUI: `ANONYMIZED_TELEMETRY=false`, `SCARF_NO_ANALYTICS=true`
4. **Network Egress Control**: Host/container firewall rules restricting outbound traffic from agent workers to approved endpoints.

---

## 4. Parameterized Hardware & VRAM Sizing Guide (Estimates Only)

Use `POST /api/ai/deploy-assistant` with `{ "action": "size", ... }` (`calculateSelfHostedSizing` in `src/lib/ai/self-hosted-agents.ts`) to compute workload-specific ranges. Key engineering rules:

- **Separate Orchestration from Inference**: Agent servers (Langflow, LangGraph, CrewAI, Agno, Letta + PostgreSQL/pgvector) run on CPU nodes (**4–8 vCPU, 8–16 GB RAM, 60–100 GB NVMe**) with **0 GB GPU VRAM** when calling LiteLLM or GLM-5.
- **Budget KV Cache × Concurrency + 15% Fragmentation Margin**:
  - **7B–8B Q4_K_M** (2 concurrent × 8k–16k context): **Est. 9–12 GB VRAM** → 1× 16–24 GB GPU (RTX 4000 Ada / L4) + 16 GB RAM.
  - **14B Q4_K_M + Local Embeddings** (4 concurrent × 16k): **Est. 15–20 GB VRAM** → 1× 24 GB GPU (L4 / RTX 4090) + 32 GB RAM.
  - **32B Q4** (4 concurrent × 32k): **Est. 28–36 GB VRAM** → 1× 48 GB GPU (L40S / A6000) or 2× 24 GB GPUs + 64 GB RAM.
  - **70B Q4** (2 concurrent × 16k): **Est. 52–62 GB VRAM** → 1× 80 GB GPU (A100/H100) + 96 GB RAM.
  - **70B Q4 Long-Context** (4 concurrent × 64k): **Est. 72–92 GB VRAM** → 2× 80 GB GPUs or 1× H200 141 GB running **vLLM/SGLang** (`PagedAttention`).

---

## 5. Operator Runbook & Verification Commands

```bash
# 1. Validate TypeScript, ESLint, unit/security suites, and production build
npm run lint
npm run typecheck
npm test
NODE_ENV=production npm run build

# 2. Verify AI provider status (admin session required for ?probe=1)
curl -H "Cookie: token=<ADMIN_JWT>" https://hosting.alolabs.net/api/ai/status?probe=1

# 3. Verify alo-server-kit shell syntax & host hardening
for f in alo-server-kit/*.sh alo-server-kit/lib/*.sh alo-server-kit/stages/*.sh; do bash -n "$f"; done
sudo ./alo-server-kit/verify.sh
```
