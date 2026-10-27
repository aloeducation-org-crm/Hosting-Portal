/**
 * Revalidated Self-Hosted AI Agent & Local Inference Platform Catalog,
 * 13-Use-Case Decision Matrix, and Parameterized Hardware/VRAM Sizing Engine
 * for ALO Labs (`https://hosting.alolabs.net`).
 *
 * Primary-source license & maintenance verification date: 2026-10-26
 * Reference catalog: https://github.com/Agenta-AI/awesome-ai-agent-platforms
 *
 * NOTE: License triage labels represent engineering triage based on inspected
 * upstream LICENSE files — not formal legal counsel approval.
 */

import { z } from "zod";
import type { StackPresetId } from "@/lib/ai/deploy-assistant";

export type SelfHostedAgentCategory =
  | "ai-coworker"
  | "visual-builder"
  | "code-first-graph"
  | "workflow-automation"
  | "browser-agent"
  | "coding-agent"
  | "local-inference"
  | "stateful-memory"
  | "observability-eval"
  | "desktop-operator";

export type LicenseTriageLabel =
  | "License verified for intended use"
  | "Conditional, requires additional review"
  | "Commercial permission required or potentially required"
  | "Internal use recommended"
  | "Not approved pending legal review";

export type PlatformDecision =
  | "KEEP"
  | "IMPROVE"
  | "ADD"
  | "OPTIONAL"
  | "INTERNAL_ONLY"
  | "DEFER"
  | "REJECT";

export type MaintenanceStatus = "active" | "maintenance" | "unmaintained" | "unverified";

export interface SelfHostedAgentPlatform {
  id: string;
  name: string;
  category: SelfHostedAgentCategory;
  officialRepo: string | null;
  officialLicenseUrl: string | null;
  license: string;
  spdxId: string;
  licenseTriage: LicenseTriageLabel;
  licenseCheckedAt: string;
  /** True ONLY when pure OSI-permissive AND safe for multi-tenant customer hosting without EE/copyleft traps. */
  commercialMultiTenantSafe: boolean;
  licenseGuardrail: string;
  maintenanceStatus: MaintenanceStatus;
  latestVerifiedVersion: string | null;
  lastPushedAt: string | null;
  decision: PlatformDecision;
  decisionRationale: string;
  executionSurface: string;
  deploymentModes: readonly string[];
  requiredServices: readonly string[];
  minVCpu: number;
  minRamGb: number;
  minDiskGb: number;
  gpuRequired: boolean;
  stateBacking: string;
  defaultPort: number | null;
  healthCheckEndpoint: string | null;
  authModel: string;
  tenantIsolationModel: string;
  sandboxRequirements: string;
  networkExposurePolicy: string;
  telemetryDisableVars: readonly string[];
  securityRequirement: string;
  deployPresetId: StackPresetId | null;
  bestFor: string;
}

export const agentPlatformMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  category: z.enum([
    "ai-coworker",
    "visual-builder",
    "code-first-graph",
    "workflow-automation",
    "browser-agent",
    "coding-agent",
    "local-inference",
    "stateful-memory",
    "observability-eval",
    "desktop-operator",
  ]),
  officialRepo: z.string().url().nullable(),
  officialLicenseUrl: z.string().url().nullable(),
  license: z.string().min(2),
  spdxId: z.string().min(2),
  licenseTriage: z.enum([
    "License verified for intended use",
    "Conditional, requires additional review",
    "Commercial permission required or potentially required",
    "Internal use recommended",
    "Not approved pending legal review",
  ]),
  licenseCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commercialMultiTenantSafe: z.boolean(),
  licenseGuardrail: z.string().min(10),
  maintenanceStatus: z.enum(["active", "maintenance", "unmaintained", "unverified"]),
  latestVerifiedVersion: z.string().nullable(),
  lastPushedAt: z.string().nullable(),
  decision: z.enum(["KEEP", "IMPROVE", "ADD", "OPTIONAL", "INTERNAL_ONLY", "DEFER", "REJECT"]),
  decisionRationale: z.string().min(10),
  executionSurface: z.string().min(3),
  deploymentModes: z.array(z.string()).min(1),
  requiredServices: z.array(z.string()),
  minVCpu: z.number().min(0),
  minRamGb: z.number().min(0),
  minDiskGb: z.number().min(0),
  gpuRequired: z.boolean(),
  stateBacking: z.string().min(3),
  defaultPort: z.number().int().min(1).max(65535).nullable(),
  healthCheckEndpoint: z.string().startsWith("/").nullable(),
  authModel: z.string().min(3),
  tenantIsolationModel: z.string().min(3),
  sandboxRequirements: z.string().min(3),
  networkExposurePolicy: z.string().min(3),
  telemetryDisableVars: z.array(z.string()),
  securityRequirement: z.string().min(10),
  deployPresetId: z.string().nullable(),
  bestFor: z.string().min(10),
});

