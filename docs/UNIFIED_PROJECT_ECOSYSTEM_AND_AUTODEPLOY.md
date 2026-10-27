# ALO Hosting Portal — AI-Driven Automation Server & Zero-Terminal Auto-Deploy Architecture

**Generated:** 2026-10-27 (Asia/Dhaka)  
**Branch:** `arena/c2523ce5-hosting-portal`  
**Status:** Verified End-to-End (`lint`, `typecheck`, `16/16` Vitest suites / `141/141` tests, `167/167` Next.js production routes, live HTTP preview server)

---

## 1. Executive Summary (সংক্ষিপ্ত সারসংক্ষেপ)

`ALO Hosting Portal` এখন একটি পূর্ণাঙ্গ **AI-Driven Automation Server এবং Hostinger / Render / Panelica ধাঁচের Zero-Terminal Custom Hosting Control Plane** হিসেবে প্রস্তুত। অপারেটরদের আর প্রতিবার ম্যানুয়ালি SSH করে সার্ভারে প্রজেক্ট সেটআপ করতে হবে না—ড্যাশবোর্ডের **`/ai/auto-deploy` (AI Auto-Deploy Studio)** এবং **`/deployments`** থেকে এক জায়গায় নিচের তিন ধরনের প্রজেক্ট স্বয়ংক্রিয়ভাবে সেটআপ, বিল্ড, SSL সংযুক্ত এবং অটো-ডেপ্লয় করা যাবে:

1. **Web Applications (`workloadCategory: "web"`)**: Next.js 16 Standalone, React/Vite/Astro SPA, Nuxt, SvelteKit, Remix, Laravel / PHP 8.2, Static HTML।
2. **Server-Side Applications (`workloadCategory: "server"`)**: Node.js (NestJS / Express / Fastify / Hono), Python (FastAPI / Django / Flask / AI Agent Servers), Go (`go-http`), Rust (`rust-cargo`), Dart Server, Docker।
3. **Mobile Applications (`workloadCategory: "mobile"`)**: Expo / React Native (Universal Web + OTA Update Bundle Hosting), Flutter (`flutter build web --release` + Release Distribution Hub), Ionic / Capacitor Hybrid Mobile Apps, Android Gradle।

---

## 2. Reference Ecosystem & License Audit Matrix (রেফারেন্স রিপোজিটরি ও লাইসেন্স অডিট)

স্যান্ডবক্সে সরাসরি GitHub API এবং আসল `LICENSE` ফাইল যাচাই করে প্রতিটি রেফারেন্স প্রজেক্টের স্ট্যাটাস নির্ধারণ করা হয়েছে। স্যান্ডবক্সের নেটওয়ার্ক পলিসির কারণে নন-গিটহাব ওয়েবসাইটগুলো (`BLOCKED`) স্পষ্টভাবে আলাদা রাখা হয়েছে—কোনো অনুমান বা কল্পিত দাবি করা হয়নি।

