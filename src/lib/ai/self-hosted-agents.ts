/**
 * Verified Self-Hosted AI Agent & Inference Platform Catalog + Decision Matrix
 *
 * Every entry in this file was audited against its upstream GitHub repository,
 * official `LICENSE` file, enterprise/ee directory boundary, and upstream
 * Docker configuration as of October 2026.
 *
 * Core engineering & legal-hygiene rules:
 *  1. Pinned upstream release tags only — `:latest` and `:main` are forbidden.
 *  2. License triage uses conservative operational labels, never legal advice.
 *  3. Platforms whose license restricts multi-tenant SaaS hosting (e.g. Dify,
 *     n8n) or white-label >50-user hosting (Open WebUI) are explicitly flagged
 *     and blocked from unattended multi-tenant click-deploy.
 *  4. SDKs/frameworks (LangGraph, CrewAI, Agno) and multi-service compose
 *     stacks (LibreChat, Activepieces, Agenta, Langfuse) are distinguished from
 *     single-container deployable presets — never misrepresenting an SDK as a
 *     turnkey GUI server.
 */

import { z } from "zod";
import type { StackPresetId } from "@/lib/ai/deploy-assistant";

export const LicenseTriageLabelSchema = z.enum([
  "License verified for intended use",
  "Conditional, requires additional review",
  "Commercial permission required or potentially required",
  "Internal use recommended",
  "Not approved pending legal review",
]);
export type LicenseTriageLabel = z.infer<typeof LicenseTriageLabelSchema>;

export const PlatformAuditDecisionSchema = z.enum([
  "KEEP",
  "IMPROVE",
  "ADD",
  "OPTIONAL",
  "INTERNAL ONLY",
  "DEFER",
  "REJECT",
]);
export type PlatformAuditDecision = z.infer<typeof PlatformAuditDecisionSchema>;

export const AgentCategorySchema = z.enum([
  "ai-coworker-workspace",
  "agent-builder-framework",
  "workflow-automation",
  "browser-automation",
  "coding-swe-agent",
  "local-inference-gateway",
  "memory-eval-observability",
]);
export type AgentCategory = z.infer<typeof AgentCategorySchema>;

export const DeploymentModeSchema = z.enum([
  "single-container-verified",
  "multi-service-compose",
  "sdk-runtime",
  "restricted-commercial-review",
]);
export type DeploymentMode = z.infer<typeof DeploymentModeSchema>;

export const PresetEnvVarSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  label: z.string().min(2),
  description: z.string().min(4),
  required: z.boolean(),
  secret: z.boolean(),
  autoGenerateSecret: z.boolean().default(false),
  defaultValue: z.string().optional(),
});
export type PresetEnvVar = z.infer<typeof PresetEnvVarSchema>;

export const SelfHostedAgentPresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(2),
  category: AgentCategorySchema,
  architectureKind: z.enum([
    "full-application",
    "visual-builder",
    "inference-server",
    "vector-memory-db",
    "workflow-engine",
    "sdk-framework",
    "eval-observability",
  ]),
  deploymentMode: DeploymentModeSchema,
  auditDecision: PlatformAuditDecisionSchema,
  upstreamRepo: z.string().url(),
  docsUrl: z.string().url(),
  verifiedReleaseVersion: z.string().min(1),
  licenseIdentifier: z.string().min(2),
  enterpriseDirectoryPresent: z.boolean(),
  licenseTriage: LicenseTriageLabelSchema,
  commercialMultiTenantAllowed: z.enum(["yes", "conditional", "no"]),
  licenseNotes: z.string().min(10),
  summary: z.string().min(10),
  /** Pinned container image (never :latest) for container/compose modes; null for pure SDKs. */
  dockerImage: z
    .string()
    .refine((val) => !val.endsWith(":latest") && !val.endsWith(":main") && !val.endsWith(":master"), {
      message: "Preset container images must be pinned to an explicit version tag (never :latest/:main/:master).",
    })
    .nullable(),
  defaultHostPort: z.number().int().min(1024).max(65535).nullable(),
  containerPort: z.number().int().min(1).max(65535).nullable(),
  healthcheckPath: z.string().startsWith("/").nullable(),
  namedVolumeTarget: z.string().startsWith("/").nullable(),
  backupGuidance: z.string().min(8),
  hardwareMinimum: z.object({
    cpuCores: z.number().min(1),
    ramGb: z.number().min(0.5),
    diskGb: z.number().min(2),
    gpuRequired: z.boolean(),
    recommendedVramGb: z.number().min(0),
  }),
  containerLimits: z.object({
    cpus: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
    memory: z.string().regex(/^[0-9]+[mMgG]$/),
  }),
  supportedInferenceBackends: z.array(z.string()).min(1),
  securityNotes: z.array(z.string()).min(1),
  envVars: z.array(PresetEnvVarSchema),
});

export type SelfHostedAgentPreset = z.infer<typeof SelfHostedAgentPresetSchema>;

