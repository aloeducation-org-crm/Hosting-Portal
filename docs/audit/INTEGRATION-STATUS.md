# Integration Status

> One row per external integration. "Implemented" means code exists and is
> exercised by a test. It does **not** mean the vendor was contacted. Nothing in
> this column was verified against a real vendor endpoint from this sandbox,
> which has no outbound access to any of them.

## 1. Status table

| Integration | Module | Code | Verified live? | Status | Evidence |
|---|---|---|---|---|---|
| GitHub OAuth / App | `src/lib/deploy/connections.ts`, `/api/github/*` | Yes | No | **PARTIAL** | Tenant-isolation tests (23); connection CRUD; no live OAuth round-trip |
| Git clone (build factory) | `src/lib/deploy/` | Yes | No | **PARTIAL** | Needs a real remote; clone path exercised only against fixtures |
| GitHub webhooks | `/api/webhooks/github` | Yes | No | **PARTIAL** | HMAC verification tested; no delivery from GitHub |
| Stripe (paid plans) | `src/lib/stripe.ts` | Guard only | No | **BLOCKED** | Deliberately throws `PaymentProviderUnavailableError` when unconfigured; `createBillingCheckoutSession` returns a local free session for a zero-price plan and **refuses** to fabricate a paid one |
| Payment verification | `PaymentVerifier` interface | Interface only | No | **BLOCKED** | `noPaymentVerifier` rejects every claim; paid self-service is structurally impossible until a verifier is injected |
| SMTP / transactional email | `src/lib/smtp.ts` | Yes (`sendEmail`) | No | **PARTIAL** | Code path exists; no configured relay in this checkout, so delivery is unverified |
| DNS provider API | `src/lib/dns-provider.ts`, `alo-dns-helper` | Partial | No | **BLOCKED** | No provider credentials present; domain registration is not performed |
| Cloudflare (DNS/TLS) | `src/lib/cloudflare.ts` | Guard only | No | **NOT IMPLEMENTED** | `issueCertificate` returns `{success:false, error:"NOT_IMPLEMENTED: …"}` — no certificate is invented |
| ACME / Let's Encrypt | `alo-ssl-helper` | Helper only | No | **PARTIAL** | Helper contract exists; orchestrated cert worker returns `NOT_IMPLEMENTED` |
| Local Ollama (AI) | `src/lib/ai/providers.ts`, `self-hosted-agents.ts` | Yes | No | **PARTIAL** | Local-first provider selection exists; no model was run in this sandbox |
| OpenAI-compatible cloud AI | `src/lib/ai/providers.ts` | Yes | No | **PARTIAL** | Disabled unless a key is configured; no key present |
| Docker engine | `alo-docker-helper` | Yes | No | **PARTIAL** | No daemon in this sandbox; container path unverified |
| systemd / sudo helpers | `helpers/*` (23) | Yes | No | **PARTIAL** | Scripts parse (`bash -n` in CI); not executed as root here |
| Server agent | `agent/alo-agent.mjs` | Yes | No | **PARTIAL** | Signing/transport/heartbeat tested against a fake server; no real enrollment |
| Reverse proxy (nginx/Caddy) | `deploy/nginx/*` | Config | No | **PARTIAL** | Config present, not applied |
| Site backup/restore | `helpers/alo-site-backup`, `helpers/alo-site-restore` | Yes | No | **PARTIAL** | Backup writes a SHA-256 checksummed archive; restore verifies the checksum and aborts on mismatch. Real path, not executed as root in this sandbox. |
| Database restore (automated drill) | orchestrator worker | No | No | **NOT IMPLEMENTED** | Returns `NOT_IMPLEMENTED` rather than faking a restore |
| Monitoring / alert delivery | `/api/monitoring/collect` | Rules only | No | **PARTIAL** | Evaluation exists; no delivery channel proven, no scheduler |
| Firebase / Google Drive | — | No | — | **NOT APPLICABLE** | Not referenced by product code |

## 2. What "PARTIAL" is hiding

The four integrations most likely to be read as "done" because code exists are
Stripe, email, DNS and TLS. Each has an honest refusal path:

```ts
// src/lib/stripe.ts — paid plan, no provider
throw new PaymentProviderUnavailableError(
  "Paid plans cannot be purchased because no payment provider is configured on this platform.",
);
```

```ts
// src/lib/cloudflare.ts — certificate issuance
return { success: false, error: "NOT_IMPLEMENTED: Cloudflare certificate issuance is not
  wired to a verified provider API. No certificate was issued and no expiry was invented." };
```

These are the correct behaviours. A system that refuses to claim it issued a
certificate is more trustworthy than one that returns a plausible-looking object.

## 3. Blocked integrations and what unblocks them

| Integration | Missing dependency | Owner action | Safe next step |
|---|---|---|---|
| Stripe | account, restricted API key, webhook signing secret, test-mode product ids | Provide test-mode credentials in a non-production secret store | Implement `PaymentVerifier` against Stripe test mode; assert a webhook-verified `payment_intent.succeeded` before granting a plan |
| Payment verification | the above | same | Land the verifier plus a test that a forged `transactionRef` is rejected |
| DNS provider | provider choice + API token scoped to one zone | Choose provider, issue a scoped token | Implement register/update/delete against a **test** zone before any real domain |
| Cloudflare TLS | Cloudflare account + origin CA token | Issue a scoped token | Replace the `NOT_IMPLEMENTED` guard only when a test certificate can be fetched and its chain verified |
| SMTP | relay host, credentials, verified from-domain | Provide a relay and SPF/DKIM records | Send one message to a mailbox you control and assert receipt |
| Alert delivery | channel choice (email/webhook/Slack) | Pick one | Prove a single delivery end-to-end |

## 4. Integration test realism

No test in this repository mocks a vendor and then calls the platform "verified".
Where a vendor cannot be reached, the test asserts the **refusal**: that a paid
plan is rejected with 402, that a certificate is not fabricated, that a webhook
with a bad signature is refused. This is deliberate and is the only honest
coverage available without credentials.