| # | Reference Source | Audit Status | Verified License | Integration / Decision in `Hosting-Portal` |
|---|---|---|---|---|
| 1 | `Agenta-AI/awesome-ai-agent-platforms` | `PASS` (Audited) | `CC0-1.0` | Cross-referenced against our 18-preset `SELF_HOSTED_AGENT_CATALOG` and 13-use-case decision matrix. |
| 2 | `odysseus-dev/odysseus` (`94.5k★`) | `PASS` (Audited) | `AGPL-3.0` | Added as `odysseus` in `src/lib/ai/self-hosted-agents.ts` (`multi-service-compose`, port `7011`, `auditDecision: "INTERNAL ONLY"`, `commercialMultiTenantAllowed: "conditional"`). Never embed AGPL code into portal source. |
| 3 | `unorouter` (`new-api`, `unorouter`, `new-api-sync`) | `PASS` (Audited) | `AGPL-3.0` (core) / `MIT` (`new-api-sync`) | Consumed strictly over OpenAI-compatible HTTP API (`UNOROUTER_API_KEY`, `UNOROUTER_BASE_URL` in `src/lib/ai/providers.ts`). Zero AGPL code copied. |
| 4 | `okrouter/okrouter-python` | `PASS` (Audited) | `MIT` | Added optional `okrouter` OpenAI-compatible HTTP provider in `src/lib/ai/providers.ts` (`OKROUTER_API_KEY`, `OKROUTER_BASE_URL`). |
| 5 | `Panelica/panelica` & `Panelica/panelica-mcp` | `PASS` (Audited) | Proprietary (core) / `MIT` (`panelica-mcp`) | Adopted permission-scoped AI hosting tool pattern in `src/lib/ai/automation/tools.ts` (`listSites`, `siteHealth`, `sslExpiring`, `listDeployments`, `automationOverview`). |
| 6 | `rossomari/unipanel` | `PASS` (Audited) | `MIT` | Ionic + React + Capacitor mobile server panel; added first-class `ionic-capacitor` & `capacitor` auto-detection and mobile deployment blueprint. |
| 7 | `ansible-lockdown/UBUNTU22-CIS` | `PASS` (Audited) | `MIT` | Implemented read-only Ubuntu 22.04 CIS & Hosting Hardening Baseline inspector (`src/lib/security/ubuntu-cis-baseline.ts`). |
| 8 | `VonHoltenCodes/SlowBooks-Pro-2026` | `PASS` (Audited) | Custom Source Available v2.0 | **REJECT for commercial/SaaS hosting** — license explicitly forbids selling, renting, or offering as a paid service. |
| 9 | `MFDGaming/ubuntu-in-termux` | `PASS` (Audited) | **NO LICENSE** | **REJECT** — unmaintained (`2024-11`) Android Termux script with no open-source license; all rights reserved by default. |
| 10 | `modded-ubuntu/modded-ubuntu` | `PASS` (Audited) | `Apache-2.0` | **NOT APPLICABLE** — Android Termux proot desktop environment, unsuitable for Linux server hosting. |
| 11 | `Justmalhar/claude-ubuntu-os` | `PASS` (Audited) | `MIT` | **REJECT for production servers** — unmaintained (`2024-10`) VNC/noVNC desktop container exposing GUI attack surface. |
| 12 | `canonical/multipass`, `ubuntu/ubuntu-make`, `ubuntu/app-center` | `PASS` (Audited) | `GPL-3.0` | **NOT APPLICABLE to portal source** — desktop/VM `GPL-3.0` tools; production server provisioning uses `deploy/alo-server-kit` Ubuntu scripts. |
| 13 | `drevon.dev`, `panelica.com`, `munderdiffl.in`, `emasterlabs.com`, `render.com`, `okrouter.com` | `BLOCKED` | Unverified (Web host blocked) | Outbound sandbox policy permits only `github.com`, `npmjs.org`, and `pypi.org`. Note: `csakash/drevon` was audited via GitHub earlier (`MIT`). |

---

## 3. Zero-Terminal Auto-Deploy Pipeline (স্বয়ংক্রিয় ডেপ্লয়মেন্ট পাইপলাইন)

```
[AI Auto-Deploy Studio (/ai/auto-deploy)]
        │
        ├─► 1. Stack Detection & AI Blueprinting (`architectAutoDeployPlan` + `detectFramework`)
        │      • Supports Bengali & English prompts + GitHub `owner/repo` + pasted manifests
        │      • Classifies workloadCategory: "web" | "server" | "mobile"
        │
        ├─► 2. Strict Security Gate (`validateDeployConfig`)
        │      • Argv-only allowlisted binaries (`npm`, `pnpm`, `yarn`, `bun`, `npx`, `node`,
        │        `python3`, `composer`, `php`, `flutter`, `dart`, `go`, `cargo`, `gradle`)
        │      • Blocks `bash`, `sh`, `curl`, pipes, redirects, and shell metacharacters
        │
        ├─► 3. Atomic Workspace & Secret Vault Provisioning (`POST /api/ai/auto-deploy`)
        │      • Creates `Website` + primary `Domain` (Auto-SSL) + `Application` + `GitProject`
        │      • Auto-generates 256-bit CSPRNG secrets & encrypts via AES-256-GCM (`encryptSecret`)
        │      • Queues `OperationJob` + initial `Deployment` + `AuditLog`
        │
        └─► 4. Immutable Release Activation & Health Rollback (`src/lib/deploy/engine.ts`)
               • Clones commit SHA -> builds in isolated staging dir -> flips `current` symlink
               • Probes `healthPath` for HTTP 200; automatically restores previous symlink on failure
```

---

## 4. Verification & Live Server Commands

```bash
# 1. Run full static, type, unit/E2E test, and production build verification
npm run verify

# 2. Verify AI Automation Server provider chain & tenant-scoped DAG workflow tools
npx tsx scripts/ai-automation-check.ts

# 3. Start portal bound to 0.0.0.0 for live preview / reverse-proxy access
npx next start -H 0.0.0.0 -p 3000
```
