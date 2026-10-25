# AI provider / gateway integration

## What is integrated

The root Next.js application now has one server-side OpenAI-compatible chat-completions adapter used by AI chat, code generation, domain suggestions, and website generation. The provider API key is only read on the server; it is not returned by the status endpoint or sent to the browser. Requests have a two-minute timeout, provider response bodies are not leaked in errors, and missing configuration returns HTTP 503 rather than a demo answer.

`GET /api/ai/status` (authenticated) reports only configuration state and model ID. `CONFIGURED_NOT_CHECKED` explicitly does **not** mean the gateway/model has been reached or is healthy.

## Configure a provider or gateway

Set these on the application server, not in client-side variables:

```dotenv
OPENAI_API_KEY=<server-side gateway credential>
OPENAI_BASE_URL=https://<gateway-host>/v1
AI_MODEL=<model identifier enabled by that gateway>
```

The adapter appends `/chat/completions` to the configured base URL. For a local OpenAI-compatible gateway, set its reachable server-side base URL and the authentication value expected by that gateway. Never commit a real key; restart the application after changing environment values.

The adapter is compatible with gateways that expose the OpenAI chat-completions API. It has **not** been tested against a live UnoRouter deployment in this workspace; the gateway's actual API host, API key, enabled model ID and usage policy must be supplied by the operator.

## Cost and licensing

UnoRouter's repository describes a gateway/storefront for model access; it does not make upstream inference free. Upstream models may require paid accounts, credits or other provider terms. A locally hosted open model can avoid per-token API charges but still requires suitable hardware (often GPU/VRAM), electricity, disk, operations and model-license compliance. Do not advertise a free quota unless the chosen upstream provider contract actually provides it.

## Video and other supplied repositories

The supplied video-generation, subtitle-removal, retalking, upscaling, editing, streaming and agent projects are **not installed or wired into this app**. They are separate model runtimes or toolchains, not interchangeable chat-completions endpoints; some require large model weights, Python/CUDA, substantial GPU memory, separate storage/worker isolation and license checks. Email-marketing tools are also unrelated to AI inference. Pulling all repositories into the production portal would add substantial supply-chain and operational risk.

A safe next step is to select one specific workflow (for example, asynchronous text-to-video using one model) and define GPU host, license, storage/retention, queue, job quotas, cancellation, output delivery and security boundaries. Implement it as an isolated worker/service with an authenticated job API; do not install or execute third-party code as root from the Next.js process.

## Verification

The adapter's root unit test verifies it fails closed without a key. No provider credentials are available in this environment, so live gateway connectivity, model availability, response quality, cost, streaming and rate limits remain **NOT TESTED**.
