# Ecosystem & Repository Integration Analysis (`aloeducation-org-crm/Hosting-Portal`)

> **Date:** 2026-10-26  
> **Scope:** Technical audit and product-fit assessment of all 52 repositories and platforms supplied for **ALO Labs Hosting Portal** (`hosting.alolabs.net`), **ALO Education CRM** (`aloeducation-org-crm`), and **ALO Server Kit** (`alo-server-kit/`).

---

## Executive Summary

1. **Mandatory Addition Completed — `zai-org/GLM-5` (`glm` provider):**
   - Registered **`glm`** in `src/lib/ai/providers.ts` (`GLM_API_KEY` or `ZHIPU_API_KEY`, `GLM_BASE_URL`, `AI_MODEL_GLM`, `GLM_REASONING_EFFORT`), wired `reasoning_effort` (`low` | `high` | `max`) in `src/lib/ai/client.ts`, added **`GLM-5 Agentic Engineer`** (`glm5-engineer`) in `src/app/api/agents/seed/route.ts` and `src/lib/seed-agents.ts`, added `glm-5` / `glm-5.3-flash` routes to `alo-server-kit/configs/litellm/config.yaml.tpl`, and verified with unit tests (`tests/ai-extra-providers.test.ts`, `tests/ai-client.test.ts`).
2. **Highest-ROI Next Additions from Your List:**
   - **Web Scraping for SEO & University Data:** `ioi-labs/molx` (lean 3–7 MB Go Firecrawl alternative, MIT) as an internal microservice for SEO audits, site migration previews, and university course/tuition scraping.
   - **Self-Hosted AI Phone & SIP Call Center for CRM:** `rasonyang/ai-native-callcenter` (Apache-2.0, Go + FreeSWITCH + realtime LLM voice + human SIP handoff) paired with `BelledonneCommunications/linphone-iphone` (as a standalone SIP softphone client only) and `CALLE-AI/awesome-phone-call-agents` safety patterns.
   - **In-App Student/Client Live Chat & Video Counseling:** `cometchat/cometchat-uikit-react` (+ mobile UI kits, `cometchat-skills`, `cometchat/docs-mcp`) embedded in `/dashboard/crm` and `/support-tickets`.
   - **Privacy-First Counselor Meeting Notes:** `Onyx-Dev-Labs/doodle-note` (MIT, local-first meeting capture without call bots) pushing summaries to `/api/crm/activities`.
   - **Student English & Exam Prep Apps (Deployable via `/deployments`):** `xiaochong/hi-kid` (MIT, React/TS speaking practice), `TheExplainthis/ChatGPT-AI-English-Tutor` (MIT, Whisper+LLM+TTS tutor concept), and `graykode/toeicbert` (MIT, grammar/TOEIC assessment).
   - **External Uptime + Email Blacklist Monitoring:** `hetrixtools.com` webhook → `/api/alerts` (catches whole-host or Cloudflare Tunnel outages and SMTP blacklist issues).
   - **Team Ops & Marketing:** `larksuite.com` (incoming webhooks for deploy/SSL/CRM lead alerts) and `buffer.com` (scheduled publishing from the `Social Media Manager` AI agent).
3. **Avoid Vendoring Directly into Production:**
   - `ramon-victor/freegpt-webui` (archived + GPL-3.0 + scraper fragility), `GetGoAPI/Free-GPT-Grok-Gemini-Claude-API` (unverified middleman risk), `nikmcfly/MiroFish-Offline` (AGPL-3.0 copyleft + heavy Neo4j stack — run isolated only), and `BelledonneCommunications/linphone-iphone` source code (GPL-3.0 — use the official app as a SIP endpoint, do not link into proprietary apps).

---

## 1. Mandatory Integration: `zai-org/GLM-5` (Implemented)

- **Repository:** <https://github.com/zai-org/GLM-5.git>
- **License:** Apache-2.0 | **Models:** `GLM-5`, `GLM-5.1`, `GLM-5.2`, `GLM-5.3` (744B-A40B MoE) & `GLM-5.3-Flash` (320B-A18B hybrid sparse+linear attention, 1M-token context, multimodal)

