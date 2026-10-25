# AI provider / gateway integration

Status of this document: covers the AI layer as implemented in `src/lib/ai/` and
the automation engine in `src/lib/ai/automation/`. Everything described as
"implemented" is covered by unit tests with a stubbed `fetch`. **No live provider
call was possible from the build environment** (outbound traffic is limited to
GitHub/npm/PyPI), so latency, quotas, model quality and real free-tier limits are
**NOT VERIFIED** here — probe them from the deployment host with
`GET /api/ai/status?probe=1`.

---

## 1. What is actually implemented

| Layer | File | What it does |
|---|---|---|
| Provider registry | `src/lib/ai/providers.ts` | Catalogue of OpenAI-compatible backends, env-driven chain resolution, base-URL validation, secret redaction |
| Client | `src/lib/ai/client.ts` | Chat completions with ordered failover, bounded retries, circuit breaker, timeouts, JSON mode, live model list, real health probes |
| Usage accounting | `src/lib/ai/usage.ts` | Persists real `usage` from the upstream against the acting user (`token_usage`) |
| Automation engine | `src/lib/ai/automation/engine.ts` | DAG execution with per-step results, budgets, timeouts, dry-run |
| Graph model / validation | `src/lib/ai/automation/graph.ts` | Strict DAG validation, node-type allowlist, size caps |
| Hosting tools | `src/lib/ai/automation/tools.ts` | Read-only panel tools: `listSites`, `siteHealth`, `sslExpiring` |
| Runner | `src/lib/ai/automation/runner.ts` | Wires the engine to the real provider chain + tools, persists `ai_workflow_runs` |
| Templates | `src/lib/ai/automation/templates.ts` | Four starter automations built from real panel data |
| Compliance shim | `src/lib/ai-provider.ts`, `src/lib/ai-sdk.ts` | Old import paths still work, now backed by the chain |

### Removed: fake AI answers

`POST /api/agents/:slug/run` used to generate canned "demo" text (fake code
samples, fake security findings, fake analytics) whenever no API key was set, and
labelled it as model output. That fallback generator is **gone**. The route now
requires an authenticated session and calls the real provider chain; with no
usable provider it returns `503 AI_NOT_CONFIGURED` and never invents an answer.

---

## 2. Configure a provider

Set these on the **application server**, restart, then probe. Nothing is sent to
the browser except redacted provider metadata.

```dotenv
# Free tier, no key needed (anonymous access to a subset of models):
AI_ALLOW_ANONYMOUS=true
LLM7_API_KEY=                 # optional free token from https://token.llm7.io — raises limits
AI_MODEL_LLM7=gpt-oss:20b     # verify against GET /api/ai/models

# Paid gateway (UnoRouter, or any OpenAI-compatible reseller):
UNOROUTER_API_KEY=
UNOROUTER_BASE_URL=https://api.unorouter.com/v1   # MUST be confirmed in your own dashboard
AI_MODEL_UNOROUTER=<model id enabled for your token>

# Optional extra providers
GROQ_API_KEY=
PROVIDER_OPENAI_API_KEY=      # deliberately separate from OPENAI_API_KEY
AI_GATEWAY_URL=http://127.0.0.1:4000/v1   # self-hosted LiteLLM/vLLM
AI_GATEWAY_KEY=

# Chain behaviour
AI_PROVIDER_ORDER=unorouter,llm7,groq
AI_FREE_ONLY=false
AI_PROVIDER=                  # pin one provider id
AI_TIMEOUT_MS=60000
AI_RETRIES_PER_PROVIDER=1
AI_BREAKER_THRESHOLD=3
AI_BREAKER_COOLDOWN_MS=60000
AI_MODEL=                     # legacy global override, applies to every provider
```

Resolution rules (all covered in `tests/ai-providers.test.ts`):

1. A legacy `OPENAI_API_KEY` + `OPENAI_BASE_URL` pair becomes `custom` and is
   tried **first**, so existing deployments keep their gateway.
2. Remaining providers follow `AI_PROVIDER_ORDER` (default
   `unorouter,llm7,groq,gateway,ollama`).
3. Providers that need a key are skipped when the key is empty, with the reason
   reported by `GET /api/ai/providers`.
