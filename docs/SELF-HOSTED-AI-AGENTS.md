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