### How `GLM-5` Helps Us
1. **Panel AI Agents & DAG Automations (`/ai/automations`, `/api/agents/:slug/run`):**
   - Top open-weights performance on long-horizon coding, terminal debugging, vulnerability analysis, and 1M-token document analysis.
   - `GLM-5.3-Flash` provides low-latency, high-throughput responses ideal for interactive CRM copilots, website builder generation, and support ticket triage; `GLM-5.3` / `GLM-5` handles deep multi-step engineering and security review.
2. **Dual Deployment Modes Supported (`src/lib/ai/providers.ts`):**
   - **Cloud API (No GPU required):** Point `GLM_BASE_URL` at Z.ai International (`https://api.z.ai/api/paas/v4`) or Zhipu BigModel (`https://open.bigmodel.cn/api/paas/v4`) and set `GLM_API_KEY` (or `ZHIPU_API_KEY`, matching `zai-org/GLM-5`'s official `skills/glm-master-skill/SKILL.md`).
   - **Self-Hosted GPU Inference (Zero per-token cost):** Serve `zai-org/GLM-5.3-Flash` or `zai-org/GLM-5` on a dedicated GPU host with vLLM or SGLang and set `GLM_BASE_URL=http://127.0.0.1:8000/v1`. When pointed at localhost, the panel automatically treats `glm` as `self-hosted` (keyless allowed, works with `AI_FREE_ONLY=true`).
3. **Companion Official GLM Skills (`GLM-OCR`, `GLM-V`, `GLM-Image`):**
   - `zai-org/GLM-5` includes `skills/glm-master-skill/SKILL.md` linking `zai-org/GLM-OCR` (`pip install glmocr` using the same `ZHIPU_API_KEY`). For **ALO Education CRM**, `glmocr` can parse student passports, academic transcripts, bank statements, and IELTS/TOEIC scorecards into structured JSON/Markdown without needing local GPUs.

### Configuration Quick-Start (`.env`)
```dotenv
# Cloud API (Z.ai International or BigModel China):
GLM_API_KEY=your-key-here          # or ZHIPU_API_KEY=your-key-here
GLM_BASE_URL=https://api.z.ai/api/paas/v4
AI_MODEL_GLM=glm-5                 # or glm-5.3, glm-5.3-flash, glm-5.2, glm-5.1
GLM_REASONING_EFFORT=low           # optional: low | high | max

# Include glm in the failover chain:
AI_PROVIDER_ORDER=glm,openrouter,llm7,groq,qwen
```

---

## 2. AI Models, Gateways, Usage HUD & Coding Agents

| Resource | License / Type | Verdict | How It Helps Hosting-Portal & ALO CRM |
|---|---|---|---|
| `https://github.com/zai-org/GLM-5.git` | Apache-2.0 (Open weights + MaaS API) | **INTEGRATED NOW (`glm`)** | Added to `src/lib/ai/providers.ts`, `src/lib/ai/client.ts`, `alo-server-kit` LiteLLM config, `.env.example`, and `glm5-engineer` agent seed. |
| `https://openrouter.ai` | Commercial API Gateway | **ALREADY INTEGRATED (`openrouter`)** | Single key in `src/lib/ai/providers.ts` providing instant failover across 100+ upstream models (Claude, GPT, Gemini, GLM, Qwen, DeepSeek). |
| `https://coder.qwen.ai` | DashScope API + CLI Agent | **ADAPTER INTEGRATED (`qwen`)** | `qwen` OpenAI-compatible provider is wired in `src/lib/ai/providers.ts` (`QWEN_API_KEY`, `QWEN_BASE_URL`); `qwen2.5:7b` is pre-configured in `alo-server-kit` Ollama. Use Qwen Coder CLI on developer machines, not inside the Next.js server process. |
| `https://cline.bot` & `https://github.com/cline/cline.git` | Apache-2.0 (TS IDE/CLI/SDK Agent) | **CONFIGURED IN `alo-server-kit`** | Already wired in `alo-server-kit/stages/05-ai-tools.sh` and `configs/ai-tools/cline.settings.json` against local LiteLLM (`127.0.0.1:4000/v1`). Boosts ALO developer velocity; keep human approval enabled before running autonomous shell commands. |
| `https://github.com/xAerux/aerus-usage-hud.git` | MIT (JS Windows Desktop App) | **UI/UX REFERENCE** | Windows desktop HUD combining Codex, Claude Code, and local Ollama usage. Do not install on Linux servers, but use its unified multi-provider quota layout to enrich our portal's `token_usage` view (`src/lib/ai/usage.ts` / `AgentsView.tsx`). |
| `https://github.com/Lin-jun-xiang/docGPT-langchain.git` | MIT (Python Streamlit RAG Demo) | **ARCHITECTURE CONCEPT** | Demo PDF/DOCX/CSV chat app. Do not deploy raw Streamlit to customers; instead, implement document chunking + retrieval natively in Next.js/Prisma so CRM counselors can query visa rules, university brochures, and hosting runbooks via `completeWithAI()`. |
| `https://github.com/teremterem/claude-code-gpt-5-codex.git` | MIT (Python Local Proxy) | **DEV WORKSTATION ONLY** | Local LiteLLM bridge for running Claude Code CLI against OpenAI models. Useful for individual developers; server-side LiteLLM is already handled cleanly in `alo-server-kit/stages/04-ai-infra.sh`. |
| `https://github.com/ramon-victor/freegpt-webui.git` | GPL-3.0 (**Archived**) | **DO NOT USE** | Archived repo relying on brittle keyless scraping/proxies and copyleft GPL-3.0 license. Unsuitable for a commercial MIT hosting panel. |
| `https://github.com/GetGoAPI/Free-GPT-Grok-Gemini-Claude-API.git` | MIT wrapper (`okrouter.com` reseller) | **DO NOT USE** | Routes prompts and credentials through an unverified third-party proxy/reseller with ToS and data-privacy risk. Use official `glm`, `openrouter`, `llm7`, `groq`, or `qwen` adapters instead. |

---

## 3. Hosting Infrastructure, Proxy Management, Monitoring & Scraping

| Resource | License / Type | Verdict | How It Helps Hosting-Portal & ALO CRM |
|---|---|---|---|
| `https://github.com/OpenSourceSimon/nginx-proxy-manager.git` | MIT (Docker Nginx + Let's Encrypt GUI; fork of `NginxProxyManager/nginx-proxy-manager`) | **INFRA REFERENCE / OPTIONAL DOCKER APP** | Provides visual Nginx vhost, reverse-proxy, access-list, and Let's Encrypt wildcard SSL management. Always pull upstream `NginxProxyManager/nginx-proxy-manager` rather than a personal fork. Useful either as a 1-click Docker template in `/applications` for secondary VPS nodes or as a design reference for `/domains` + `/ssl` UI. (Do not bind ports 80/443 simultaneously on hosts already managed by `deploy/nginx/` or Caddy.) |
| `https://hetrixtools.com` | SaaS (External Uptime & Blacklist Monitor) | **HIGH-VALUE WEBHOOK INTEGRATION** | Complements internal `/api/monitoring`: monitors `hosting.alolabs.net` from external global nodes (detecting full host or Cloudflare Tunnel outages) and monitors ALO mail server IPs/domains against RBL/spam blacklists to protect `/api/email` deliverability. Connect via webhook to `/api/alerts`. |
| `https://github.com/ioi-labs/molx.git` | MIT (Go single binary, ~3–7 MB RAM) | **HIGH-ROI MICROSERVICE** | Lean, self-hosted Firecrawl replacement that turns arbitrary URLs into clean Markdown or structured JSON. Ideal backend helper for: (1) `SEO Analyzer` & `Migration Assistant` agents inspecting live websites, and (2) ALO Education CRM scraping university program pages, intakes, and scholarship updates. |

---

## 4. Real-Time Chat, VoIP, SMS, Meeting Notes & AI Call Center (CRM + Support)

This group directly strengthens **ALO Education CRM (`/dashboard/crm`)** and **Hosting Customer Support (`/api/support-tickets`)**:

### 4.1 In-App Live Chat & Video Consultation (CometChat)
| Resource | License / Role | How It Helps Us |
|---|---|---|
| `https://github.com/cometchat` | Official Organization | Managed real-time messaging, voice & video calling platform with React, mobile, and AI agent tooling. |
| `https://github.com/cometchat/cometchat-uikit-react.git` | Commercial SDK UI Kit (TS/React) | Drop-in React chat + WebRTC voice/video calling components that can embed into `CRMView` (student ↔ counselor chat) and client support portals. |
| `https://github.com/cometchat/cometchat-uikit-react-native.git` | React Native UI Kit | Best path if ALO builds a single cross-platform iOS/Android student & client mobile app. |
| `https://github.com/cometchat/cometchat-uikit-android.git` | MIT (Kotlin Android UI Kit) | Native Android chat + voice/video UI components (prefer this over legacy Java samples). |
| `https://github.com/cometchat/cometchat-uikit-ios.git` | Swift iOS UI Kit | Native iOS chat + voice/video UI components. |
| `https://github.com/cometchat/cometchat-skills.git` | MIT (Agent Skills) | Gives AI coding agents (Claude Code, Cline, Cursor) verified recipes to scaffold CometChat into Next.js/React/mobile projects rapidly. |
| `https://github.com/cometchat/docs-mcp.git` | Apache-2.0 (MCP Server) | Model Context Protocol server feeding live CometChat SDK docs to coding agents during implementation. |
| `https://github.com/ketanyekale/android-java-chat-app.git` | Legacy Java Fork | Old CometChat Pulse Java demo; skip in favor of `cometchat-uikit-android` (Kotlin) or React Native. |

### 4.2 AI Call Center, SIP/VoIP & SMS Gateways
| Resource | License / Stack | Verdict | How It Helps Us |
|---|---|---|---|
| `https://github.com/rasonyang/ai-native-callcenter.git` | Apache-2.0 (Go + FreeSWITCH + Postgres) | **TOP SELF-HOSTED PICK** | Single Go binary + FreeSWITCH SIP call center where an AI voice agent answers every inbound call (using OpenAI/Qwen/compatible realtime gateways) and seamlessly transfers complex calls to human counselors' SIP queue without dropping the call, logging the full transcript. Ideal for ALO student admission hotlines and 24/7 L1 hosting support. |
| `https://github.com/microsoft/call-center-ai.git` | Apache-2.0 (Python + Twilio/Azure) | **ENTERPRISE REFERENCE** | Mature API-triggered outbound/inbound AI phone call architecture — useful blueprint if using cloud telephony (Twilio/ACS) for automated visa interview reminders, payment follow-ups, or appointment confirmations. |
| `https://github.com/CALLE-AI/awesome-phone-call-agents.git` | MIT (TypeScript) | **WORKFLOW & SAFETY PATTERNS** | Reusable phone-call agent skills, scheduler recipes, and safety guardrails (explicit consent, call-hour windows, human escalation) we can adopt as node schemas in `/ai/automations`. |
| `https://github.com/amulchapla/AI-Powered-Call-Center-Intelligence.git` | MIT (JavaScript) | **CRM ANALYTICS BLUEPRINT** | Post-call speech-to-text, sentiment scoring, key-entity extraction, and summary cards — maps cleanly onto `/api/crm/activities` and `/api/crm/deals` powered by `glm-5`. |
| `https://github.com/Onyx-Dev-Labs/doodle-note.git` | MIT (TypeScript) | **COUNSELOR DESKTOP TOOL** | Privacy-first, local-first meeting capture and on-device transcription (no awkward recording bot joining Zoom/Google Meet). Counselors can capture 1-on-1 student consultations and push clean action items to ALO CRM. |
| `https://github.com/video-db/call.md.git` | TypeScript / Electron (No SPDX license) | **UX INSPIRATION ONLY** | Pre-call brief + live meeting copilot + post-call `.md` workflow concept. Because no open-source license is declared on the repo, use MIT-licensed `doodle-note` when reusing code. |
| `https://github.com/BelledonneCommunications/linphone-iphone.git` | GPL-3.0 (Swift SIP Softphone) | **USE AS SIP CLIENT APP ONLY** | Industry-standard iOS SIP softphone that connects directly to FreeSWITCH (`ai-native-callcenter`) so counselors can take transferred calls on iPhones. **Do not copy GPL-3.0 code into proprietary apps.** |
| `https://github.com/developerspace-samples/VoIP-Call-Sample.git` & `WebRTC-Kotlin-Sample.git` | Apache-2.0 / MIT (Android Java & Kotlin) | **MOBILE REFERENCE SAMPLES** | Clean educational samples showing Android `ConnectionService` native call screens and Firestore-signaled P2P WebRTC if building a custom ALO Android counselor app. |
| `https://github.com/domovinatv/sms.domovina.ai.git` | Go (`NdoleStudio/httpsms` + Cloudflare Tunnel) | **REGIONAL OPS / SMS GATEWAY** | Turns an Android SIM phone into a self-hosted HTTP SMS gateway exposed securely behind Cloudflare Tunnel (matching our edge stack). Practical for low-cost local SMS OTPs, SSL/server down alerts, and student appointment reminders (verify carrier AUP and upstream `httpsms` license). |
| `https://github.com/PennyroyalTea/gibberlink.git` | MIT (TS `ggwave` audio modem) | **R&D CURIOSITY ONLY** | Demo where two AI voice agents switch to `ggwave` sound-level data transmission. Fun showcase, no production need in Hosting-Portal or CRM (use HTTPS/webhooks between agents). |

---

## 5. Education, AI English Tutor & Exam Prep (ALO Education Student Products)

Because ALO Education (`aloeducation-org-crm`) serves students preparing for international study and English proficiency exams, these repositories map directly to **value-added student web apps** we can host and deploy via `/deployments`:

| Resource | License / Stack | Verdict | How It Helps ALO Education |
|---|---|---|---|
| `https://github.com/xiaochong/hi-kid.git` | MIT (React + TypeScript) | **ADAPTABLE STUDENT APP** | Interactive English speaking & listening practice frontend in React + TypeScript (matching our stack). Can be rebranded for ALO students and wired to our `glm` / `groq` / `openrouter` backend for conversational speaking practice. |
| `https://github.com/TheExplainthis/ChatGPT-AI-English-Tutor.git` | MIT (Python — Whisper + LLM + TTS) | **MESSAGING BOT BLUEPRINT** | Voice-note English tutor bot that transcribes student speech, corrects grammar, replies with TTS audio, and tracks recurring learner mistakes. Great blueprint for an ALO WhatsApp/Telegram IELTS/spoken-English practice bot. |
| `https://github.com/xckevin/magic-english-buddy.git` | TypeScript Offline-First PWA (`NOASSERTION` license) | **PWA ARCHITECTURE REFERENCE** | Demonstrates an offline-capable installable PWA with graded lessons, word-level audio highlighting, flashcards, and local learner profiles (ideal for students on spotty mobile data). Treat as UX inspiration only unless license permission is obtained. |
| `https://github.com/graykode/toeicbert.git` | MIT (Python PyTorch BERT) | **ASSESSMENT REFERENCE** | Automated TOEIC incomplete-sentence solver using BERT. Useful reference for building quick placement quizzes and grammar diagnostics in ALO's student onboarding funnel; modern `glm-5.3-flash` can also generate and grade full IELTS/TOEIC mock items with detailed explanations. |

---

## 6. Accounting, Business Operations, Marketing & QA Testing

| Resource | License / Type | Verdict | How It Helps Hosting-Portal & ALO Ops |
|---|---|---|---|
| `https://github.com/VonHoltenCodes/SlowBooks-Pro-2026.git` | Source-available (`NOASSERTION`, Python) | **INTERNAL BACK-OFFICE / SELF-HOSTED APP** | Full double-entry bookkeeping, invoicing, inventory, and multi-user Server Edition without cloud subscriptions. Useful for ALO's internal accounting reconciliation alongside `/api/invoices` & Stripe, or as an internal server app (review license before commercial resale). |
| `http://www.enerpize.com` | Commercial Cloud ERP SaaS | **OPTIONAL FINANCE SAAS / BENCHMARK** | Cloud accounting, inventory, HRM & CRM suite. Overlaps with our built-in CRM/Billing; only integrate via webhook/CSV export if ALO's finance team already uses Enerpize. |
| `https://www.larksuite.com` | Enterprise Collaboration SaaS | **HIGH-VALUE OPS WEBHOOK** | Add Lark custom bot webhooks to `/api/alerts`, `/api/deployments`, and `/api/crm/deals` so build failures, SSL expirations, and new student leads notify ALO teams in real time. |
| `https://buffer.com` | Social Scheduling SaaS | **MARKETING WORKFLOW FIT** | Connect `Social Media Manager` / `Content Writer` agent outputs (`src/lib/seed-agents.ts`) or `marketing.alolabs.net` to Buffer's OAuth API to queue multi-channel social posts. |
| `https://www.refine.ink` | AI Writing / Editing SaaS | **FEATURE BENCHMARK** | Editorial polishing workflow — great UX reference for upgrading our `Content Writer` / `Email Composer` agents and adding an **SOP / Personal Statement Reviewer** agent for study-abroad students. |
| `https://hatchable.com` | Brand & Naming SaaS | **FEATURE BENCHMARK** | Brand naming & launch workflow — aligns with our `Domain Advisor` + `Logo Concept Generator` + `/api/domains/search` onboarding flow. |
| `https://www.mureka.ai` | Commercial AI Music SaaS | **MARKETING MEDIA ONLY** | Useful externally for royalty-free background music in ALO promo reels or listening lessons; not a backend dependency for Hosting-Portal. |
| `https://www.aipraktor.com` & `https://supercool.com` (`join.supercool.com`) | External AI SaaS Products | **COMPETITIVE / UX REFERENCE** | External AI automation / creative platforms; no open-source code to vendor. |
| `https://github.com/nikmcfly/MiroFish-Offline.git` | **AGPL-3.0** (Python + Neo4j + Ollama) | **ISOLATED R&D SANDBOX ONLY** | Local multi-agent audience/market sentiment simulator. Could test how student segments react to new scholarship campaigns on a separate GPU workstation, **but never link AGPL-3.0 code into Hosting-Portal (MIT)**. |
| `https://github.com/iamakshayshar/AITestCaseGenerator.git` | MIT (Python — OpenAI/Ollama → `pytest`) | **QA AUTOMATION PATTERN** | Auto-generates test cases from plain-English specs. Adapt the prompt/pipeline to generate Vitest route & RBAC regression tests across our 74 Prisma models. |
| `https://github.com/monkscode/Natural-Language-to-Robot-Framework.git` | Apache-2.0 (Python → Robot Framework) | **E2E QA TOOLING** | Converts plain-English test scenarios into validated Robot Framework suites — useful in CI staging to verify `/login`, `/sites`, `/deployments`, and `/dashboard/crm` user journeys. |
| `https://github.com/mattpocock/dictionary-of-ai-coding.git` & `https://stackoverflow.com` | Reference / Documentation | **TEAM ONBOARDING** | Plain-English AI engineering glossary (MCP, harnesses, evals, context engineering, RAG) + Q&A reference for onboarding ALO developers. |
| `https://mat3ra.com` (`platform.mat3ra.com`) & `https://astryx.atmeta.com` | Materials-Science Cloud / Meta Proprietary Endpoint | **NOT APPLICABLE** | Unrelated domain-specific/proprietary platforms (`mat3ra` = computational materials science; `astryx.atmeta.com` = Meta service); no integration needed for web hosting or education CRM. |

---

## 7. Recommended Phased Roadmap for ALO Labs & ALO Education CRM

1. **Phase 1 — Live Today (Completed in this branch):**
   - **GLM-5 (`zai-org/GLM-5`)** wired into `src/lib/ai/providers.ts`, `src/lib/ai/client.ts`, `alo-server-kit` LiteLLM gateway, `.env.example`, and `GLM-5 Agentic Engineer` (`glm5-engineer`) agent seed.
2. **Phase 2 — Quick Wins (1–2 Weeks):**
   - **External Monitoring & Ops Alerts:** Connect **HetrixTools** uptime/blacklist webhooks + **Lark Suite** incoming webhook notifications to `/api/alerts` and `/api/deployments`.
   - **GLM-OCR Student Document Intake:** Wire `zai-org/GLM-OCR` (sharing `ZHIPU_API_KEY`) as a background document parser for CRM student transcripts, passports, and IELTS/TOEIC certificates.
   - **Lean Web Scraper (`ioi-labs/molx`):** Run `molx` bound to `127.0.0.1` and expose a read-only `fetchPageMarkdown` tool in `src/lib/ai/automation/tools.ts` for SEO audits and university page monitoring.
3. **Phase 3 — Omnichannel CRM & Student Apps (3–6 Weeks):**
   - **Live Chat + Video Counseling:** Embed `cometchat-uikit-react` in `/dashboard/crm` and `/support-tickets` (accelerated with `cometchat-skills` + `docs-mcp`), plus `Onyx-Dev-Labs/doodle-note` for counselor meeting summaries.
   - **Self-Hosted AI Call Center:** Deploy `rasonyang/ai-native-callcenter` (Go + FreeSWITCH) on a dedicated voice node integrated with CRM contacts/activities and staff Linphone SIP clients.
   - **Hosted ALO English Prep App:** Deploy a branded fork of `xiaochong/hi-kid` + speaking/writing feedback powered by `glm-5.3-flash` through Hosting-Portal's Git Autodeploy (`/deployments`).