4. Self-hosted endpoints (`gateway`, `ollama`) are opt-in: they join the chain
   only when their base-URL env var is set or they are listed explicitly, so a
   fresh install does not waste time dialling `127.0.0.1`.
5. A malformed URL skips that provider; it never crashes the panel.
6. `AI_ALLOW_ANONYMOUS=false` disables every keyless provider — then an empty
   config really is "not configured" (503), which is what the legacy security
   test asserts.

### Failover, retries, breaker

`completeWithAI()` walks the chain. `429/5xx/timeout` are retried once per
provider with exponential backoff, then the next provider is tried; `401/403/404`
move straight to the next provider. After `AI_BREAKER_THRESHOLD` consecutive
failures a provider is skipped for `AI_BREAKER_COOLDOWN_MS`. Upstream response
bodies are **never** echoed into errors (they can contain prompt text or key
hints); callers get a sanitized status plus a per-attempt list of provider ids and
latencies. Caller cancellation (`AbortSignal`) stops immediately and never fails over.

---

## 3. Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/ai/status` | Config summary; `?probe=1` performs one real round-trip per provider and reports `HEALTHY` only if one answers |
| `GET /api/ai/providers` | Resolved chain (redacted), skipped providers + reasons, warnings, runtime limits, catalogue |
| `GET /api/ai/models?all=1` | Live model IDs from `GET {baseUrl}/models`, cached 5 min |
| `POST /api/ai/chat` | Chat completion (`{message}` or `{messages}`), records token usage |
| `GET/POST /api/ai/workflows` | List / create automations (`{templateId}` or `{name,nodes,edges}`); `?templates=1` lists templates |
| `GET/PATCH/DELETE /api/ai/workflows/:id` | Read (with last 10 runs), update, delete |
| `POST /api/ai/workflows/:id/run` | Execute (`{input,dryRun,continueOnError}`), persists a run |
| `GET /api/ai/workflows/:id/runs` | Run history (`?limit=&status=`) |
| `POST /api/agents/:slug/run` | Real agent execution (auth required, no demo fallback) |

All of them require a session; workflow routes enforce owner-or-admin.

See [docs/AI-AUTOMATION.md](docs/AI-AUTOMATION.md) for the engine, node types,
safety model and an example `curl` run.

---

## 4. Where each link you supplied actually fits

Short version: **one** of the AI links is a usable free backend (LLM7.io), one is
a paid gateway you can add a profile for (UnoRouter), one is model weights you
must host yourself (GLM-5), and the rest are SaaS products, demos, prompt
collections, or reverse-proxy scrapers. Vendoring them into the hosting panel
would add supply-chain risk without adding a working feature, so they are
documented here instead of merged.

### 4.1 Integrated as provider profiles

| Source | Verdict | How it is used |
|---|---|---|
| `https://llm7.io` / `https://api.llm7.io/v1` | **Free-tier OpenAI-compatible gateway.** Own docs: anonymous access works for a subset of models; a free token from `token.llm7.io` raises limits (order of 60 req/min, 250 req/hour, daily token quota, 100k tokens/day on the free token). | Registered as provider `llm7`, default first choice for a keyless install. Model IDs rotate → read `/api/ai/models`. Quotas are the operator's to respect; the panel does not promise "unlimited free AI". |
| `https://github.com/unorouter/unorouter` | **Not a free model and not an API server.** The repo is an AGPL-3.0 Next.js+Elysia storefront/dashboard for the UnoRouter gateway (a `new-api` fork reselling 130+ upstream providers): API keys, credits, billing, price comparison, chat client, model tester. | Registered as provider `unorouter` (paid, key required). The storefront code is **not** vendored — running a second frontend next to this panel adds nothing. Point `UNOROUTER_BASE_URL` at the gateway host from your UnoRouter dashboard and set a token; the default host in the catalogue is marked *unverified*. `tests/ai-providers.test.ts` asserts it stays flagged until you override it. |
| `https://github.com/zai-org/GLM-5` | Model release (weights + inference recipe), not an endpoint. | Not installed. If you want GLM for free, host it on GPU with vLLM/Ollama and register the local endpoint (`AI_GATEWAY_URL`/`OLLAMA_BASE_URL`) — that turns it into a `self-hosted` provider in the chain. Requires GPU VRAM, disk, ops and licence review; the panel process itself must never load model weights. |