const RAW_PRESETS: SelfHostedAgentPreset[] = [
  {
    id: "langflow",
    name: "Langflow Visual Agent Builder",
    category: "agent-builder-framework",
    architectureKind: "visual-builder",
    deploymentMode: "single-container-verified",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/langflow-ai/langflow",
    docsUrl: "https://docs.langflow.org",
    verifiedReleaseVersion: "1.13.0",
    licenseIdentifier: "MIT",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes:
      "Clean MIT license in upstream LICENSE with no commercial EE subdirectory trap. Recommended primary visual agent builder for ALO Hosting Portal.",
    summary:
      "Visual low-code Python AI agent & RAG flow builder with native MCP server/client support, REST API endpoints per flow, and OpenAI-compatible provider blocks.",
    dockerImage: "langflowai/langflow:1.13.0",
    defaultHostPort: 7860,
    containerPort: 7860,
    healthcheckPath: "/health_check",
    namedVolumeTarget: "/app/langflow",
    backupGuidance:
      "Back up named volume `/app/langflow` (SQLite + secret key + uploaded flows) or external PostgreSQL database (`LANGFLOW_DATABASE_URL`) before image upgrades.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 4,
      diskGb: 15,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq", "llm7"],
    securityNotes: [
      "Always set LANGFLOW_AUTO_LOGIN=false and explicit superuser credentials before reverse-proxying.",
      "Bind container port to 127.0.0.1 only; terminate TLS in Nginx with rate limiting.",
      "Isolate one Langflow instance per customer tenant when storing tenant API keys.",
    ],
    envVars: [
      {
        key: "LANGFLOW_AUTO_LOGIN",
        label: "Disable Auto-Login",
        description: "Forces authentication on the Langflow UI and API.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "false",
      },
      {
        key: "LANGFLOW_SUPERUSER",
        label: "Admin Username",
        description: "Initial Langflow administrator username.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "admin",
      },
      {
        key: "LANGFLOW_SUPERUSER_PASSWORD",
        label: "Admin Password",
        description: "Strong initial administrator password (auto-generated if omitted).",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
      {
        key: "LANGFLOW_SECRET_KEY",
        label: "Encryption Secret Key",
        description: "Encrypts stored provider credentials inside Langflow.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
      {
        key: "LANGFLOW_CONFIG_DIR",
        label: "Persistent Config Path",
        description: "Directory backed by the named Docker volume.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/app/langflow",
      },
    ],
  },
  {
    id: "flowise",
    name: "Flowise Agentflow Server (Single-Tenant OSS)",
    category: "agent-builder-framework",
    architectureKind: "visual-builder",
    deploymentMode: "single-container-verified",
    auditDecision: "OPTIONAL",
    upstreamRepo: "https://github.com/FlowiseAI/Flowise",
    docsUrl: "https://docs.flowiseai.com",
    verifiedReleaseVersion: "3.1.4",
    licenseIdentifier: "Apache-2.0 (core) + FlowiseAI Commercial License (packages/server/src/enterprise)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Conditional, requires additional review",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "Core Flowise is Apache-2.0, but `packages/server/src/enterprise/` (SSO, RBAC workspaces, multi-user enterprise management) is governed by the FlowiseAI Enterprise Commercial License. Approved ONLY for isolated single-tenant OSS use without enabling enterprise license features.",
    summary:
      "TypeScript/Node.js visual drag-and-drop builder for Chatflows, Agentflows, and RAG pipelines with 100+ integrations.",
    dockerImage: "flowiseai/flowise:3.1.4",
    defaultHostPort: 3010,
    containerPort: 3000,
    healthcheckPath: "/api/v1/ping",
    namedVolumeTarget: "/root/.flowise",
    backupGuidance:
      "Snapshot `/root/.flowise` (database.sqlite, encryption.key, logs, storage) together — losing `encryption.key` invalidates encrypted credentials.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 2,
      diskGb: 10,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "2g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq"],
    securityNotes: [
      "Disable custom JS function external package installation (TOOL_FUNCTION_EXTERNAL_DEP empty) in shared environments.",
      "Do not activate enterprise workspace/RBAC modules without a Flowise commercial license.",
      "Bind strictly to 127.0.0.1:<port> and enforce FLOWISE_USERNAME / FLOWISE_PASSWORD.",
    ],
    envVars: [
      {
        key: "PORT",
        label: "Internal Port",
        description: "HTTP port inside the Flowise container.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "3000",
      },
      {
        key: "DATABASE_PATH",
        label: "Database Directory",
        description: "Persistent SQLite directory inside the named volume.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/root/.flowise",
      },
      {
        key: "SECRETKEY_PATH",
        label: "Secret Key Directory",
        description: "Persistent encryption key storage path.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/root/.flowise",
      },
      {
        key: "LOG_PATH",
        label: "Log Directory",
        description: "Flowise log output directory.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/root/.flowise/logs",
      },
      {
        key: "BLOB_STORAGE_PATH",
        label: "Blob Storage Directory",
        description: "Uploaded document storage path.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/root/.flowise/storage",
      },
      {
        key: "FLOWISE_USERNAME",
        label: "Admin Username",
        description: "Basic/admin login username.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "admin",
      },
      {
        key: "FLOWISE_PASSWORD",
        label: "Admin Password",
        description: "Strong administrator password.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
      {
        key: "FLOWISE_SECRETKEY_OVERWRITE",
        label: "Credential Encryption Secret",
        description: "Master encryption key for stored API credentials.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama Local Model Server",
    category: "local-inference-gateway",
    architectureKind: "inference-server",
    deploymentMode: "single-container-verified",
    auditDecision: "KEEP",
    upstreamRepo: "https://github.com/ollama/ollama",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    verifiedReleaseVersion: "0.40.11",
    licenseIdentifier: "MIT",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes:
      "MIT licensed runtime (`ollama/ollama`). Individual model weights pulled later (Llama, Qwen, Gemma, Mistral, DeepSeek) carry their own model licenses and acceptable-use policies.",
    summary:
      "Lightweight GGUF model runner exposing `/v1/chat/completions`, `/v1/embeddings`, and `/v1/models` on port 11434.",
    dockerImage: "ollama/ollama:0.40.11",
    defaultHostPort: 11434,
    containerPort: 11434,
    healthcheckPath: "/api/version",
    namedVolumeTarget: "/root/.ollama",
    backupGuidance:
      "Model blobs in `/root/.ollama` can be re-pulled; back up custom `Modelfile` definitions separately.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 30,
      gpuRequired: false,
      recommendedVramGb: 16,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "12g",
    },
    supportedInferenceBackends: ["ollama"],
    securityNotes: [
      "Ollama has no built-in bearer-token auth: NEVER bind port 11434 to 0.0.0.0 or expose it without LiteLLM/Nginx auth.",
      "Limit OLLAMA_NUM_PARALLEL on small VRAM/CPU hosts to prevent OOM kills.",
    ],
    envVars: [
      {
        key: "OLLAMA_HOST",
        label: "Container Bind Address",
        description: "Binds inside the isolated container network namespace (mapped to 127.0.0.1 on host).",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "0.0.0.0:11434",
      },
      {
        key: "OLLAMA_NUM_PARALLEL",
        label: "Max Parallel Requests",
        description: "Caps concurrent KV-cache slots per loaded model.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "2",
      },
      {
        key: "OLLAMA_KEEP_ALIVE",
        label: "Model Keep-Alive",
        description: "Unloads idle models from VRAM/RAM after inactivity.",
        required: false,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "10m",
      },
    ],
  },
  {
    id: "localai",
    name: "LocalAI Multimodal Inference Server",
    category: "local-inference-gateway",
    architectureKind: "inference-server",
    deploymentMode: "single-container-verified",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/mudler/LocalAI",
    docsUrl: "https://localai.io",
    verifiedReleaseVersion: "v4.12.1",
    licenseIdentifier: "MIT",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes: "MIT license verified in `mudler/LocalAI` LICENSE.",
    summary:
      "Self-hosted OpenAI-compatible drop-in server supporting GGUF LLMs, embeddings, Whisper STT, TTS, and reranking with built-in `LOCALAI_API_KEY` support.",
    dockerImage: "localai/localai:v4.12.1-cpu",
    defaultHostPort: 18080,
    containerPort: 8080,
    healthcheckPath: "/readyz",
    namedVolumeTarget: "/models",
    backupGuidance: "Back up YAML model configs in `/models`; large GGUF weight files can be re-fetched from pinned SHA256 artifacts.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 35,
      gpuRequired: false,
      recommendedVramGb: 16,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "12g",
    },
    supportedInferenceBackends: ["localai"],
    securityNotes: [
      "Default host port set to 18080 on ALO hosts to avoid collisions with reverse-proxy or dev servers on 8080.",
      "Always set LOCALAI_API_KEY even on loopback so local containers must authenticate.",
    ],
    envVars: [
      {
        key: "MODELS_PATH",
        label: "Models Volume Path",
        description: "Path where GGUF weights and YAML model definitions reside.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "/models",
      },
      {
        key: "LOCALAI_VRAM_WARM_LIMIT",
        label: "Disable Remote Gallery Probe",
        description: "Prevents outbound GGUF gallery probing on container boot.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "0",
      },
      {
        key: "LOCALAI_API_KEY",
        label: "LocalAI Bearer API Key",
        description: "Requires Authorization: Bearer <key> on /v1/* endpoints.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
    ],
  },
  {
    id: "qdrant",
    name: "Qdrant Vector Memory Database",
    category: "memory-eval-observability",
    architectureKind: "vector-memory-db",
    deploymentMode: "single-container-verified",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/qdrant/qdrant",
    docsUrl: "https://qdrant.tech/documentation/",
    verifiedReleaseVersion: "v1.20.0",
    licenseIdentifier: "Apache-2.0",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes: "Clean Apache-2.0 license in `qdrant/qdrant` with native payload-based tenant partitioning.",
    summary:
      "High-performance Rust vector database for RAG, educational document retrieval, and persistent agent semantic memory.",
    dockerImage: "qdrant/qdrant:v1.20.0",
    defaultHostPort: 6333,
    containerPort: 6333,
    healthcheckPath: "/readyz",
    namedVolumeTarget: "/qdrant/storage",
    backupGuidance:
      "Trigger Qdrant collection/full snapshots (`POST /snapshots`) before copying `/qdrant/storage`.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 2,
      diskGb: 15,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai"],
    securityNotes: [
      "Always set QDRANT__SERVICE__API_KEY; unauthenticated Qdrant allows full vector read/delete.",
      "Partition multi-tenant collections with mandatory `tenant_id` payload filters or separate per-tenant instances.",
    ],
    envVars: [
      {
        key: "QDRANT__SERVICE__API_KEY",
        label: "Qdrant API Key",
        description: "Protects REST and gRPC vector endpoints.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
    ],
  },
  {
    id: "open-webui",
    name: "Open WebUI (Internal Team Workspace <=50 Users)",
    category: "ai-coworker-workspace",
    architectureKind: "full-application",
    deploymentMode: "single-container-verified",
    auditDecision: "INTERNAL ONLY",
    upstreamRepo: "https://github.com/open-webui/open-webui",
    docsUrl: "https://docs.openwebui.com",
    verifiedReleaseVersion: "v0.12.4",
    licenseIdentifier: "Open WebUI License (BSD-3-Clause + Clause 4 branding/scale restriction)",
    enterpriseDirectoryPresent: false,
    licenseTriage: "Internal use recommended",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "Upstream moved from MIT to the Open WebUI License: Clause 4 prohibits removing/altering Open WebUI branding in deployments exceeding 50 users/30 days or multi-tenant commercial white-labeling without an enterprise license. Use LibreChat (MIT) for white-label or >50-user deployments.",
    summary:
      "Self-hosted chat & RAG workspace connected to LiteLLM, Ollama, or OpenAI-compatible gateways. Restricted to unmodified-branding internal deployments under 50 users.",
    dockerImage: "ghcr.io/open-webui/open-webui:v0.12.4",
    defaultHostPort: 3005,
    containerPort: 8080,
    healthcheckPath: "/health",
    namedVolumeTarget: "/app/backend/data",
    backupGuidance: "Back up `/app/backend/data` (`webui.db` + vector uploads). Never run `open-webui/pipelines` (unmaintained since Aug 2025) on untrusted code.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 2,
      diskGb: 10,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "2g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter"],
    securityNotes: [
      "Keep WEBUI_AUTH=true and strong WEBUI_SECRET_KEY.",
      "Do not modify Open WebUI branding or expose as a white-labeled SaaS product.",
      "Note: host port defaults to 3005 so it never collides with Next.js portal on :3000.",
    ],
    envVars: [
      {
        key: "WEBUI_AUTH",
        label: "Require User Login",
        description: "Enforces user authentication on Open WebUI.",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "true",
      },
      {
        key: "WEBUI_SECRET_KEY",
        label: "Session Signing Secret",
        description: "Signs Open WebUI JWT sessions.",
        required: true,
        secret: true,
        autoGenerateSecret: true,
      },
      {
        key: "OPENAI_API_BASE_URL",
        label: "OpenAI-Compatible Gateway URL",
        description: "Points at host LiteLLM/gateway via host.docker.internal (must include /v1).",
        required: true,
        secret: false,
        autoGenerateSecret: false,
        defaultValue: "http://host.docker.internal:4000/v1",
      },
      {
        key: "OPENAI_API_KEY",
        label: "Gateway API Key",
        description: "Scoped virtual key (never pass the LiteLLM master key!).",
        required: false,
        secret: true,
        autoGenerateSecret: false,
        defaultValue: "",
      },
    ],
  },
  {
    id: "librechat",
    name: "LibreChat Multi-User AI Workspace",
    category: "ai-coworker-workspace",
    architectureKind: "full-application",
    deploymentMode: "multi-service-compose",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/danny-avila/LibreChat",
    docsUrl: "https://www.librechat.ai/docs",
    verifiedReleaseVersion: "v0.8.8",
    licenseIdentifier: "MIT",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes:
      "Clean MIT license with no user-count or branding restriction — preferred replacement for Open WebUI/LobeChat when offering branded or >50-user workspaces.",
    summary:
      "Multi-provider AI chat, Agents, Artifacts, and MCP workspace. Requires MongoDB + Meilisearch + optional pgvector RAG service via Docker Compose.",
    dockerImage: "ghcr.io/danny-avila/librechat:v0.8.8",
    defaultHostPort: 3080,
    containerPort: 3080,
    healthcheckPath: "/health",
    namedVolumeTarget: "/app/data",
    backupGuidance: "Requires coordinated `mongodump` of MongoDB + pgvector dump + `/app/uploads` backup.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 4,
      diskGb: 20,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq"],
    securityNotes: [
      "Deploy via isolated Docker Compose network with internal-only MongoDB and Meilisearch.",
      "Requires CREDS_KEY, CREDS_IV, JWT_SECRET, and JWT_REFRESH_SECRET.",
    ],
    envVars: [],
  },
  {
    id: "activepieces",
    name: "Activepieces Workflow Automation (MIT Community Edition)",
    category: "workflow-automation",
    architectureKind: "workflow-engine",
    deploymentMode: "multi-service-compose",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/activepieces/activepieces",
    docsUrl: "https://www.activepieces.com/docs",
    verifiedReleaseVersion: "0.92.2",
    licenseIdentifier: "MIT (core) + Commercial License (packages/ee)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Conditional, requires additional review",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "Core Activepieces engine and pieces are MIT, while `packages/ee` (custom branding, SSO, multi-project enterprise billing) requires an enterprise license. Safer OSS foundation than n8n's Sustainable Use License when staying on MIT edition.",
    summary:
      "No-code business & AI workflow automation engine (280+ connectors + MCP). Requires PostgreSQL (`pgvector:0.8.0-pg14`) + `redis:7.0.7`.",
    dockerImage: "ghcr.io/activepieces/activepieces:0.92.2",
    defaultHostPort: 8085,
    containerPort: 80,
    healthcheckPath: "/api/v1/flags",
    namedVolumeTarget: "/usr/src/app/cache",
    backupGuidance: "Back up PostgreSQL (`pg_dump`) and `AP_ENCRYPTION_KEY` together.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 4,
      diskGb: 20,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "openai", "openrouter", "groq"],
    securityNotes: [
      "Run code steps in sandboxed mode (`AP_EXECUTION_MODE=SANDBOXED`).",
      "Requires external PostgreSQL + Redis Compose topology.",
    ],
    envVars: [],
  },
  {
    id: "agenta",
    name: "Agenta LLMOps, Prompt Registry & Evaluation",
    category: "memory-eval-observability",
    architectureKind: "eval-observability",
    deploymentMode: "multi-service-compose",
    auditDecision: "OPTIONAL",
    upstreamRepo: "https://github.com/agenta-ai/agenta",
    docsUrl: "https://docs.agenta.ai",
    verifiedReleaseVersion: "v0.125.0",
    licenseIdentifier: "MIT (oss) + Commercial License (ee/)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Conditional, requires additional review",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes: "MIT core prompt playground, evaluation, and OpenTelemetry tracing; `ee/` directory requires commercial license.",
    summary:
      "Prompt management, LLM evaluation suites, human annotation, and OpenTelemetry agent observability stack.",
    dockerImage: "ghcr.io/agenta-ai/agenta-web:v0.125.0",
    defaultHostPort: 3090,
    containerPort: 3000,
    healthcheckPath: "/",
    namedVolumeTarget: "/data",
    backupGuidance: "Back up Agenta PostgreSQL + Redis + ClickHouse/tracing stores via Docker Compose backup scripts.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 30,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "8g",
    },
    supportedInferenceBackends: ["gateway", "openai", "openrouter", "ollama"],
    securityNotes: ["Deploy OSS compose profile on private admin/VPN network for engineering & QA teams."],
    envVars: [],
  },
  {
    id: "langfuse",
    name: "Langfuse Agent Tracing & Cost Observability",
    category: "memory-eval-observability",
    architectureKind: "eval-observability",
    deploymentMode: "multi-service-compose",
    auditDecision: "OPTIONAL",
    upstreamRepo: "https://github.com/langfuse/langfuse",
    docsUrl: "https://langfuse.com/self-hosting",
    verifiedReleaseVersion: "v4.70.1",
    licenseIdentifier: "MIT Expat (core) + Commercial License (ee/)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Conditional, requires additional review",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes: "MIT core tracing/evals; `ee/` directory proprietary. Note v3/v4 self-hosting requires Postgres + ClickHouse + Redis + S3/MinIO.",
    summary:
      "Production LLM & agent trace observability, prompt versioning, and token/cost analytics.",
    dockerImage: "langfuse/langfuse:3.115.0",
    defaultHostPort: 3095,
    containerPort: 3000,
    healthcheckPath: "/api/public/health",
    namedVolumeTarget: "/app",
    backupGuidance: "Requires coordinated PostgreSQL + ClickHouse + MinIO bucket snapshots; heavy RAM footprint (>=8-12 GB).",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 12,
      diskGb: 50,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "8g",
    },
    supportedInferenceBackends: ["gateway", "openai", "openrouter", "ollama", "localai"],
    securityNotes: ["Do not co-locate ClickHouse-backed Langfuse v3/v4 on small <8 GB hosting nodes."],
    envVars: [],
  },
  {
    id: "odysseus",
    name: "Odysseus Self-Hosted AI Workspace",
    category: "ai-coworker-workspace",
    architectureKind: "full-application",
    deploymentMode: "multi-service-compose",
    auditDecision: "INTERNAL ONLY",
    upstreamRepo: "https://github.com/odysseus-dev/odysseus",
    docsUrl: "https://github.com/odysseus-dev/odysseus#quick-start",
    verifiedReleaseVersion: "v0.4.0",
    licenseIdentifier: "AGPL-3.0",
    enterpriseDirectoryPresent: false,
    licenseTriage: "Internal use recommended",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "Licensed under GNU AGPL-3.0: network access triggers copyleft source-disclosure obligations if modified. Safe as an unmodified isolated internal workspace; do not embed AGPL source into proprietary portal code.",
    summary:
      "Self-hosted AI workspace for chat, agents, deep research, documents, notes, email, calendar, and local Ollama/OpenAI-compatible workflows on port 7011.",
    dockerImage: "ghcr.io/odysseus-dev/odysseus:0.4.0",
    defaultHostPort: 7011,
    containerPort: 7011,
    healthcheckPath: "/",
    namedVolumeTarget: "/app/data",
    backupGuidance: "Back up Odysseus Docker Compose volumes and .env secrets before upgrades; inspect first-boot admin credentials from container logs only over root SSH.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 25,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "8g",
    },
    supportedInferenceBackends: ["ollama", "localai", "gateway", "openai", "openrouter"],
    securityNotes: [
      "Bind port 7011 strictly to 127.0.0.1 and expose only behind authenticated HTTPS reverse proxy.",
      "Rotate initial bootstrap admin password immediately after first login.",
    ],
    envVars: [],
  },
  {
    id: "langgraph",
    name: "LangGraph Stateful Agent SDK",
    category: "agent-builder-framework",
    architectureKind: "sdk-framework",
    deploymentMode: "sdk-runtime",
    auditDecision: "OPTIONAL",
    upstreamRepo: "https://github.com/langchain-ai/langgraph",
    docsUrl: "https://langchain-ai.github.io/langgraph/",
    verifiedReleaseVersion: "1.2.17",
    licenseIdentifier: "MIT (SDK) / Commercial (LangGraph Platform Server)",
    enterpriseDirectoryPresent: false,
    licenseTriage: "Conditional, requires additional review",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "The `langgraph` Python/JS SDK is clean MIT and safe to embed in custom FastAPI/Next.js apps, whereas the managed LangGraph Platform/Server container has separate commercial terms.",
    summary:
      "Code-first cyclic graph state machine SDK (Python & TypeScript) with durable checkpointing (`langgraph-checkpoint-postgres`), human-in-the-loop interrupts, and streaming.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "Persist checkpoints in PostgreSQL (`langgraph-checkpoint-postgres`) rather than ephemeral memory.",
    hardwareMinimum: {
      cpuCores: 1,
      ramGb: 1,
      diskGb: 5,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "1.0",
      memory: "1g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq"],
    securityNotes: ["Embed as a library inside tenant-isolated FastAPI/Node services; do not confuse with a ready-made multi-user web app."],
    envVars: [],
  },
  {
    id: "crewai",
    name: "CrewAI Multi-Agent Python SDK",
    category: "agent-builder-framework",
    architectureKind: "sdk-framework",
    deploymentMode: "sdk-runtime",
    auditDecision: "OPTIONAL",
    upstreamRepo: "https://github.com/crewAIInc/crewAI",
    docsUrl: "https://docs.crewai.com",
    verifiedReleaseVersion: "1.15.30",
    licenseIdentifier: "MIT (OSS SDK; CrewAI AMP Cloud proprietary)",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes: "MIT Python library (`crewAIInc/crewAI`); has no official multi-tenant OSS web control plane.",
    summary:
      "Role-playing multi-agent orchestration & Flows SDK in Python. Deploy inside custom FastAPI worker containers rather than as a standalone GUI preset.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "Source-controlled Python code + external database state.",
    hardwareMinimum: {
      cpuCores: 1,
      ramGb: 1,
      diskGb: 5,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "1.0",
      memory: "1g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq"],
    securityNotes: ["Disable arbitrary code execution tools (`allow_code_execution=False`) unless isolated in an ephemeral microVM/sandbox."],
    envVars: [],
  },
  {
    id: "agno",
    name: "Agno (AgentOS) Python Runtime & SDK",
    category: "agent-builder-framework",
    architectureKind: "sdk-framework",
    deploymentMode: "sdk-runtime",
    auditDecision: "ADD",
    upstreamRepo: "https://github.com/agno-agi/agno",
    docsUrl: "https://docs.agno.com",
    verifiedReleaseVersion: "v3.1.10",
    licenseIdentifier: "Apache-2.0",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes: "Clean Apache-2.0 license with lightweight FastAPI AgentOS runtime.",
    summary:
      "Fast, low-memory Python multi-agent SDK + FastAPI AgentOS runtime with native PostgreSQL/pgvector session & memory storage.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "Back up PostgreSQL session/memory tables.",
    hardwareMinimum: {
      cpuCores: 1,
      ramGb: 1,
      diskGb: 5,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "1.0",
      memory: "1g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter", "groq"],
    securityNotes: ["Enforce per-user session scoping on FastAPI AgentOS routes before exposing externally."],
    envVars: [],
  },
  {
    id: "letta",
    name: "Letta (MemGPT) Stateful Memory Runtime",
    category: "memory-eval-observability",
    architectureKind: "sdk-framework",
    deploymentMode: "sdk-runtime",
    auditDecision: "DEFER",
    upstreamRepo: "https://github.com/letta-ai/letta",
    docsUrl: "https://docs.letta.com",
    verifiedReleaseVersion: "0.16.8 (letta) / v0.34.24 (letta-code)",
    licenseIdentifier: "Apache-2.0",
    enterpriseDirectoryPresent: false,
    licenseTriage: "License verified for intended use",
    commercialMultiTenantAllowed: "yes",
    licenseNotes:
      "Apache-2.0 verified, but upstream archived the legacy V1 `letta` server in favor of `letta-code` and the Letta API/SDK transition. Deferred from one-click server presets until V2 server packaging stabilizes.",
    summary:
      "Long-horizon self-editing memory agents (MemGPT architecture). Use `mem0` + `Qdrant`/`pgvector` for stable self-hosted memory today.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "PostgreSQL + pgvector volume snapshot.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 4,
      diskGb: 15,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "openai", "ollama"],
    securityNotes: ["Requires reliable tool-calling models (>=14B/70B or GPT-4o-mini); small 3B/7B models frequently fail Letta inner-monologue JSON schemas."],
    envVars: [],
  },
  {
    id: "openhands",
    name: "OpenHands Autonomous SWE Agent",
    category: "coding-swe-agent",
    architectureKind: "full-application",
    deploymentMode: "restricted-commercial-review",
    auditDecision: "INTERNAL ONLY",
    upstreamRepo: "https://github.com/All-Hands-AI/OpenHands",
    docsUrl: "https://docs.all-hands.dev",
    verifiedReleaseVersion: "v1.33.0",
    licenseIdentifier: "MIT",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Internal use recommended",
    commercialMultiTenantAllowed: "conditional",
    licenseNotes:
      "Core OpenHands is MIT (with `enterprise/` subdir for SaaS additions), BUT its standard Docker runtime mounts `/var/run/docker.sock` to spawn sibling sandbox containers — an immediate root-equivalent container escape risk on shared multi-tenant hosting nodes.",
    summary:
      "Autonomous software engineering agent with shell, browser, and code execution. Blocked on shared Hosting Portal nodes; deploy ONLY on dedicated single-tenant developer VMs.",
    dockerImage: "docker.all-hands.dev/all-hands-ai/openhands:1.33",
    defaultHostPort: 3099,
    containerPort: 3000,
    healthcheckPath: "/",
    namedVolumeTarget: "/.openhands-state",
    backupGuidance: "Dedicated VM snapshot + Git push of workspaces.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 40,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "8g",
    },
    supportedInferenceBackends: ["gateway", "openai", "openrouter"],
    securityNotes: [
      "BLOCKED in Zero-Terminal Deploy Assistant because mounting `/var/run/docker.sock` violates ALO container isolation.",
      "Run only inside a dedicated VM or Sysbox/Kata isolated runtime for internal ALO engineering.",
    ],
    envVars: [],
  },
  {
    id: "dify",
    name: "Dify LLMOps Platform",
    category: "agent-builder-framework",
    architectureKind: "full-application",
    deploymentMode: "restricted-commercial-review",
    auditDecision: "REJECT",
    upstreamRepo: "https://github.com/langgenius/dify",
    docsUrl: "https://docs.dify.ai",
    verifiedReleaseVersion: "1.18.0",
    licenseIdentifier: "Dify Open Source License (Apache-2.0 + Multi-Tenant & Logo Restrictions)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Commercial permission required or potentially required",
    commercialMultiTenantAllowed: "no",
    licenseNotes:
      "Dify LICENSE Condition 1a explicitly prohibits operating the software as a multi-tenant service (`you may not use the Dify source code to operate a multi-tenant environment`) without written authorization from LangGenius/Dify, and Condition 1b restricts removing frontend copyright/logo.",
    summary:
      "Full-stack LLMOps & agent builder (9+ Compose containers). Rejected for ALO multi-tenant customer hosting without a signed Dify commercial agreement; use Langflow (MIT) instead.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "N/A — blocked pending commercial license.",
    hardwareMinimum: {
      cpuCores: 4,
      ramGb: 8,
      diskGb: 40,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "4.0",
      memory: "8g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "localai", "openai", "openrouter"],
    securityNotes: [
      "Blocked from Hosting Portal deployment due to Dify Open Source License multi-tenant restriction.",
    ],
    envVars: [],
  },
  {
    id: "n8n",
    name: "n8n Workflow Automation",
    category: "workflow-automation",
    architectureKind: "workflow-engine",
    deploymentMode: "restricted-commercial-review",
    auditDecision: "INTERNAL ONLY",
    upstreamRepo: "https://github.com/n8n-io/n8n",
    docsUrl: "https://docs.n8n.io",
    verifiedReleaseVersion: "2.44.7",
    licenseIdentifier: "Sustainable Use License + n8n Enterprise License (.ee)",
    enterpriseDirectoryPresent: true,
    licenseTriage: "Commercial permission required or potentially required",
    commercialMultiTenantAllowed: "no",
    licenseNotes:
      "Sustainable Use License permits internal business use only and prohibits offering n8n as a hosted/managed commercial service or charging customers access to n8n workflows without an n8n Embed/Enterprise agreement.",
    summary:
      "Fair-code visual workflow & AI agent automation tool. Permitted for ALO Labs' own internal back-office operations ONLY; never resell as managed hosting without n8n commercial licensing.",
    dockerImage: null,
    defaultHostPort: null,
    containerPort: null,
    healthcheckPath: null,
    namedVolumeTarget: null,
    backupGuidance: "Internal ops PostgreSQL + `N8N_ENCRYPTION_KEY`.",
    hardwareMinimum: {
      cpuCores: 2,
      ramGb: 4,
      diskGb: 15,
      gpuRequired: false,
      recommendedVramGb: 0,
    },
    containerLimits: {
      cpus: "2.0",
      memory: "4g",
    },
    supportedInferenceBackends: ["gateway", "ollama", "openai", "openrouter", "groq"],
    securityNotes: [
      "Blocked for customer resale in Hosting Portal; use Activepieces MIT edition or built-in Hosting Portal AI Automations for customers.",
    ],
    envVars: [],
  },
];

