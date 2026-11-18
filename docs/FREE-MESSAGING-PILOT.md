# Sister-company pilot: free email and SMS

**IMPLEMENTED, NOT LIVE-VERIFIED.** The panel, durable outbox and fixed provider adapters have passed local and packaged tests. Do not install or enable the worker, enroll a provider, send to a real recipient, or open customer registration until separately authorized. The tests do not verify a provider account, carrier plan, sender domain, or delivery. Nothing here purchases credits, registers a sender, or changes a plan.

## Register and select the pilot account

1. Identify the approved sister company, its named account owner, staging panel/domain, operator and DNS owner. Use a separate staging database, approved backup, and a release built from a reviewed commit. Apply the two additive migrations with the schema applier; do not reset or seed a live database. For a staging DB that does not already have other required changes, use the normal additive release migration process first.
   ```sh
   # DATABASE_URL is already set to the explicitly authorized staging database.
   node scripts/apply-deploy-schema.mjs --migration 20261118183000_signup_approval
   node scripts/apply-deploy-schema.mjs --migration 20261118190000_pilot_messaging
   node scripts/apply-deploy-schema.mjs --migration 20261118183000_signup_approval --verify
   node scripts/apply-deploy-schema.mjs --migration 20261118190000_pilot_messaging --verify
   ```
2. Leave `SIGNUP_APPROVAL_MODE=pilot` (default, also used on an empty or unrecognized value). The owner signs up and verifies their mailbox. A `SUPER_ADMIN` verifies the company's identity independently, opens `/users` → **Show pending reviews**, and approves that exact account. A normal admin cannot approve or activate it through the generic user-management API. Password, MFA and OAuth sign-in all enforce the hold. Signup approval is independent of completing onboarding; it does not select or purchase a plan. Pending signup also does not provision a subscription; if needed, the owner selects a plan in onboarding after approval. Existing accounts are not rewritten by the migration.
3. Put only the approved account's immutable user ID in `MESSAGING_PILOT_USER_ID` in both the panel and worker. Leave it unset everywhere else. The worker requires the audited super-admin decision; a legacy or auto-approved public-signup status is not enough. Other tenants can save drafts but cannot dispatch to the pilot. A super admin can record opt-in in `/dashboard/marketing` → **Email & Audience** → **Free email & SMS pilot**. Use consent records for that business identity and channel; do not treat CRM contacts, public newsletter rows, account creation or scraped addresses as consent.
4. Open public registrations **only after acceptance and an explicit operator go-ahead**: change `SIGNUP_APPROVAL_MODE` to `open` to bypass review for *future* signups. Existing pending/rejected accounts are not silently admitted. Email verification and deployment/billing permissions still apply. This setting does not expand who may send pilot messages.

## Verify each route before approval

Use only dedicated, legitimately enrolled accounts whose free plans permit this pilot, with no chargeable overage, paid credits, automatic upgrade, or trial-to-paid conversion. Check current terms, actual remaining quota and quota reset rules at the provider. Do not add accounts, SIMs or credentials to bypass provider restrictions. Decline any route whose terms, business-use eligibility, recipient consent or no-overage control cannot be verified. Keep evidence in a restricted operations ticket, not in the repository.