export const SELF_HOSTED_AGENT_PLATFORMS: readonly SelfHostedAgentPlatform[] = [
  // ── 1. Re-audited Original 12 Platforms ────────────────────────────────────
  {
    id: "flowise",
    name: "Flowise (OSS Core)",
    category: "visual-builder",
    officialRepo: "https://github.com/FlowiseAI/Flowise",
    officialLicenseUrl: "https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md",
    license: "Apache-2.0 core + Commercial License (packages/server/src/enterprise & IdentityManager.ts)",
    spdxId: "NOASSERTION (Apache-2.0 + Commercial)",
    licenseTriage: "Conditional, requires additional review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Core outside packages/server/src/enterprise and IdentityManager.ts is Apache-2.0, but enterprise SSO/RBAC/workspace modules carry Flowise Commercial License. Use single-tenant OSS core only or choose pure-MIT Langflow for commercial multi-tenant hosting.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "flowise@3.1.4",
    lastPushedAt: "2026-08-13",
    decision: "IMPROVE",
    decisionRationale:
      "Retained with pinned version (3.1.4), disabled telemetry, and corrected license guardrail; supplemented by pure-MIT Langflow for multi-tenant visual agent hosting.",
    executionSurface: "Node.js 22 service or Docker container",
    deploymentModes: ["systemd-node", "docker"],
    requiredServices: ["PostgreSQL", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "PostgreSQL + local Qdrant/pgvector",
    defaultPort: 3010,
    healthCheckEndpoint: "/api/v1/ping",
    authModel: "FLOWISE_USERNAME / FLOWISE_PASSWORD + API keys (enterprise RBAC is commercial)",
    tenantIsolationModel: "Dedicated single-tenant instance per customer workspace",
    sandboxRequirements: "Disable custom JS Function node in untrusted workspaces or isolate container",
    networkExposurePolicy: "Bind 127.0.0.1 behind Nginx TLS + WAF",
    telemetryDisableVars: ["DISABLE_FLOWISE_TELEMETRY=true", "DO_NOT_TRACK=1"],
    securityRequirement:
      "Set FLOWISE_USERNAME/FLOWISE_PASSWORD,FLOWISE_SECRETKEY_OVERWRITE, disable telemetry, and restrict custom code nodes.",
    deployPresetId: "flowise-agent",
    bestFor: "Single-tenant drag-and-drop RAG & support chatbots exposed as REST APIs.",
  },
  {
    id: "langflow",
    name: "Langflow",
    category: "visual-builder",
    officialRepo: "https://github.com/langflow-ai/langflow",
    officialLicenseUrl: "https://github.com/langflow-ai/langflow/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail:
      "Pure MIT License verified in root LICENSE — no enterprise directory carve-out; safe for internal and commercial customer deployments.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v1.13.0",
    lastPushedAt: "2026-10-26",
    decision: "ADD",
    decisionRationale:
      "Added from Agenta-AI/awesome-ai-agent-platforms as the primary pure-MIT visual agent & MCP workflow builder without Flowise's enterprise subtree restrictions.",
    executionSurface: "Python 3.12 service or Docker container",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "PostgreSQL + pgvector / Qdrant",
    defaultPort: 7860,
    healthCheckEndpoint: "/health_check",
    authModel: "JWT user authentication (LANGFLOW_AUTO_LOGIN=false + LANGFLOW_SUPERUSER)",
    tenantIsolationModel: "Dedicated container/process + isolated PostgreSQL database per tenant",
    sandboxRequirements: "Restrict arbitrary Python custom component edits to trusted admins",
    networkExposurePolicy: "Bind 127.0.0.1 behind Nginx TLS",
    telemetryDisableVars: ["LANGFLOW_DO_NOT_TRACK=true", "DO_NOT_TRACK=1"],
    securityRequirement:
      "Enforce LANGFLOW_AUTO_LOGIN=false, set CSPRNG LANGFLOW_SECRET_KEY, and disable telemetry.",
    deployPresetId: "langflow-agent",
    bestFor: "Commercial-safe visual multi-agent & MCP server builder for agencies and SaaS customers.",
  },
  {
    id: "langgraph",
    name: "LangGraph Server",
    category: "code-first-graph",
    officialRepo: "https://github.com/langchain-ai/langgraph",
    officialLicenseUrl: "https://github.com/langchain-ai/langgraph/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail:
      "Core `langgraph` library and PostgreSQL checkpointers (`langgraph-checkpoint-postgres`) are pure MIT; hosted LangGraph Platform cloud is optional and not required.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "1.2.17",
    lastPushedAt: "2026-10-26",
    decision: "KEEP",
    decisionRationale:
      "Primary recommendation for deterministic, stateful, human-in-the-loop production agent APIs.",
    executionSurface: "Python 3.11+ FastAPI/ASGI service or Docker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "PostgreSQL checkpointers (typed thread state, interrupts, time-travel resume)",
    defaultPort: 8123,
    healthCheckEndpoint: "/ok",
    authModel: "Bearer token / HMAC middleware + tenant-scoped thread_id",
    tenantIsolationModel: "Row-level tenant_id in checkpointer metadata or per-tenant DB",
    sandboxRequirements: "Never wire shell tools directly; require interrupt_before on mutating tools",
    networkExposurePolicy: "Bind 127.0.0.1 behind authenticated API gateway",
    telemetryDisableVars: ["LANGCHAIN_TRACING_V2=false"],
    securityRequirement:
      "Enforce human-in-the-loop interrupts before mutating calls, set LANGCHAIN_TRACING_V2=false unless self-hosted Langfuse/Agenta is used.",
    deployPresetId: "langgraph-agent",
    bestFor: "Production cyclic state machines, auditable CRM/Admissions pipelines, and durable approvals.",
  },
  {
    id: "crewai",
    name: "CrewAI Multi-Agent Service",
    category: "code-first-graph",
    officialRepo: "https://github.com/crewAIInc/crewAI",
    officialLicenseUrl: "https://github.com/crewAIInc/crewAI/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail:
      "Core `crewAI` SDK (`1.15.30`) is pure MIT; commercial CrewAI AMP control plane is optional.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "1.15.30",
    lastPushedAt: "2026-10-26",
    decision: "KEEP",
    decisionRationale:
      "Clean MIT multi-agent role/task orchestration; telemetry disabled explicitly in preset.",
    executionSurface: "Python 3.10–3.13 FastAPI worker or Docker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Chroma/pgvector memory",
    defaultPort: 8124,
    healthCheckEndpoint: "/health",
    authModel: "FastAPI Bearer/API-Key auth",
    tenantIsolationModel: "Per-tenant process or isolated memory namespace",
    sandboxRequirements: "Disable allow_code_execution unless Docker socket is isolated on dedicated VM",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: ["CREWAI_DISABLE_TELEMETRY=true", "OTEL_SDK_DISABLED=true"],
    securityRequirement:
      "Set CREWAI_DISABLE_TELEMETRY=true, cap max_iter per agent, and forbid host code execution.",
    deployPresetId: "crewai-service",
    bestFor: "Role-based multi-agent crews (Triage -> Research -> Synthesis -> QA).",
  },
  {
    id: "agno",
    name: "Agno (formerly Phidata)",
    category: "code-first-graph",
    officialRepo: "https://github.com/agno-agi/agno",
    officialLicenseUrl: "https://github.com/agno-agi/agno/blob/main/LICENSE",
    license: "Apache-2.0",
    spdxId: "Apache-2.0",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure Apache-2.0 verified in upstream LICENSE — commercial & multi-tenant safe.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v3.1.10",
    lastPushedAt: "2026-10-26",
    decision: "ADD",
    decisionRationale:
      "Added from Agenta-AI/awesome-ai-agent-platforms: low-memory Python runtime with built-in FastAPI AgentOS server, Postgres session storage, and MCP support.",
    executionSurface: "Python 3.12 FastAPI AgentOS service or Docker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL", "pgvector", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 2,
    minDiskGb: 15,
    gpuRequired: false,
    stateBacking: "PostgreSQL + pgvector session & knowledge tables",
    defaultPort: 7777,
    healthCheckEndpoint: "/health",
    authModel: "OS_SECURITY_KEY Bearer auth",
    tenantIsolationModel: "user_id + session_id partitioning in PostgreSQL",
    sandboxRequirements: "Restrict shell/python tools in multi-tenant API mode",
    networkExposurePolicy: "Bind 127.0.0.1 behind Nginx",
    telemetryDisableVars: ["AGNO_TELEMETRY=false", "DO_NOT_TRACK=1"],
    securityRequirement: "Configure OS_SECURITY_KEY and AGNO_TELEMETRY=false before exposing API.",
    deployPresetId: "agno-agent",
    bestFor: "Lightweight, low-latency Python RAG & tool-calling agent APIs with built-in session DB.",
  },
  {
    id: "letta",
    name: "Letta (formerly MemGPT)",
    category: "stateful-memory",
    officialRepo: "https://github.com/letta-ai/letta",
    officialLicenseUrl: "https://github.com/letta-ai/letta/blob/main/LICENSE",
    license: "Apache-2.0",
    spdxId: "Apache-2.0",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure Apache-2.0 verified — unrestricted commercial & persistent-memory usage.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "0.34.12 (PyPI) / 0.16.8 (GitHub release)",
    lastPushedAt: "2026-10-18",
    decision: "KEEP",
    decisionRationale:
      "Best-in-class self-hosted long-horizon memory server (Core + Recall + Archival pgvector memory).",
    executionSurface: "Python 3.11+ server or Docker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL + pgvector", "Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 25,
    gpuRequired: false,
    stateBacking: "PostgreSQL + pgvector tiered memory blocks",
    defaultPort: 8283,
    healthCheckEndpoint: "/v1/health",
    authModel: "LETTA_SERVER_PASS Bearer password",
    tenantIsolationModel: "Dedicated Letta org/agent namespace or dedicated instance per tenant",
    sandboxRequirements: "Run custom tool execution in sandboxed container if user-defined tools enabled",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: ["ANONYMIZED_TELEMETRY=false", "DO_NOT_TRACK=1"],
    securityRequirement: "Set LETTA_SERVER_PASS and partition memory blocks strictly per student/tenant.",
    deployPresetId: "letta-memory",
    bestFor: "Long-horizon AI tutors, advisors, and account assistants remembering weeks of context.",
  },
  {
    id: "localai",
    name: "LocalAI",
    category: "local-inference",
    officialRepo: "https://github.com/mudler/LocalAI",
    officialLicenseUrl: "https://github.com/mudler/LocalAI/blob/master/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure MIT engine; verify individual HuggingFace/GGUF model weight licenses separately.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v4.12.1",
    lastPushedAt: "2026-10-26",
    decision: "KEEP",
    decisionRationale:
      "Integrated directly into src/lib/ai/providers.ts (`localai`) for drop-in local OpenAI-compatible chat, embeddings, Whisper STT, and TTS.",
    executionSurface: "Docker / systemd binary (CPU or CUDA/ROCm GPU)",
    deploymentModes: ["docker-gpu", "docker-cpu", "systemd"],
    requiredServices: ["Model volume storage"],
    minVCpu: 4,
    minRamGb: 16,
    minDiskGb: 60,
    gpuRequired: false,
    stateBacking: "Stateless HTTP API + persistent /models volume",
    defaultPort: 8080,
    healthCheckEndpoint: "/readyz",
    authModel: "LOCALAI_API_KEY header authentication",
    tenantIsolationModel: "Shared internal inference backend behind LiteLLM per-tenant virtual keys",
    sandboxRequirements: "Disable remote untrusted model gallery URLs in production (--disable-gallery)",
    networkExposurePolicy: "Loopback 127.0.0.1:8080 or private GPU VLAN only",
    telemetryDisableVars: [],
    securityRequirement: "Bind to 127.0.0.1:8080, require LOCALAI_API_KEY, and pin verified model hashes.",
    deployPresetId: null,
    bestFor: "Drop-in OpenAI REST replacement for local LLMs, embeddings, speech-to-text, and TTS.",
  },
  {
    id: "librechat",
    name: "LibreChat",
    category: "ai-coworker",
    officialRepo: "https://github.com/danny-avila/LibreChat",
    officialLicenseUrl: "https://github.com/danny-avila/LibreChat/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail:
      "Pure MIT License verified — unlike Open WebUI or LobeChat, LibreChat permits unrestricted commercial hosting, white-labeling, and >50-user deployments.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "main (2026-10-26)",
    lastPushedAt: "2026-10-26",
    decision: "ADD",
    decisionRationale:
      "Primary commercial-safe self-hosted ChatGPT/Claude-style multi-model workspace with RBAC, MCP, Agents, and isolated Code Interpreter API.",
    executionSurface: "Docker Compose (Node.js API + MongoDB + Meilisearch + vectordb)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["MongoDB", "PostgreSQL+pgvector (RAG API)", "Meilisearch"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 40,
    gpuRequired: false,
    stateBacking: "MongoDB (conversations/users) + pgvector (RAG embeddings)",
    defaultPort: 3080,
    healthCheckEndpoint: "/health",
    authModel: "JWT + OAuth2/OIDC/LDAP + role-based permissions",
    tenantIsolationModel: "Per-organization container stack or OIDC group RBAC",
    sandboxRequirements: "Keep code execution isolated in dedicated sandboxed container",
    networkExposurePolicy: "Nginx TLS reverse proxy with rate limiting",
    telemetryDisableVars: [],
    securityRequirement: "Set CSPRNG JWT_SECRET, JWT_REFRESH_SECRET, CREDS_KEY, CREDS_IV, and disable open registration.",
    deployPresetId: null,
    bestFor: "Customer-facing or >50-seat white-labeled self-hosted ChatGPT workspace where Open WebUI's license blocks branding changes.",
  },
  {
    id: "open-webui",
    name: "Open WebUI + Pipelines",
    category: "ai-coworker",
    officialRepo: "https://github.com/open-webui/open-webui",
    officialLicenseUrl: "https://github.com/open-webui/open-webui/blob/main/LICENSE",
    license: "Open WebUI License (source-available, Clause 4 branding & >50-user restriction)",
    spdxId: "NOASSERTION (Open WebUI License)",
    licenseTriage: "Internal use recommended",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Clause 4 strictly prohibits altering/removing Open WebUI branding in any deployment exceeding 50 users in a rolling 30-day window without an enterprise license.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v0.12.4",
    lastPushedAt: "2026-10-26",
    decision: "INTERNAL_ONLY",
    decisionRationale:
      "Provisioned in alo-server-kit (pinned 0.12.4, Python 3.12, 0600 env file) strictly for internal ALO staff with original branding intact; use LibreChat (MIT) for customer/white-label workspaces.",
    executionSurface: "Python 3.11–3.12 service or Docker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["Ollama or LiteLLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "SQLite or PostgreSQL + local vector DB",
    defaultPort: 3002,
    healthCheckEndpoint: "/health",
    authModel: "WEBUI_AUTH=true + CSPRNG WEBUI_SECRET_KEY + RBAC",
    tenantIsolationModel: "Internal single-organization staff workspace only",
    sandboxRequirements: "Run Python Pipelines/Functions in isolated container if untrusted code allowed",
    networkExposurePolicy: "Loopback / Tailscale / LAN IP allowlist",
    telemetryDisableVars: ["SCARF_NO_ANALYTICS=true", "DO_NOT_TRACK=true", "ANONYMIZED_TELEMETRY=false"],
    securityRequirement: "Store OPENAI_API_KEY & WEBUI_SECRET_KEY in 0600 EnvironmentFile (never inline in systemd unit).",
    deployPresetId: null,
    bestFor: "Internal ALO engineering & admissions staff chat UI preserving original Open WebUI branding.",
  },
  {
    id: "dify",
    name: "Dify",
    category: "visual-builder",
    officialRepo: "https://github.com/langgenius/dify",
    officialLicenseUrl: "https://github.com/langgenius/dify/blob/main/LICENSE",
    license: "Dify Open Source License (Modified Apache-2.0 — Clause 1a multi-tenant & 1b logo restrictions)",
    spdxId: "NOASSERTION (Dify License)",
    licenseTriage: "Commercial permission required or potentially required",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Clause 1a explicitly prohibits operating a multi-tenant environment (>1 tenant workspace) without written authorization from LangGenius; Clause 1b forbids removing frontend logo/copyright.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "1.18.0",
    lastPushedAt: "2026-10-26",
    decision: "INTERNAL_ONLY",
    decisionRationale:
      "High operational footprint (9+ containers) and multi-tenant license prohibition make it unsuitable for shared customer hosting; permitted for single-workspace internal ALO R&D with branding preserved.",
    executionSurface: "Multi-container Docker Compose stack (API, Worker, Web, Sandbox, SSRF Proxy)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis", "Weaviate/Qdrant", "dify-sandbox", "Squid SSRF proxy"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 50,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Redis + Vector DB + S3/local storage",
    defaultPort: 3020,
    healthCheckEndpoint: "/health",
    authModel: "Single-workspace email/password auth",
    tenantIsolationModel: "Single-tenant only under OSS license",
    sandboxRequirements: "Mandatory dify-sandbox + Squid outbound SSRF proxy",
    networkExposurePolicy: "Internal VPN / Tailscale recommended",
    telemetryDisableVars: ["NEXT_TELEMETRY_DISABLED=1"],
    securityRequirement: "Never expose multi-workspace hosting without LangGenius commercial license; keep Squid SSRF proxy active.",
    deployPresetId: null,
    bestFor: "Single-company internal LLMOps studio when full Dify workflow UI is required.",
  },
  {
    id: "openhands",
    name: "OpenHands (formerly OpenDevin)",
    category: "coding-agent",
    officialRepo: "https://github.com/All-Hands-AI/OpenHands",
    officialLicenseUrl: "https://github.com/All-Hands-AI/OpenHands/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "Internal use recommended",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Core OpenHands MIT license is permissive (exclude enterprise/ directory if present), BUT runtime spawns privileged/sibling Docker sandboxes executing arbitrary shell & browser actions.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v1.33.0",
    lastPushedAt: "2026-10-26",
    decision: "INTERNAL_ONLY",
    decisionRationale:
      "Clean MIT license for internal ALO engineering automation, but excluded from shared customer hosting due to Docker-socket / arbitrary code execution blast radius.",
    executionSurface: "Dedicated isolated Linux VM + rootless Docker / Sysbox / Kata runtime",
    deploymentModes: ["isolated-vm-docker"],
    requiredServices: ["Isolated Docker/Kata runtime", "LLM Gateway"],
    minVCpu: 4,
    minRamGb: 16,
    minDiskGb: 80,
    gpuRequired: false,
    stateBacking: "Workspace bind-mounts + event stream store",
    defaultPort: 3000,
    healthCheckEndpoint: "/api/options/config",
    authModel: "Reverse-proxy SSO / VPN gate",
    tenantIsolationModel: "Dedicated VM per user/team (never share host Docker daemon across tenants)",
    sandboxRequirements: "Rootless Docker, gVisor, or microVM + egress firewall blocking RFC1918 & 169.254.169.254",
    networkExposurePolicy: "Tailscale / WireGuard internal engineering network only",
    telemetryDisableVars: [],
    securityRequirement: "Never mount host /var/run/docker.sock on a multi-tenant production web server.",
    deployPresetId: null,
    bestFor: "Internal ALO software engineering agents writing, testing, and refactoring code in isolated VMs.",
  },
  {
    id: "rivet",
    name: "Ironclad Rivet",
    category: "desktop-operator",
    officialRepo: "https://github.com/Ironclad/rivet",
    officialLicenseUrl: "https://github.com/Ironclad/rivet/blob/main/LICENSE",
    license: "MIT (corrected from third-party Apache-2.0 claim)",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Verified MIT License (Copyright 2023 Ironclad) — safe for embedded TypeScript execution.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "app-v1.11.3",
    lastPushedAt: "2026-08-26",
    decision: "OPTIONAL",
    decisionRationale:
      "Desktop IDE + `@ironclad/rivet-node` library; deployable via existing `nodejs-api` preset when teams author `.rivet-project` graphs.",
    executionSurface: "Desktop IDE + `@ironclad/rivet-node` headless Node.js server",
    deploymentModes: ["systemd-node", "docker"],
    requiredServices: ["Loopback LLM Gateway"],
    minVCpu: 1,
    minRamGb: 2,
    minDiskGb: 10,
    gpuRequired: false,
    stateBacking: "Git-versioned `.rivet-project` YAML graphs",
    defaultPort: 4210,
    healthCheckEndpoint: "/health",
    authModel: "Host Express/Fastify API auth",
    tenantIsolationModel: "Stateless graph execution per request",
    sandboxRequirements: "Disable external shell plugin in `@ironclad/rivet-node`",
    networkExposurePolicy: "Bind 127.0.0.1 behind Nginx",
    telemetryDisableVars: [],
    securityRequirement: "Validate inputs before `runGraphInFile` and keep API keys server-side.",
    deployPresetId: "nodejs-api",
    bestFor: "TypeScript teams versioning prompt graphs in Git and executing them headlessly in Node.js.",
  },
  {
    id: "autogen-ag2",
    name: "Microsoft Agent Framework / AG2 (AutoGen)",
    category: "code-first-graph",
    officialRepo: "https://github.com/microsoft/agent-framework",
    officialLicenseUrl: "https://github.com/microsoft/agent-framework/blob/main/LICENSE",
    license: "MIT (microsoft/agent-framework) | Apache-2.0 (ag2ai/ag2) | CC-BY-4.0 root docs + MIT code (microsoft/autogen)",
    spdxId: "MIT / Apache-2.0",
    licenseTriage: "Conditional, requires additional review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Note upstream split: `microsoft/autogen` root LICENSE is CC-BY-4.0 (while `python/` packages are MIT); prefer `microsoft/agent-framework` (pure MIT) or `ag2ai/ag2` (`v1.2.1`, pure Apache-2.0), and isolate code execution before multi-tenant use.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "dotnet-1.26.0 / ag2 v1.2.1",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale:
      "Supported as a library inside `python-app`, but `LangGraph` and `Agno` provide cleaner production HTTP server ergonomics.",
    executionSurface: "Python 3.11+ / .NET worker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["Loopback LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "Conversation state persisted to Redis/PostgreSQL",
    defaultPort: 8125,
    healthCheckEndpoint: "/health",
    authModel: "Custom FastAPI wrapper auth",
    tenantIsolationModel: "Per-request isolated conversation state",
    sandboxRequirements: "Mandatory DockerCommandLineCodeExecutor or code_execution_config=False",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: [],
    securityRequirement: "Never enable LocalCommandLineCodeExecutor on a shared host.",
    deployPresetId: "python-app",
    bestFor: "Multi-agent debate and code-verification workflows using `microsoft/agent-framework` or `ag2`.",
  },
  {
    id: "superagi",
    name: "SuperAGI",
    category: "coding-agent",
    officialRepo: "https://github.com/TransformerOptimus/SuperAGI",
    officialLicenseUrl: "https://github.com/TransformerOptimus/SuperAGI/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "Not approved pending legal review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "MIT license is permissive, BUT repository has been unmaintained since 2025-01-22 at alpha v0.0.14 with stale dependencies and broad autonomous tool surface.",
    maintenanceStatus: "unmaintained",
    latestVerifiedVersion: "v0.0.14",
    lastPushedAt: "2025-01-22",
    decision: "REJECT",
    decisionRationale:
      "Rejected after primary-source GitHub audit: unmaintained for 21+ months (`pushed_at: 2025-01-22`, `v0.0.14`) and excluded from Agenta-AI/awesome-ai-agent-platforms.",
    executionSurface: "Legacy Docker Compose (Celery + Redis + Postgres)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 40,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Redis",
    defaultPort: null,
    healthCheckEndpoint: null,
    authModel: "Legacy token auth",
    tenantIsolationModel: "Not recommended",
    sandboxRequirements: "Unmaintained autonomous execution surface — do not deploy",
    networkExposurePolicy: "Do not deploy",
    telemetryDisableVars: [],
    securityRequirement: "Do not provision; migrate autonomous multi-agent workloads to CrewAI, Agno, or LangGraph.",
    deployPresetId: null,
    bestFor: "Deprecated — superseded by CrewAI, Agno, and LangGraph.",
  },
  {
    id: "drevon",
    name: "Drevon (Third-Party Blog Reference)",
    category: "desktop-operator",
    officialRepo: null,
    officialLicenseUrl: null,
    license: "Unverified (no canonical open-source repository found)",
    spdxId: "UNVERIFIED",
    licenseTriage: "Not approved pending legal review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "No verified canonical open-source GitHub repository or LICENSE file exists in Agenta-AI/awesome-ai-agent-platforms or public GitHub index.",
    maintenanceStatus: "unverified",
    latestVerifiedVersion: null,
    lastPushedAt: null,
    decision: "REJECT",
    decisionRationale:
      "Rejected: fails primary-source provenance, license verification, and server-hosting architecture checks.",
    executionSurface: "Local desktop GUI operator (not a server workload)",
    deploymentModes: ["desktop-only"],
    requiredServices: [],
    minVCpu: 0,
    minRamGb: 0,
    minDiskGb: 0,
    gpuRequired: false,
    stateBacking: "Local OS files",
    defaultPort: null,
    healthCheckEndpoint: null,
    authModel: "Local OS user",
    tenantIsolationModel: "None",
    sandboxRequirements: "Full desktop GUI control — never install on hosting nodes",
    networkExposurePolicy: "Never deploy on servers",
    telemetryDisableVars: [],
    securityRequirement: "Rejected from server catalog due to unverified upstream source and GUI operator risk.",
    deployPresetId: null,
    bestFor: "Excluded — use Browser Use (in isolated microVM) for audited web automation.",
  },

  // ── 2. Additional Agenta-AI/awesome-ai-agent-platforms & Infra Evaluations ─
  {
    id: "agenta",
    name: "Agenta LLMOps (Eval, Prompts & Tracing)",
    category: "observability-eval",
    officialRepo: "https://github.com/Agenta-AI/agenta",
    officialLicenseUrl: "https://github.com/Agenta-AI/agenta/blob/main/LICENSE",
    license: "MIT Expat core + Commercial License (`ee/` directory)",
    spdxId: "NOASSERTION (MIT + ee/)",
    licenseTriage: "Conditional, requires additional review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "All code outside `ee/` is MIT Expat; `ee/` directory carries Agenta enterprise license. Deploy OSS compose profile for internal evaluation, prompt registry, and OpenTelemetry tracing.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v0.125.0",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale:
      "Strong self-hosted prompt playgrounds, evaluation datasets, and LLM observability for ALO's AI engineering lifecycle.",
    executionSurface: "Docker Compose (FastAPI backend, Next.js web, Postgres, Redis, ClickHouse/OTel)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis", "Traefik/Nginx"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 40,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Redis",
    defaultPort: 3090,
    healthCheckEndpoint: "/health",
    authModel: "SuperTokens / OSS auth",
    tenantIsolationModel: "OSS edition best used per internal engineering org",
    sandboxRequirements: "Isolate custom evaluator Python code runners",
    networkExposurePolicy: "Internal LAN / Tailscale or SSO-gated HTTPS",
    telemetryDisableVars: ["AGENTA_TELEMETRY_ENABLED=false"],
    securityRequirement: "Deploy OSS non-`ee/` compose profile and restrict custom evaluator execution.",
    deployPresetId: null,
    bestFor: "Prompt versioning, golden-dataset LLM evaluation, and agent regression testing.",
  },
  {
    id: "langfuse",
    name: "Langfuse (OSS Core Observability)",
    category: "observability-eval",
    officialRepo: "https://github.com/langfuse/langfuse",
    officialLicenseUrl: "https://github.com/langfuse/langfuse/blob/main/LICENSE",
    license: "MIT Expat core + Enterprise License (`ee/` directories)",
    spdxId: "NOASSERTION (MIT + ee/)",
    licenseTriage: "Conditional, requires additional review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "MIT Expat outside `ee/`, `web/src/ee/`, `worker/src/ee/`, and `packages/shared/src/server/ee/`. Use OSS features without enterprise license key for internal observability.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v4.70.0",
    lastPushedAt: "2026-10-26",
    decision: "ADD",
    decisionRationale:
      "Recommended self-hosted OpenTelemetry trace, token-cost, and latency sink for LangGraph, CrewAI, Agno, and Hosting-Portal AI calls.",
    executionSurface: "Docker Compose v3+ (Web, Worker, PostgreSQL, ClickHouse, Redis, MinIO/S3)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "ClickHouse", "Redis", "MinIO/S3"],
    minVCpu: 4,
    minRamGb: 12,
    minDiskGb: 80,
    gpuRequired: false,
    stateBacking: "ClickHouse (traces/spans) + PostgreSQL + S3/MinIO",
    defaultPort: 3030,
    healthCheckEndpoint: "/api/public/health",
    authModel: "NextAuth + project public/secret ingestion keys",
    tenantIsolationModel: "Project-scoped API keys (OSS mode for internal platform observability)",
    sandboxRequirements: "Redact PII/secrets before emitting OTel spans",
    networkExposurePolicy: "Internal ingestion endpoint + admin SSO",
    telemetryDisableVars: ["TELEMETRY_ENABLED=false"],
    securityRequirement: "Set TELEMETRY_ENABLED=false, NEXTAUTH_SECRET, SALT, and ENCRYPTION_KEY (CSPRNG).",
    deployPresetId: null,
    bestFor: "Central OpenTelemetry LLM trace, prompt latency, and token-spend observability.",
  },
  {
    id: "haystack",
    name: "deepset Haystack",
    category: "code-first-graph",
    officialRepo: "https://github.com/deepset-ai/haystack",
    officialLicenseUrl: "https://github.com/deepset-ai/haystack/blob/main/LICENSE",
    license: "Apache-2.0",
    spdxId: "Apache-2.0",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure Apache-2.0 — unrestricted commercial RAG & agent pipeline embedding.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v3.4.1",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale: "Mature Apache-2.0 RAG & hybrid-search pipeline SDK deployable via `python-app` preset (`hayhooks`).",
    executionSurface: "Python 3.12 FastAPI / Hayhooks service",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["pgvector / Qdrant / OpenSearch", "LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "External DocumentStore (pgvector / Qdrant)",
    defaultPort: 1416,
    healthCheckEndpoint: "/status",
    authModel: "Reverse-proxy / FastAPI auth",
    tenantIsolationModel: "DocumentStore metadata filter per tenant_id",
    sandboxRequirements: "Standard unprivileged Python worker",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: ["HAYSTACK_TELEMETRY_ENABLED=False"],
    securityRequirement: "Set HAYSTACK_TELEMETRY_ENABLED=False and enforce mandatory tenant_id metadata filters.",
    deployPresetId: "python-app",
    bestFor: "High-precision hybrid BM25 + dense vector search & document extraction pipelines.",
  },
  {
    id: "llamaindex",
    name: "LlamaIndex Workflows",
    category: "code-first-graph",
    officialRepo: "https://github.com/run-llama/llama_index",
    officialLicenseUrl: "https://github.com/run-llama/llama_index/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure MIT License verified — safe for commercial RAG & event-driven document agents.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v0.14.25",
    lastPushedAt: "2026-10-23",
    decision: "OPTIONAL",
    decisionRationale: "Excellent library for PDF/admissions document indexing inside `python-app` services.",
    executionSurface: "Python 3.12 FastAPI worker",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["PostgreSQL + pgvector", "LLM Gateway"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "pgvector / Qdrant index tables",
    defaultPort: 8000,
    healthCheckEndpoint: "/health",
    authModel: "FastAPI Bearer auth",
    tenantIsolationModel: "Per-tenant vector table or strict metadata filter",
    sandboxRequirements: "Parse untrusted PDFs/DOCX with resource limits",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: [],
    securityRequirement: "Keep LlamaParse cloud keys unset when strict local document residency is required.",
    deployPresetId: "python-app",
    bestFor: "Knowledge-intensive document ingestion, citations, and structured extraction.",
  },
  {
    id: "pydantic-ai",
    name: "Pydantic AI",
    category: "code-first-graph",
    officialRepo: "https://github.com/pydantic/pydantic-ai",
    officialLicenseUrl: "https://github.com/pydantic/pydantic-ai/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure MIT License verified — minimal footprint, strict schema validation.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v2.61.0",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale: "Best lightweight typed Python agent SDK when graph servers are unnecessary.",
    executionSurface: "Python 3.12 FastAPI service",
    deploymentModes: ["systemd-python", "docker"],
    requiredServices: ["Loopback LLM Gateway"],
    minVCpu: 1,
    minRamGb: 1,
    minDiskGb: 10,
    gpuRequired: false,
    stateBacking: "Application PostgreSQL database",
    defaultPort: 8000,
    healthCheckEndpoint: "/health",
    authModel: "FastAPI dependency injection auth",
    tenantIsolationModel: "Typed RunContext<TenantDeps> passed to every tool",
    sandboxRequirements: "Standard unprivileged Python process",
    networkExposurePolicy: "Bind 127.0.0.1",
    telemetryDisableVars: [],
    securityRequirement: "Pass verified tenant ID via Pydantic RunContext deps (never via LLM prompt).",
    deployPresetId: "python-app",
    bestFor: "Type-safe structured JSON extraction and deterministic API microservices.",
  },
  {
    id: "trigger-dev",
    name: "Trigger.dev (v4 Durable Execution)",
    category: "workflow-automation",
    officialRepo: "https://github.com/triggerdotdev/trigger.dev",
    officialLicenseUrl: "https://github.com/triggerdotdev/trigger.dev/blob/main/LICENSE",
    license: "Apache-2.0",
    spdxId: "Apache-2.0",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure Apache-2.0 verified — clean commercial & TypeScript/Next.js alignment.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v4.8.1",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale:
      "Recommended durable background execution upgrade for Hosting-Portal (TypeScript-native) once workflows exceed the synchronous 120s step limit.",
    executionSurface: "Docker Compose (Webapp, Postgres, Redis, ClickHouse, Worker)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis", "ClickHouse"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 40,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Redis + ClickHouse",
    defaultPort: 3040,
    healthCheckEndpoint: "/healthcheck",
    authModel: "Project environment API keys + session auth",
    tenantIsolationModel: "Project/environment isolation + checkpointed container workers",
    sandboxRequirements: "Isolated worker containers with per-run resource caps",
    networkExposurePolicy: "Internal worker network + TLS dashboard",
    telemetryDisableVars: ["TRIGGER_TELEMETRY_DISABLED=1"],
    securityRequirement: "Scope project secret keys per workspace and cap task maxDuration.",
    deployPresetId: null,
    bestFor: "Long-running (>2 min) TypeScript AI background jobs, retries, queues, and wait-for-human tokens.",
  },
  {
    id: "temporal",
    name: "Temporal Server",
    category: "workflow-automation",
    officialRepo: "https://github.com/temporalio/temporal",
    officialLicenseUrl: "https://github.com/temporalio/temporal/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: true,
    licenseGuardrail: "Pure MIT License verified — gold-standard durable execution engine.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v1.32.1",
    lastPushedAt: "2026-10-26",
    decision: "DEFER",
    decisionRationale:
      "Clean MIT license and unmatched durability, but deferred until multi-node scale justifies operating Temporal + Elasticsearch/Postgres visibility clusters.",
    executionSurface: "Go server cluster + TypeScript/Python SDK workers",
    deploymentModes: ["docker-compose", "kubernetes"],
    requiredServices: ["PostgreSQL", "Temporal Frontend/History/Matching/Worker"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 50,
    gpuRequired: false,
    stateBacking: "PostgreSQL event history",
    defaultPort: 7233,
    healthCheckEndpoint: "/",
    authModel: "mTLS + Namespace Authorizer",
    tenantIsolationModel: "Temporal Namespaces per tenant/environment",
    sandboxRequirements: "Deterministic workflow sandbox + isolated activity workers",
    networkExposurePolicy: "Private gRPC :7233 only",
    telemetryDisableVars: [],
    securityRequirement: "Enforce mTLS and PayloadCodec encryption before storing sensitive workflow state.",
    deployPresetId: null,
    bestFor: "Mission-critical multi-day financial/infrastructure sagas at multi-server scale.",
  },
  {
    id: "activepieces",
    name: "Activepieces (OSS Core)",
    category: "workflow-automation",
    officialRepo: "https://github.com/activepieces/activepieces",
    officialLicenseUrl: "https://github.com/activepieces/activepieces/blob/main/LICENSE",
    license: "MIT Expat core + Commercial License (`packages/ee/`)",
    spdxId: "NOASSERTION (MIT + packages/ee/)",
    licenseTriage: "Conditional, requires additional review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "MIT Expat outside `packages/ee/` and `packages/server/api/src/app/ee`; set `AP_EDITION=ce` to ensure only MIT Community Edition code executes.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "0.92.3-hotfix.1",
    lastPushedAt: "2026-10-26",
    decision: "OPTIONAL",
    decisionRationale:
      "Superior license posture (`AP_EDITION=ce` MIT core) compared with n8n's Sustainable Use License for Zapier-style SaaS connector automation.",
    executionSurface: "Docker (Node.js + PostgreSQL + Redis + Isolated Sandboxed Workers)",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 25,
    gpuRequired: false,
    stateBacking: "PostgreSQL + Redis BullMQ",
    defaultPort: 8085,
    healthCheckEndpoint: "/api/v1/flags",
    authModel: "JWT auth (`AP_JWT_SECRET`)",
    tenantIsolationModel: "Single-org in CE (`AP_EDITION=ce`); multi-tenant projects live in EE",
    sandboxRequirements: "Set AP_EXECUTION_MODE=SANDBOX_CODE_ONLY or ISOLATED_SANDBOX",
    networkExposurePolicy: "Nginx TLS reverse proxy",
    telemetryDisableVars: ["AP_TELEMETRY_ENABLED=false"],
    securityRequirement: "Pin AP_EDITION=ce, AP_TELEMETRY_ENABLED=false, and CSPRNG AP_ENCRYPTION_KEY/AP_JWT_SECRET.",
    deployPresetId: null,
    bestFor: "No-code webhook & 200+ SaaS connector automations under MIT Community Edition.",
  },
  {
    id: "n8n",
    name: "n8n",
    category: "workflow-automation",
    officialRepo: "https://github.com/n8n-io/n8n",
    officialLicenseUrl: "https://github.com/n8n-io/n8n/blob/master/LICENSE.md",
    license: "Sustainable Use License v1.0 (fair-code) + n8n Enterprise License (`.ee.` files)",
    spdxId: "NOASSERTION (Sustainable Use License)",
    licenseTriage: "Commercial permission required or potentially required",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "Sustainable Use License explicitly restricts usage to 'your own internal business purposes or for non-commercial or personal use.' Hosting n8n for external paying tenants requires an n8n Embed/Enterprise commercial license.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "n8n@2.44.7",
    lastPushedAt: "2026-10-26",
    decision: "INTERNAL_ONLY",
    decisionRationale:
      "Permitted strictly for ALO Labs' internal back-office automation; prohibited as a hosted customer product without commercial license.",
    executionSurface: "Node.js / Docker + PostgreSQL + Redis queue workers",
    deploymentModes: ["docker-compose"],
    requiredServices: ["PostgreSQL", "Redis"],
    minVCpu: 2,
    minRamGb: 4,
    minDiskGb: 20,
    gpuRequired: false,
    stateBacking: "PostgreSQL",
    defaultPort: 5678,
    healthCheckEndpoint: "/healthz",
    authModel: "Owner/user account auth",
    tenantIsolationModel: "Internal single-company use only",
    sandboxRequirements: "Disable Execute Command node (`NODES_EXCLUDE=[\"n8n-nodes-base.executeCommand\"]`) and block SSRF",
    networkExposurePolicy: "Internal LAN / Tailscale + signed webhook ingress",
    telemetryDisableVars: ["N8N_DIAGNOSTICS_ENABLED=false", "N8N_VERSION_NOTIFICATIONS_ENABLED=false"],
    securityRequirement: "Set N8N_ENCRYPTION_KEY, disable ExecuteCommand node, and restrict to internal ALO workflows.",
    deployPresetId: null,
    bestFor: "Internal ALO Labs CRM/Ops glue workflows (not for customer resale).",
  },
  {
    id: "browser-use",
    name: "Browser Use",
    category: "browser-agent",
    officialRepo: "https://github.com/browser-use/browser-use",
    officialLicenseUrl: "https://github.com/browser-use/browser-use/blob/main/LICENSE",
    license: "MIT",
    spdxId: "MIT",
    licenseTriage: "License verified for intended use",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail: "Pure MIT License verified — license is commercial-safe, but headless Chromium introduces severe SSRF & prompt-injection risks on shared hosts.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "0.13.13",
    lastPushedAt: "2026-10-24",
    decision: "DEFER",
    decisionRationale:
      "Clean MIT choice over Skyvern (AGPL-3.0), but deferred until dedicated ephemeral microVM + Squid egress-filtering browser pool is provisioned.",
    executionSurface: "Python 3.12 + Ephemeral Playwright Chromium container",
    deploymentModes: ["isolated-vm-docker"],
    requiredServices: ["Ephemeral Chromium sandbox", "Squid SSRF Egress Proxy", "Vision LLM"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 30,
    gpuRequired: false,
    stateBacking: "Ephemeral per-task browser context (wiped after run)",
    defaultPort: null,
    healthCheckEndpoint: null,
    authModel: "Internal worker queue token",
    tenantIsolationModel: "Fresh disposable container per single browser session",
    sandboxRequirements: "Mandatory egress proxy blocking RFC1918, 127.0.0.0/8, and 169.254.169.254; `--no-sandbox` forbidden without seccomp/microVM",
    networkExposurePolicy: "Worker pulls jobs from queue; zero inbound public ports",
    telemetryDisableVars: ["ANONYMIZED_TELEMETRY=false"],
    securityRequirement: "Never run headless browser agents on the main Hosting-Portal or DB host.",
    deployPresetId: null,
    bestFor: "Future isolated web-research & form-testing workers inside ephemeral microVMs.",
  },
  {
    id: "skyvern",
    name: "Skyvern",
    category: "browser-agent",
    officialRepo: "https://github.com/Skyvern-AI/skyvern",
    officialLicenseUrl: "https://github.com/Skyvern-AI/skyvern/blob/main/LICENSE",
    license: "AGPL-3.0",
    spdxId: "AGPL-3.0",
    licenseTriage: "Not approved pending legal review",
    licenseCheckedAt: "2026-10-26",
    commercialMultiTenantSafe: false,
    licenseGuardrail:
      "GNU Affero General Public License v3.0 (AGPL-3.0) triggers network copyleft obligations when modified and offered over a network.",
    maintenanceStatus: "active",
    latestVerifiedVersion: "v1.0.56",
    lastPushedAt: "2026-10-26",
    decision: "REJECT",
    decisionRationale:
      "Rejected for Hosting-Portal integration due to AGPL-3.0 network copyleft when MIT-licensed `browser-use` covers the same capability.",
    executionSurface: "Docker Compose + Playwright + PostgreSQL",
    deploymentModes: ["isolated-vm-docker"],
    requiredServices: ["PostgreSQL", "Playwright"],
    minVCpu: 4,
    minRamGb: 8,
    minDiskGb: 40,
    gpuRequired: false,
    stateBacking: "PostgreSQL",
    defaultPort: 8000,
    healthCheckEndpoint: "/api/v1/health",
    authModel: "x-api-key header",
    tenantIsolationModel: "Not approved for SaaS hosting",
    sandboxRequirements: "Isolated VM + egress firewall",
    networkExposurePolicy: "Not deployed",
    telemetryDisableVars: ["SKYVERN_TELEMETRY=false"],
    securityRequirement: "Do not embed or modify in proprietary SaaS without formal legal sign-off.",
    deployPresetId: null,
    bestFor: "Excluded in favor of MIT-licensed `browser-use`.",
  },
] as const;

/**
 * Validates every entry in `SELF_HOSTED_AGENT_PLATFORMS` against the canonical
 * integration metadata schema (Section 13). Throws on any malformed/duplicate entry.
 */
export function validateAgentCatalog(
  entries: readonly SelfHostedAgentPlatform[] = SELF_HOSTED_AGENT_PLATFORMS,
): { valid: true; count: number } {
  const ids = new Set<string>();
  for (const entry of entries) {
    agentPlatformMetadataSchema.parse(entry);
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate self-hosted agent catalog id "${entry.id}"`);
    }
    ids.add(entry.id);
    if (entry.decision === "REJECT" && entry.deployPresetId !== null) {
      throw new Error(`Rejected platform "${entry.id}" must not expose a 1-click deployPresetId`);
    }
    if (entry.commercialMultiTenantSafe && entry.licenseTriage !== "License verified for intended use") {
      throw new Error(
        `Platform "${entry.id}" cannot be commercialMultiTenantSafe=true with triage "${entry.licenseTriage}"`,
      );
    }
  }
  return { valid: true, count: entries.length };
}

// ── Section 6: 13-Use-Case Decision Matrix ──────────────────────────────────

export interface UseCaseRecommendation {
  useCaseId: string;
  useCase: string;
  primaryRecommendation: string;
  backupOption: string;
  requiredInfrastructure: string;
  keyRisks: string;
  licenseNotes: string;
}

export const USE_CASE_DECISION_MATRIX: readonly UseCaseRecommendation[] = [
  {
    useCaseId: "internal-staff-copilot",
    useCase: "1. Internal Staff AI Assistant / Copilot",
    primaryRecommendation: "Open WebUI (v0.12.4) + LiteLLM + Ollama/GLM-5 (via alo-server-kit)",
    backupOption: "LibreChat (MIT)",
    requiredInfrastructure: "4 vCPU, 16 GB RAM (+ 12–24 GB VRAM GPU if local 7B/14B), loopback LiteLLM",
    keyRisks: "Shared master key exposure if systemd unit is world-readable (fixed via 0600 open-webui.env)",
    licenseNotes: "Open WebUI License: internal <=50 users safe; preserve Open WebUI branding. Use LibreChat (MIT) above 50 users or with custom branding.",
  },
  {
    useCaseId: "customer-multi-tenant-saas",
    useCase: "2. Customer-Facing Multi-Tenant SaaS Assistant",
    primaryRecommendation: "LangGraph Server (1.2.17) or Agno (3.1.10) + LibreChat (MIT) UI",
    backupOption: "Langflow (1.13.0, MIT)",
    requiredInfrastructure: "Per-tenant DB schema/row filter, PostgreSQL + pgvector, LiteLLM virtual keys",
    keyRisks: "Cross-tenant prompt/context bleed if thread_id or vector filters omit verified ownerId",
    licenseNotes: "MIT (LangGraph, LibreChat, Langflow) & Apache-2.0 (Agno) — verified for commercial multi-tenant SaaS. Avoid Dify/n8n here.",
  },
  {
    useCaseId: "low-code-visual-builder",
    useCase: "3. Low-Code Visual Agent Builder",
    primaryRecommendation: "Langflow (v1.13.0, pure MIT)",
    backupOption: "Flowise OSS Core (3.1.4, single-tenant only)",
    requiredInfrastructure: "2 vCPU, 4 GB RAM, PostgreSQL, Nginx TLS",
    keyRisks: "Arbitrary Python/JS custom component execution if untrusted users get builder access",
    licenseNotes: "Langflow is pure MIT. Flowise has commercial license on `packages/server/src/enterprise` & `IdentityManager.ts`.",
  },
  {
    useCaseId: "code-first-stateful-api",
    useCase: "4. Code-First Stateful Agent API",
    primaryRecommendation: "LangGraph (1.2.17) + PostgreSQL Checkpointer",
    backupOption: "Pydantic AI (2.61.0) or Agno (3.1.10)",
    requiredInfrastructure: "2–4 vCPU, 4–8 GB RAM, PostgreSQL",
    keyRisks: "Unbounded graph recursion without recursion_limit and per-run token budget",
    licenseNotes: "MIT (LangGraph, Pydantic AI) / Apache-2.0 (Agno) — License verified for intended use.",
  },
  {
    useCaseId: "multi-agent-team",
    useCase: "5. Multi-Agent Team Workflow",
    primaryRecommendation: "CrewAI (1.15.30) or Agno Teams (3.1.10)",
    backupOption: "LangGraph Supervisor Graph",
    requiredInfrastructure: "2–4 vCPU, 4–8 GB RAM, PostgreSQL, Redis/Queue for >60s runs",
    keyRisks: "Token amplification loops between delegating agents; cap max_iter and max_rpm",
    licenseNotes: "MIT (CrewAI) / Apache-2.0 (Agno) — License verified for intended use.",
  },
  {
    useCaseId: "long-term-memory-assistant",
    useCase: "6. Long-Term Memory Assistant / Tutor",
    primaryRecommendation: "Letta (0.34.12) + PostgreSQL pgvector",
    backupOption: "Agno Session + Memory Tables (Apache-2.0)",
    requiredInfrastructure: "2–4 vCPU, 4–8 GB RAM, PostgreSQL 16 + pgvector",
    keyRisks: "Memory poisoning across sessions if archival writes are not tenant-partitioned",
    licenseNotes: "Apache-2.0 (Letta) — License verified for intended use.",
  },
  {
    useCaseId: "rag-document-assistant",
    useCase: "7. Knowledge-Intensive RAG / Document Assistant",
    primaryRecommendation: "Haystack (3.4.1) or LlamaIndex (0.14.25) + pgvector/Qdrant",
    backupOption: "Langflow RAG Flow (MIT)",
    requiredInfrastructure: "4 vCPU, 8 GB RAM, PostgreSQL + pgvector + local BGE/Nomic embeddings",
    keyRisks: "Indirect prompt injection from uploaded PDFs/HTML; enforce strict tenant_id metadata filter",
    licenseNotes: "Apache-2.0 (Haystack) / MIT (LlamaIndex) — License verified for intended use.",
  },
  {
    useCaseId: "browser-automation-agent",
    useCase: "8. Browser Automation Agent",
    primaryRecommendation: "Browser Use (0.13.13) inside Dedicated Ephemeral MicroVM (Deferred on shared nodes)",
    backupOption: "Playwright Deterministic Scripts (non-LLM)",
    requiredInfrastructure: "Dedicated worker VM, ephemeral Chromium container, Squid SSRF egress proxy",
    keyRisks: "Critical SSRF (169.254.169.254 / RFC1918), credential theft, and DOM prompt injection",
    licenseNotes: "Browser Use is MIT (`License verified for intended use`). Skyvern is AGPL-3.0 (`Not approved pending legal review`).",
  },
  {
    useCaseId: "coding-devops-agent",
    useCase: "9. Coding / Software Engineering / DevOps Agent",
    primaryRecommendation: "OpenHands (v1.33.0) on Dedicated Engineering VM + Aider/Cline via LiteLLM",
    backupOption: "Aider CLI (Apache-2.0) on developer workstation",
    requiredInfrastructure: "Dedicated VM (4+ vCPU, 16 GB RAM), rootless Docker/Sysbox, egress firewall",
    keyRisks: "Container escape or host secret exfiltration if run on shared production hosting nodes",
    licenseNotes: "OpenHands is MIT (`Internal use recommended` due to execution surface); Aider & Cline are Apache-2.0.",
  },
  {
    useCaseId: "durable-business-workflow",
    useCase: "10. Durable Business Workflow Automation",
    primaryRecommendation: "Hosting-Portal Built-In DAG Engine (<=40 nodes, <=120s/step) -> Trigger.dev v4 (Apache-2.0)",
    backupOption: "Activepieces CE (`AP_EDITION=ce`, MIT core) or Temporal (MIT)",
    requiredInfrastructure: "Trigger.dev: Postgres + Redis + ClickHouse; Built-in DAG: zero extra infra",
    keyRisks: "Synchronous HTTP timeouts for >2m jobs if not offloaded to Trigger.dev/BullMQ",
    licenseNotes: "Trigger.dev (Apache-2.0) & Temporal (MIT) verified; n8n Sustainable Use License is internal-only.",
  },
  {
    useCaseId: "private-local-inference",
    useCase: "11. Private Local Model Inference",
    primaryRecommendation: "Ollama (7B–14B single node) + LiteLLM Gateway; vLLM/SGLang (multi-user GPU) + LocalAI (audio/embeddings)",
    backupOption: "GLM-5 (`api.z.ai`) encrypted cloud fallback when local GPU unavailable",
    requiredInfrastructure: "12–24 GB VRAM (7B–14B Q4), 48–80 GB VRAM (32B–70B Q4), NVMe model storage",
    keyRisks: "VRAM OOM under concurrent long-context requests if KV cache is unbudgeted",
    licenseNotes: "MIT (Ollama, LocalAI, LiteLLM core) / Apache-2.0 (vLLM, SGLang, Qwen 2.5, GLM-5).",
  },
  {
    useCaseId: "agent-eval-observability",
    useCase: "12. Agent Evaluation, Tracing, and Observability",
    primaryRecommendation: "Langfuse OSS Core (v4.70.0) + Agenta OSS Core (v0.125.0)",
    backupOption: "Hosting-Portal `AIUsage` + `AuditLog` + `X-Request-Id` structured logs",
    requiredInfrastructure: "4 vCPU, 12 GB RAM, PostgreSQL + ClickHouse + Redis (Docker Compose)",
    keyRisks: "Logging raw customer PII or API keys into trace payloads unless scrubbed prior to export",
    licenseNotes: "Both MIT Expat outside `ee/` directories (`Conditional, requires additional review` — run OSS non-EE mode).",
  },
  {
    useCaseId: "zero-terminal-customer-deploy",
    useCase: "13. Zero-Terminal Customer Deployment Experience",
    primaryRecommendation: "Hosting-Portal Zero-Terminal AI Studio (`/ai/assistant`) with 11 Pinned Stack Presets",
    backupOption: "Deterministic Preset Mode (`action: preset`, works with zero AI keys)",
    requiredInfrastructure: "Hosting-Portal control plane + `alo-hosting-helper` bare-metal release activator",
    keyRisks: "Confusing DB blueprint creation with live process readiness (solved via `CONFIGURED_AWAITING_RELEASE` vs `LIVE_HEALTHY` HTTP probe)",
    licenseNotes: "First-party Hosting-Portal code + pure MIT/Apache-2.0 default customer presets (`langflow`, `langgraph`, `crewai`, `agno`, `letta`).",
  },
] as const;

// ── Section 9: Parameterized Hardware & VRAM Sizing Engine ──────────────────

export type QuantizationFormat = "fp16" | "q8" | "q6" | "q4_k_m" | "int4";

export interface SizingInput {
  /** Model size in billions of active/total loaded parameters (`0` = external cloud/gateway API only). */
  parameterBillions: number;
  quantization?: QuantizationFormat;
  /** Target context window per concurrent slot (tokens). */
  contextTokens?: number;
  /** Simultaneous active generation slots. */
  concurrentRequests?: number;
  /** Co-host a local embedding model (~0.6–1.5 GB VRAM). */
  includeEmbeddings?: boolean;
  /** Co-host a local cross-encoder reranker (~0.8–1.5 GB VRAM). */
  includeReranker?: boolean;
  /** Co-host isolated headless Chromium sandboxes on the orchestration tier. */
  includeBrowserSandbox?: boolean;
  /** Extra CUDA context, activation buffers & allocator fragmentation headroom (default 15%). */
  safetyMarginPct?: number;
}

export interface SizingEstimate {
  isEstimate: true;
  mode: "orchestration-only" | "local-gpu-inference";
  orchestrationNode: {
    recommendedVCpu: number;
    recommendedRamGb: number;
    recommendedDiskGb: number;
  };
  inferenceNode: {
    weightsVramGb: number;
    kvCacheVramGb: number;
    auxiliaryModelsVramGb: number;
    runtimeAndSafetyMarginVramGb: number;
    estimatedMinVramGb: number;
    estimatedMaxVramGb: number;
    recommendedGpuTier: string;
    recommendedSystemRamGb: number;
    recommendedModelDiskGb: number;
  };
  assumptions: string[];
  warnings: string[];
}

export class SizingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SizingValidationError";
  }
}

const BYTES_PER_PARAM: Record<QuantizationFormat, number> = {
  fp16: 2.0,
  q8: 1.05,
  q6: 0.82,
  q4_k_m: 0.62,
  int4: 0.58,
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function recommendGpuTierLabel(maxVramGb: number): string {
  if (maxVramGb <= 0) return "No GPU required (CPU orchestration node + API/Gateway LLM)";
  if (maxVramGb <= 12) return "1x 16 GB GPU (NVIDIA RTX 4000 SFF Ada / L4 24 GB recommended)";
  if (maxVramGb <= 22) return "1x 24 GB GPU (NVIDIA L4 / RTX 4090 / RTX A5000)";
  if (maxVramGb <= 44) return "1x 48 GB GPU (NVIDIA L40S / RTX 6000 Ada) or 2x 24 GB GPUs";
  if (maxVramGb <= 76) return "1x 80 GB GPU (NVIDIA A100 80 GB / H100 80 GB)";
  if (maxVramGb <= 152) return "2x 80 GB GPUs (2x A100/H100 NVLink) or 1x H200 141 GB";
  return `${Math.ceil(maxVramGb / 72)}x 80 GB GPUs (Multi-GPU Tensor-Parallel vLLM / SGLang cluster)`;
}

/**
 * Computes realistic, bounded hardware & VRAM estimates separating the
 * Agent Orchestration tier (CPU/RAM/Postgres/Vector) from the Local Inference
 * GPU tier (Weights + GQA KV Cache x Concurrency + Embeddings/Reranker + Safety Margin).
 */
export function calculateSelfHostedSizing(input: SizingInput): SizingEstimate {
  if (!Number.isFinite(input.parameterBillions) || input.parameterBillions < 0 || input.parameterBillions > 2000) {
    throw new SizingValidationError("parameterBillions must be a finite number between 0 and 2000");
  }

  const quantization: QuantizationFormat = input.quantization ?? "q4_k_m";
  if (!(quantization in BYTES_PER_PARAM)) {
    throw new SizingValidationError(`Unsupported quantization "${String(quantization)}"`);
  }

  const contextTokens = input.contextTokens ?? 8192;
  if (!Number.isFinite(contextTokens) || contextTokens < 512 || contextTokens > 1_048_576) {
    throw new SizingValidationError("contextTokens must be between 512 and 1,048,576");
  }

  const concurrentRequests = input.concurrentRequests ?? 2;
  if (!Number.isInteger(concurrentRequests) || concurrentRequests < 1 || concurrentRequests > 256) {
    throw new SizingValidationError("concurrentRequests must be an integer between 1 and 256");
  }

  const safetyMarginPct = input.safetyMarginPct ?? 15;
  if (!Number.isFinite(safetyMarginPct) || safetyMarginPct < 5 || safetyMarginPct > 100) {
    throw new SizingValidationError("safetyMarginPct must be between 5 and 100");
  }

  const includeEmbeddings = Boolean(input.includeEmbeddings);
  const includeReranker = Boolean(input.includeReranker);
  const includeBrowserSandbox = Boolean(input.includeBrowserSandbox);

  // Orchestration node sizing (Postgres + pgvector + agent workers + Nginx + optional browser pool)
  const baseOrchCpu = 4 + Math.ceil(concurrentRequests / 8) * 2 + (includeBrowserSandbox ? 4 : 0);
  const baseOrchRam = 8 + Math.ceil(concurrentRequests / 4) * 2 + (includeBrowserSandbox ? 8 : 0);
  const baseOrchDisk = 60 + concurrentRequests * 2 + (includeBrowserSandbox ? 30 : 0);

  const warnings: string[] = [];
  if (includeBrowserSandbox) {
    warnings.push(
      "Headless browser sandboxes MUST run on an isolated worker VM with a Squid SSRF egress proxy — never co-locate with production databases.",
    );
  }

  if (input.parameterBillions === 0) {
    const auxVram = (includeEmbeddings ? 1.2 : 0) + (includeReranker ? 1.2 : 0);
    return {
      isEstimate: true,
      mode: "orchestration-only",
      orchestrationNode: {
        recommendedVCpu: baseOrchCpu,
        recommendedRamGb: baseOrchRam,
        recommendedDiskGb: baseOrchDisk,
      },
      inferenceNode: {
        weightsVramGb: 0,
        kvCacheVramGb: 0,
        auxiliaryModelsVramGb: round1(auxVram),
        runtimeAndSafetyMarginVramGb: auxVram > 0 ? 0.8 : 0,
        estimatedMinVramGb: auxVram > 0 ? Math.ceil(auxVram + 0.8) : 0,
        estimatedMaxVramGb: auxVram > 0 ? Math.ceil((auxVram + 0.8) * 1.2) : 0,
        recommendedGpuTier:
          auxVram > 0
            ? "CPU embeddings supported, or optional 8–16 GB GPU for high-throughput embedding/reranking"
            : "No GPU required (CPU orchestration node + API/Gateway LLM)",
        recommendedSystemRamGb: baseOrchRam,
        recommendedModelDiskGb: auxVram > 0 ? 15 : 0,
      },
      assumptions: [
        "Estimate only — primary LLM calls route to external/gateway OpenAI-compatible API (e.g., GLM-5, Groq, LiteLLM).",
        `Orchestration node sized for ${concurrentRequests} concurrent agent runs + PostgreSQL/pgvector.`,
      ],
      warnings,
    };
  }

  // Model weights in GiB/GB
  const bytesPerParam = BYTES_PER_PARAM[quantization];
  const weightsVramGb = input.parameterBillions * bytesPerParam;

  // Empirical GQA FP16 KV-cache heuristic (~0.018 GB per 1B params per 8k tokens, bounded for large GQA models)
  const effectiveKvScale = Math.min(input.parameterBillions, 80) * 0.018 + Math.max(0, input.parameterBillions - 80) * 0.005;
  const kvPerSlotGb = effectiveKvScale * (contextTokens / 8192);
  const kvCacheVramGb = kvPerSlotGb * concurrentRequests;

  const auxiliaryModelsVramGb = (includeEmbeddings ? 1.2 : 0) + (includeReranker ? 1.3 : 0);
  const cudaBaseOverheadGb = 1.2;
  const subtotalVram = weightsVramGb + kvCacheVramGb + auxiliaryModelsVramGb + cudaBaseOverheadGb;
  const marginGb = subtotalVram * (safetyMarginPct / 100);
  const minVram = Math.ceil(subtotalVram + marginGb * 0.6);
  const maxVram = Math.ceil(subtotalVram + marginGb * 1.4);

  if (concurrentRequests > 4 && contextTokens >= 32768) {
    warnings.push(
      "High concurrency with >=32k context causes rapid KV-cache growth; use vLLM or SGLang with PagedAttention & FP8 KV cache rather than single-queue Ollama.",
    );
  }
  if (maxVram > 80) {
    warnings.push(
      "Estimated VRAM exceeds a single 80 GB GPU; plan multi-GPU NVLink tensor parallelism (`--tensor-parallel-size`) and verify interconnect bandwidth.",
    );
  }

  // Host RAM >= 1.5x model weights (min 16 GB) for mmap/checkpoint loading; disk >= 2.5x weights + 40 GB OS/cache
  const recommendedSystemRamGb = Math.max(16, Math.ceil(weightsVramGb * 1.5 + 8));
  const recommendedModelDiskGb = Math.max(40, Math.ceil(weightsVramGb * 2.5 + 30));

  return {
    isEstimate: true,
    mode: "local-gpu-inference",
    orchestrationNode: {
      recommendedVCpu: baseOrchCpu,
      recommendedRamGb: baseOrchRam,
      recommendedDiskGb: baseOrchDisk,
    },
    inferenceNode: {
      weightsVramGb: round1(weightsVramGb),
      kvCacheVramGb: round1(kvCacheVramGb),
      auxiliaryModelsVramGb: round1(auxiliaryModelsVramGb),
      runtimeAndSafetyMarginVramGb: round1(cudaBaseOverheadGb + marginGb),
      estimatedMinVramGb: minVram,
      estimatedMaxVramGb: maxVram,
      recommendedGpuTier: recommendGpuTierLabel(maxVram),
      recommendedSystemRamGb,
      recommendedModelDiskGb,
    },
    assumptions: [
      `Estimate only (not a hardware benchmark): ${input.parameterBillions}B parameters at ${quantization.toUpperCase()} (~${bytesPerParam} bytes/param).`,
      `KV cache budgeted across ${concurrentRequests} concurrent slot(s) x ${contextTokens.toLocaleString()} tokens assuming GQA attention.`,
      `Includes ${ cudaBaseOverheadGb } GB CUDA/runtime workspace + ${safetyMarginPct}% allocator fragmentation safety margin.`,
    ],
    warnings,
  };
}

// ── Preset Sizing Profiles (derived conservatively for UI quick-reference) ──

export type ModelScaleOption =
  | "api-gateway-only"
  | "7b-q4"
  | "13b-q4"
  | "32b-moe-q4"
  | "70b-q4-16k"
  | "70b-q4-128k"
  | "70b-fp8-128k"
  | "70b-bf16-or-frontier";

export interface HardwareSizingProfile {
  id: ModelScaleOption;
  label: string;
  quantization: string;
  minVramGb: number;
  estimatedMaxVramGb: number;
  minSystemRamGb: number;
  minDiskGb: number;
  contextWindow: string;
  concurrencyAssumed: number;
  recommendedHardware: string;
  exampleModels: string;
}

export const VRAM_SIZING_PROFILES: readonly HardwareSizingProfile[] = [
  {
    id: "api-gateway-only",
    label: "Agent Orchestration Only (External / Gateway LLM)",
    quantization: "N/A (CPU host)",
    minVramGb: 0,
    estimatedMaxVramGb: 0,
    minSystemRamGb: 16,
    minDiskGb: 80,
    contextWindow: "Up to upstream model limit (128k–200k)",
    concurrencyAssumed: 8,
    recommendedHardware: "Est. 4–6 vCPU, 16 GB RAM, 80 GB NVMe Linux VPS (Langflow / LangGraph / CrewAI / Agno / Letta + GLM-5 or LiteLLM)",
    exampleModels: "GLM-5 (API), Groq Llama-3.3-70B, LLM7",
  },
  {
    id: "7b-q4",
    label: "7B–8B Local Model (2 Concurrent x 16k Context)",
    quantization: "4-bit (GGUF Q4_K_M / AWQ)",
    minVramGb: 9,
    estimatedMaxVramGb: 12,
    minSystemRamGb: 16,
    minDiskGb: 60,
    contextWindow: "8k–16k tokens (2 slots)",
    concurrencyAssumed: 2,
    recommendedHardware: "Est. 1x 16–24 GB GPU (RTX 4000 Ada / L4) + 16 GB host RAM + 60 GB NVMe",
    exampleModels: "Llama 3.1 8B, Qwen 2.5 7B, DeepSeek-R1-Distill-8B",
  },
  {
    id: "13b-q4",
    label: "14B Local Model + Local Embeddings (4 Concurrent x 16k)",
    quantization: "4-bit (GGUF Q4_K_M / AWQ)",
    minVramGb: 15,
    estimatedMaxVramGb: 20,
    minSystemRamGb: 32,
    minDiskGb: 80,
    contextWindow: "16k tokens (4 slots)",
    concurrencyAssumed: 4,
    recommendedHardware: "Est. 1x 24 GB GPU (NVIDIA L4 / RTX 4090) + 32 GB RAM + 80 GB NVMe",
    exampleModels: "Qwen 2.5 14B Instruct, Phi-4 14B",
  },
  {
    id: "32b-moe-q4",
    label: "32B Coding / Agentic Model (4 Concurrent x 32k)",
    quantization: "4-bit (AWQ / GGUF)",
    minVramGb: 28,
    estimatedMaxVramGb: 36,
    minSystemRamGb: 64,
    minDiskGb: 120,
    contextWindow: "32k tokens (4 slots)",
    concurrencyAssumed: 4,
    recommendedHardware: "Est. 1x 48 GB GPU (L40S / RTX 6000 Ada) or 2x 24 GB GPUs + 64 GB RAM",
    exampleModels: "Qwen 2.5 Coder 32B, GLM-4-32B, DeepSeek-R1-Distill-32B",
  },
  {
    id: "70b-q4-16k",
    label: "70B Local Model — Standard Context (2 Concurrent x 16k)",
    quantization: "4-bit (AWQ / GGUF)",
    minVramGb: 52,
    estimatedMaxVramGb: 62,
    minSystemRamGb: 96,
    minDiskGb: 180,
    contextWindow: "16k tokens (2 slots)",
    concurrencyAssumed: 2,
    recommendedHardware: "Est. 1x 80 GB GPU (A100/H100) or 2x 48 GB GPUs + 96 GB host RAM",
    exampleModels: "Llama 3.3 70B Instruct (AWQ), Qwen 2.5 72B (AWQ)",
  },
  {
    id: "70b-q4-128k",
    label: "70B Local Model — Long Context (4 Concurrent x 64k)",
    quantization: "4-bit weights + FP8/FP16 KV cache",
    minVramGb: 72,
    estimatedMaxVramGb: 92,
    minSystemRamGb: 128,
    minDiskGb: 200,
    contextWindow: "64k tokens (4 slots)",
    concurrencyAssumed: 4,
    recommendedHardware: "Est. 2x 80 GB GPUs (or 1x H200 141 GB) running vLLM/SGLang + 128 GB RAM",
    exampleModels: "Llama 3.3 70B (long-context vLLM), Qwen 2.5 72B",
  },
  {
    id: "70b-fp8-128k",
    label: "70B Enterprise FP8 High-Throughput vLLM (8 Concurrent x 64k)",
    quantization: "8-bit (FP8)",
    minVramGb: 115,
    estimatedMaxVramGb: 148,
    minSystemRamGb: 160,
    minDiskGb: 260,
    contextWindow: "64k tokens (8 slots)",
    concurrencyAssumed: 8,
    recommendedHardware: "Est. 2x NVIDIA H100 (80 GB NVLink) or 2x H200 + 160 GB RAM",
    exampleModels: "Llama 3.3 70B FP8, Qwen 2.5 72B FP8",
  },
  {
    id: "70b-bf16-or-frontier",
    label: "Unquantized 70B BF16 / Frontier MoE Cluster (GLM-5 / DeepSeek)",
    quantization: "16-bit (BF16) / Multi-Node FP8 MoE",
    minVramGb: 185,
    estimatedMaxVramGb: 640,
    minSystemRamGb: 256,
    minDiskGb: 800,
    contextWindow: "64k–128k+ tokens",
    concurrencyAssumed: 8,
    recommendedHardware: "Est. 4x to 8x 80 GB+ GPUs (H100/H200 NVLink) running vLLM / SGLang tensor-parallel",
    exampleModels: "Llama 3.3 70B BF16 (~190 GB), Frontier MoE GLM-5 / DeepSeek (~8x H100/H200)",
  },
] as const;

export function recommendSelfHostedHardware(scale: ModelScaleOption): HardwareSizingProfile {
  return (
    VRAM_SIZING_PROFILES.find((profile) => profile.id === scale) ?? VRAM_SIZING_PROFILES[0]!
  );
}