export const SELF_HOSTED_AGENT_CATALOG: readonly SelfHostedAgentPreset[] = z
  .array(SelfHostedAgentPresetSchema)
  .parse(RAW_PRESETS);

export function getAgentPresetById(id: string): SelfHostedAgentPreset | undefined {
  return SELF_HOSTED_AGENT_CATALOG.find((preset) => preset.id === id);
}

export function listDeployableAgentPresets(): SelfHostedAgentPreset[] {
  return SELF_HOSTED_AGENT_CATALOG.filter((preset) => preset.deploymentMode === "single-container-verified");
}

// ─── 13-Use-Case Platform Decision Matrix ────────────────────────────────────

export interface DecisionMatrixEntry {
  useCaseId: string;
  useCase: string;
  primaryRecommendation: string;
  primaryArchitectureKind: string;
  secondaryAlternative: string;
  avoidOrCaution: string;
  rationale: string;
  licenseStatus: LicenseTriageLabel;
}

export const AGENT_PLATFORM_DECISION_MATRIX: readonly DecisionMatrixEntry[] = [
  {
    useCaseId: "visual-low-code-builder",
    useCase: "1. Non-technical visual / low-code agent builder",
    primaryRecommendation: "Langflow (v1.13.0, MIT)",
    primaryArchitectureKind: "Full visual server + REST API",
    secondaryAlternative: "Sim Studio (Apache-2.0) or Flowise single-tenant OSS (Apache-2.0 core)",
    avoidOrCaution: "Dify (forbids multi-tenant SaaS); Rivet (desktop IDE, not a hosted server)",
    rationale: "Langflow offers clean MIT licensing, visual flow + MCP support, and single-container or Postgres deployment.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "code-first-python-ts",
    useCase: "2. Code-first Python / TypeScript agent engineering",
    primaryRecommendation: "Pydantic AI (MIT) or Agno (Apache-2.0) [Python]; Built-in Hosting Portal Engine [TS]",
    primaryArchitectureKind: "SDK / library embedded in FastAPI or Next.js",
    secondaryAlternative: "LangGraph SDK (MIT) or LlamaIndex Workflows (MIT)",
    avoidOrCaution: "SuperAGI (unmaintained since Jan 2025); Drevon (prompt-file CLI, not an agent runtime)",
    rationale: "Strict type-safe tool schemas, tiny memory overhead, clean OSI licenses, and direct OpenAI-compatible gateway support.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "multi-agent-orchestration",
    useCase: "3. Multi-agent role & graph orchestration",
    primaryRecommendation: "LangGraph SDK (MIT) or Agno Teams (Apache-2.0)",
    primaryArchitectureKind: "Code-first stateful orchestration SDK",
    secondaryAlternative: "CrewAI SDK (MIT) or AG2 / Microsoft Agent Framework",
    avoidOrCaution: "LangGraph Commercial Platform Server without license; unguarded cyclic loops without maxSteps",
    rationale: "LangGraph provides deterministic state checkpoints and bounded cycles; Agno provides minimal-overhead Python agent teams.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "persistent-memory-agents",
    useCase: "4. Persistent memory & long-running personalized agents",
    primaryRecommendation: "Qdrant (Apache-2.0) or pgvector (PostgreSQL) + Mem0 OSS SDK (Apache-2.0)",
    primaryArchitectureKind: "Vector memory store + SDK",
    secondaryAlternative: "Letta / Letta-Code (Apache-2.0, defer server preset until V2 stabilizes)",
    avoidOrCaution: "Running Letta inner-monologue schemas against <8B quantized models (frequent JSON tool failures)",
    rationale: "Decoupling vector/episodic storage in Qdrant/pgvector gives clean tenant isolation, snapshots, and model-agnostic reliability.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "workflow-business-automation",
    useCase: "5. Workflow & business automation (webhooks, schedules, SaaS connectors)",
    primaryRecommendation: "Activepieces MIT Community Edition (Postgres + Redis) or Temporal (MIT, code-first)",
    primaryArchitectureKind: "Workflow automation engine",
    secondaryAlternative: "Trigger.dev v4 (Apache-2.0) for durable TypeScript background jobs",
    avoidOrCaution: "n8n (Sustainable Use License forbids commercial hosted resale); Windmill (AGPL-3.0 + EE)",
    rationale: "Activepieces MIT core provides Zapier/n8n-class visual connectors without fair-code resale traps when EE modules are excluded.",
    licenseStatus: "Conditional, requires additional review",
  },
  {
    useCaseId: "coding-devops-agents",
    useCase: "6. Coding & DevOps software engineering agents",
    primaryRecommendation: "OpenHands (MIT) or Goose (Apache-2.0) / Cline (Apache-2.0) on dedicated isolated VMs",
    primaryArchitectureKind: "Autonomous SWE agent + isolated VM/IDE",
    secondaryAlternative: "Aider (Apache-2.0 CLI)",
    avoidOrCaution: "NEVER run OpenHands with `/var/run/docker.sock` on shared customer hosting servers",
    rationale: "Coding agents execute arbitrary shell code and require VM/Kata hardware virtualization boundaries, not shared Docker hosts.",
    licenseStatus: "Internal use recommended",
  },
  {
    useCaseId: "browser-automation-agents",
    useCase: "7. Headless browser automation & web interaction agents",
    primaryRecommendation: "Browser Use (MIT) inside isolated Playwright worker container with egress firewall",
    primaryArchitectureKind: "Python SDK + sandboxed headless Chromium",
    secondaryAlternative: "Stagehand / Playwright MCP",
    avoidOrCaution: "Skyvern (AGPL-3.0 network copyleft triggers source disclosure on hosted SaaS); unrestricted RFC1918 egress",
    rationale: "Browser Use is MIT-licensed whereas Skyvern is AGPL-3.0; must block 127.0.0.0/8, RFC1918, and 169.254.169.254 in browser egress.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "customer-support-crm-education",
    useCase: "8. Customer support, CRM, and ALO Education advisor assistants",
    primaryRecommendation: "Hosting Portal Native AI Agents + Qdrant/pgvector RAG + LiteLLM/Gateway",
    primaryArchitectureKind: "Integrated multi-tenant portal module + vector store",
    secondaryAlternative: "LibreChat (MIT) for multi-counselor internal/student workspace",
    avoidOrCaution: "Sending unredacted student PII/passport/financial records to anonymous free-tier APIs (LLM7/Groq free)",
    rationale: "Uses existing portal RBAC, Prisma audit logging, and tenant isolation while routing sensitive educational/CRM data only to self-hosted or DPA-covered providers.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "internal-team-copilots",
    useCase: "9. Internal ALO Labs team copilots (ops, support, engineering)",
    primaryRecommendation: "LibreChat (MIT, unlimited users) or Open WebUI (<=50 users, unmodified branding)",
    primaryArchitectureKind: "Self-hosted multi-model chat & RAG workspace",
    secondaryAlternative: "n8n (internal back-office automation only)",
    avoidOrCaution: "Exposing `/ai/` publicly without SSO/MFA or embedding LiteLLM master key in container envs",
    rationale: "Internal operations satisfy Open WebUI (<50 users, original branding) and n8n internal-use clauses, while LibreChat removes user caps entirely.",
    licenseStatus: "Internal use recommended",
  },
  {
    useCaseId: "multi-tenant-hosted-resale",
    useCase: "10. Multi-tenant SaaS / white-label hosted AI offerings for ALO customers",
    primaryRecommendation: "Langflow (MIT) + LibreChat (MIT) + Qdrant (Apache-2.0) + Ollama/LocalAI/vLLM (MIT/Apache-2.0)",
    primaryArchitectureKind: "Per-tenant isolated containers + central authenticated inference gateway",
    secondaryAlternative: "Agno (Apache-2.0) custom FastAPI apps",
    avoidOrCaution: "Dify (prohibits multi-tenant), n8n (prohibits hosted resale), LobeChat (Community License restrictions), Skyvern (AGPL-3.0)",
    rationale: "Every layer in the recommended stack is pure MIT or Apache-2.0 with zero multi-tenant or white-label clauses.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "air-gapped-strict-residency",
    useCase: "11. Air-gapped / strict data-residency local inference",
    primaryRecommendation: "vLLM (Apache-2.0, GPU production) or Ollama / LocalAI / llama.cpp (MIT, single-node)",
    primaryArchitectureKind: "Local OpenAI-compatible inference engine (`AI_FREE_ONLY=false`, cloud keys unset, pinned local `AI_PROVIDER_ORDER`)",
    secondaryAlternative: "LiteLLM OSS proxy fronting local vLLM/Ollama",
    avoidOrCaution: "Leaving `llm7` in `AI_PROVIDER_ORDER` or `AI_ALLOW_ANONYMOUS=true` when promising strict on-server data residency!",
    rationale: "Strict residency is true ONLY when `AI_PROVIDER_ORDER=gateway,ollama,localai` and external fallback providers are disabled.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "low-resource-vps",
    useCase: "12. Low-resource VPS deployments (2-4 vCPU, 4-8 GB RAM, no GPU)",
    primaryRecommendation: "Hosting Portal Native AI + External OpenAI-Compatible API (Groq / OpenRouter / OpenAI) + lightweight Langflow/Flowise",
    primaryArchitectureKind: "Thin orchestration on VPS + remote GPU inference",
    secondaryAlternative: "CPU-only Qwen2.5-3B Q4_K_M via Ollama/llama.cpp strictly for low-QPS (<1 concurrent) non-realtime tasks",
    avoidOrCaution: "Deploying Dify (9 containers), Langfuse v4 (ClickHouse), or >=14B local LLMs on a 4-8 GB CPU VPS",
    rationale: "Separating lightweight agent orchestration (1-2 GB RAM) from GPU inference prevents swap thrashing and host outages.",
    licenseStatus: "License verified for intended use",
  },
  {
    useCaseId: "gpu-backed-production-serving",
    useCase: "13. Dedicated GPU server production model serving",
    primaryRecommendation: "vLLM (Apache-2.0) behind LiteLLM OSS Gateway (`127.0.0.1:4000`) with Qdrant (`127.0.0.1:6333`)",
    primaryArchitectureKind: "PagedAttention continuous-batching GPU server + auth/quota proxy",
    secondaryAlternative: "Ollama / LocalAI on single-GPU 16-24 GB nodes with <=4 concurrent users",
    avoidOrCaution: "Exposing vLLM/Ollama directly without bearer authentication, per-tenant rate limits, or `max_model_len` bounds",
    rationale: "vLLM delivers continuous batching and FP8/AWQ throughput for multi-user concurrency while LiteLLM enforces per-tenant virtual keys.",
    licenseStatus: "License verified for intended use",
  },
];


// ─── Extended 26-Platform Audit Registry, Use-Case Matrix & Sizing Profiles ───

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
