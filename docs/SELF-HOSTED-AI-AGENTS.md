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