### 4.2 Free-model projects that are not safe or stable as a backend

| Source | Why it is not wired in |
|---|---|
| `GetGoAPI/Free-GPT-Grok-Gemini-Claude-API` | Reverse-proxies consumer web endpoints; violates upstream terms, breaks without notice, and puts your prompts/credentials through an untrusted middleman. Not a contracted API. |
| `ramon-victor/freegpt-webui` | Self-hosted UI that scrapes/scrapes-like providers or needs your own keys; it is a frontend, not an inference service. Same ToS problem. |
| `teremterem/claude-code-gpt-5-codex` | Local CLI proxy that redirects one vendor's CLI at another vendor's endpoint — a personal hack, not a production dependency. |
| `FoundationAgents/MetaGPT` | Python multi-agent framework. Useful as a *design* reference for role/planning loops; running it means a separate Python service, its own model spend, and a job queue we do not have. Wire it later as a worker behind an authenticated job API if you need it. |
| `Lin-jun-xiang/docGPT-langchain` | Demo RAG app (Python/LangChain). If you want "chat with my docs", that is a feature to build in this repo (embeddings + a vector store + retrieval), not a repo to paste in. |
| `songguoxs/gpt4o-image-prompts` | A prompt collection, not code. Reusable as prompt text only; image generation needs a paid image model. |
| `GAIR-NLP/LiveTalk` | Audio-driven talking-head research model: Python + CUDA + large checkpoints + real-time GPU. Cannot run inside a Next.js control panel. |
| `tinystruct/smalltalk` | Small chat/LLM demo app. Nothing to integrate beyond concepts we already have. |

### 4.3 Sites you listed that are unrelated to hosting/AI backend

`hetrixtools.com` (external uptime monitoring SaaS — the panel already has its own
monitoring/alerting; integrating means an API key and a webhook, not a model),
`mat3ra.com` (materials-science simulation), `refine.ink`, `www.enerpize.com`,
`www.aipraktor.com`, `supercool.com` / `join.supercool.com`, `buffer.com` (social
scheduling), `coder.qwen.ai`, `www.mureka.ai` (music generation), `astryx.atmeta.com`,
and `stackoverflow.com` (a reference site) are third-party products. None is
open-source infrastructure to add to this repository, and none provides a free
model endpoint for the backend. If you want one of them as a product integration
(e.g. Buffer for social posting), that is an OAuth + API-key feature to scope on
its own.

---

## 5. Cost, licensing and honesty rules

- UnoRouter's repository is a **storefront**; it does not make inference free.
  Upstream models need credits under that account's terms.
- LLM7's free tier is free *as of its own documentation*, quota-limited, and can
  change. Do not advertise "free unlimited AI" to customers on the strength of it.
- Self-hosting (vLLM/Ollama/GLM) removes per-token fees but adds GPU, electricity,
  storage and ops cost, plus model-licence obligations.
- The panel records token counts it was told by the upstream, and sets `costUsd`
  to 0 because it cannot verify prices. Reconcile spend against provider invoices.
- Never commit keys. Keys are read server-side only and are redacted from every
  response (`redactProvider`).

---

## 6. Verification status

| Check | State |
|---|---|
| Unit tests: chain resolution, secret redaction, failover, retries, breaker, no-body-leak, JSON mode, cancellation, graph validation, template safety, engine branching/budget/dry-run, all templates parse | **PASS** (`tests/ai-providers.test.ts`, `tests/ai-client.test.ts`, `tests/ai-automation.test.ts`) |
| `tsc --noEmit`, `eslint src/` | **PASS** |
| Live call to LLM7 / UnoRouter / Groq from this build environment | **NOT RUN** — egress is restricted here. Run `GET /api/ai/status?probe=1` on the deployment host. |
| Free-tier rate limits, model availability, response quality | **NOT VERIFIED** |
| Scheduled (cron) automations | **NOT IMPLEMENTED** — design sketch in `docs/AI-AUTOMATION.md` §7 |
| Mutating automation tools (restart/backup/delete) | **NOT IMPLEMENTED**, intentionally |