| Worker route | Evidence to confirm before enabling | What the adapter records |
| --- | --- | --- |
| httpSMS | [API implementation at reviewed commit](https://github.com/NdoleStudio/httpsms/blob/0ee2c7efb8b3a32bc6cd54c256e7be81c4ef3cb7/api/pkg/handlers/message_handler.go), [hosted offer](https://httpsms.com/). Dedicated authorized Android + SIM, no carrier overage, opt-in and allowed domestic recipient range. The cloud account and SIM are separate costs/quotas; leave room for inbound usage. The public sandbox is not a customer relay. | Queued receipt with matching portal request ID; a documented free-plan 402 before enqueue can fall through. |
| textbee | [API implementation](https://github.com/textbee/textbee/blob/89a2b510b9073171e9b9219a3b35acde63652ab6/api/src/gateway/gateway.controller.ts), [offer](https://textbee.dev/text-message-api). Verify business use plus authorized paired Android device, SIM, region, and no carrier overage. Disable extra carrier retries/roaming/premium routes as appropriate. | Queued batch receipt. A quota-shaped 429 or payment hold is not eligible for post-attempt failover. |
| Resend | [Pricing and newsletter API requirements](https://resend.com/pricing), [acceptable use](https://resend.com/legal/acceptable-use), [quota errors](https://resend.com/docs/api-reference/rate-limit). Confirm the sender identity and permitted opt-in use of the single-recipient `/emails` endpoint. Verify the free account has no paid overage, inbound usage or other traffic consuming the allocation. | Provider email ID; only `daily_quota_exceeded` or `monthly_quota_exceeded` on 429 can fall through. |
| Brevo | [Free plan terms](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [API errors](https://developers.brevo.com/docs/how-it-works), [email API schema](https://github.com/getbrevo/brevo-node/blob/main/src/api/resources/transactionalEmails/client/requests/SendTransacEmailRequest.ts). Verify the approved use of single-recipient SMTP API for this content, free plan, consent and tracking settings, and no paid credits. If marketing on that endpoint or required unsubscribe headers are not approved for the account, do not enroll Brevo. | Provider message ID. `not_enough_credits` on this endpoint is not eligible for post-attempt failover. |

Brevo and textbee can serve as a second approved route when the first is already at its local cap or gave a proven pre-acceptance quota rejection. Neither triggers automatic resubmission after its own ambiguous response. No vendor error outside the reviewed httpSMS and Resend cases is treated as a free-limit signal.

Both SMS adapters use the Android phone's actual carrier, not a pool of free destinations. A zero-price gateway account alone does not mean free SMS. Authorize each selected number for a non-premium domestic route under **a carrier plan that cannot add charges**. `allowedPrefix` is an additional restriction, not proof of carrier eligibility. If primary and backup share an allowance (SIM, account, inbound traffic, etc.), allocate conservatively across them or don't enable both. Use SMS only for the approved pilot notices; monitor replies and record a STOP/suppression immediately on every route. Automated inbound SMS handling is not included.

For email: verify the same business sender on both enabled providers, SPF/DKIM/DMARC alignment, the envelope identity, required physical address, and HTTPS access to the opt-out page. Disable nonconsensual tracking. Configure provider notifications and manually suppress any permanent bounce or complaint immediately; live bounce/complaint ingestion and automated delivery verification are not shipped. The worker sends plain text with a visible opt-out link and one-click headers. GET displays confirmation and does not opt anyone out; the opaque token POST suppresses all future pilot email for that recipient, regardless of route. Requests already in flight cannot be recalled. Keep unsubscribe tokens and recipient data out of request/access logs and tickets. Before enabling email, configure all reverse proxies, CDNs and observability layers to omit the query string on the exact `/api/messaging/unsubscribe` path (or disable logging for that path). Confirm the external response retains `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Staging configuration (opt-in)

The `alo-messaging-worker.service` is a manually installed/enabled optional unit; a build does not start it. Run it as dedicated `alo-messaging`, with read access to the packaged bundle and only the necessary database/SQLite sidecar permissions. Restrict egress to approved fixed provider origins. Do not give it site, backup, shell-helper, or deployment credentials. Treat access to the shared control-plane database as privileged. Verify filesystem access and staging capacity first; never loosen permissions on unrelated files. Stop every worker before changing route configuration, migrating, restoring, or changing the pilot account.

Use a root-owned protected service env file. Supply the shared staging `DATABASE_URL`, `APP_ENCRYPTION_KEY` (for sealed opt-out tokens), and `APP_URL` (actual canonical staging HTTPS origin when email is enabled). The shared production env validator also requires strong `NEXTAUTH_SECRET`, `JWT_SECRET` and `INTERNAL_SECRET`; use separate worker-local random values for those unused worker settings. Do not source the full panel env into the worker. Provider keys are only in this worker's secret injection, never in panel/CI/build env, version control, tickets or messages. One scoped API key for each enabled provider is required: `MESSAGING_HTTPSMS_API_KEY`, `MESSAGING_TEXTBEE_API_KEY`, `MESSAGING_RESEND_API_KEY`, `MESSAGING_BREVO_API_KEY`. Start with one route and one controlled recipient per enabled channel. Require explicit opt-in before adding a backup.

`MESSAGING_FREE_ROUTES` is a worker-only JSON object. Routes are ordered per channel. The following illustrates the shape only; replace every placeholder after review and remove unapproved routes:

```json
{
  "sender": {"name": "Approved business name", "email": "sender@verified.example", "postalAddress": "Approved physical mailing address"},
  "routes": [
    {"provider": "resend", "hardCappedFree": true, "reviewRef": "OPS-approval-reference", "validUntil": "YYYY-MM-DDTHH:MM:SSZ", "dailyCap": 2, "monthlyCap": 2},
    {"provider": "httpsms", "hardCappedFree": true, "reviewRef": "OPS-approval-reference", "validUntil": "YYYY-MM-DDTHH:MM:SSZ", "dailyCap": 1, "monthlyCap": 1, "carrierOverageDisabled": true, "from": "+8801700000000", "allowedPrefix": "+8801"}
  ]
}
```

Brevo uses the same shape as Resend with `provider: "brevo"`. textbee uses the same SMS attestation, caps and prefix, with `provider: "textbee"` and the paired `deviceId` instead of `from`. Omit `sender` if there are no email routes. `validUntil` is at most 31 days from configuration load. The literals are operator attestations to current real limits, not billing API checks. Caps are rolling 24-hour / 31-day limits on portal reservations including unsuccessful/uncertain attempts, not a guarantee that the vendor still has that allowance left. Account usage outside the portal and SIM usage by the handset must be budgeted separately. Provider reference proofs and hard caps at the provider/carrier are required, not just flags in this file.

## Send, verify and stop

- Create an email draft with a plain-text body, review it, then explicitly queue it for the opted-in pilot audience. Queue SMS individually against approved numbers. The portal caps pilot contacts at 25 per channel and queue records at 50 per channel per rolling day. It never turns historical `sent` counters into proof; old campaign records are preserved and shown as legacy. The AI operator can prepare drafts only. Signup/verification/password recovery SMTP is a separate transactional workflow, not part of this free queue.
- A 202 only means **queued**. The worker rechecks account authorization, consent, operator-approved configuration, and budget. It atomically records reservations and uses the next eligible route only when the local cap prevents submission or a documented quota error proves the vendor rejected the request before acceptance. Do not use auto-retries, separate identities, or fallback to route around provider enforcement. Non-quota rejection is not a reason to resubmit the same message. An empty pool yields `NO_FREE_CAPACITY` with no paid route. No automatic late delivery tomorrow. Queue entries expire after 24 hours.
- Count accepted receipts separately from delivered messages. `UNKNOWN` (including 5xx, broken connection, unexpected response, or worker loss during submission) means **check the vendor dashboard before taking any action**. No automatic resend or cross-provider fallback for that message. Reserve and preserve local quota even if acceptance was uncertain. If a provider suspends, changes terms or flags an account, stop the pilot and investigate; do not route around the restriction. Do not restore an older queue/ledger over live data or resume workers after any restore until receipts, suppressions and consumed quota are independently reconciled.
- For live acceptance, send a single authorized email and SMS, separately, only after stage approval. Save timestamp, redacted job/receipt IDs, actual inbox/handset confirmation, verified DNS/delivery headers, and before/after provider and carrier billing evidence. Run the failover drill with intentionally tiny local caps, then prove opt-out and incident-stop behavior. Do not deliberately hit provider abuse/rate limits. Extend only after a reviewed stability period; keep signup approval on until that decision.
- Stop/rollback: stop the worker first (one bounded in-flight request may finish), revoke keys if needed, unset the pilot ID in both environments, then reload the panel with operator approval. Leave ledger and suppression data intact. Do not downgrade to UI that reports historical fake sends as true. Unsubscribe must remain reachable for email already delivered. Do not change public DNS, customer access or billing as a rollback shortcut.

## Reproduce locally (no provider traffic)

```sh
npm run db:generate
npx vitest run tests/signup-approval.test.ts tests/pilot-messaging.test.ts tests/free-for-dev-catalog.test.ts
npm run build && npm run build:worker
node scripts/smoke-pilot-messaging.mjs
```

The smoke test launches the packaged panel and actual worker with a disposable SQLite copy. Only the test process redirects fixed provider requests to separate loopback HTTP fixtures. All four contracts are tested without network sends. This is not a staged vendor receipt. The full evidence for the change is in [the pilot audit](audit/FREE-MESSAGING-PILOT-EVIDENCE-2026-11-18.md).

## Directory, not activation

`/dashboard/free-for-dev` keeps the community catalog plus the requested `jixserver/free-for-dev` branch snapshot: 463 names/links, 36 categories, pinned at `a6d2501c4d2566a3f518f08e51a23923edf65734`. Older prices and claims were not imported. It includes hosting, databases, monitoring, CI, DNS and non-messaging categories; browsing it does not connect, provision or establish that an entry is currently free or open source. `GET /api/free-for-dev?source=jixserver` selects the snapshot; the default remains the community catalog.
