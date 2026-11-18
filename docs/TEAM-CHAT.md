# Self-hosted Team Chat

`/dashboard/communications` is a first-party communications module for company
workspaces. It does not embed or claim to be MirrorFly. MirrorFly does not offer
a reusable free service; this module implements an independently owned,
self-hosted chat foundation inside the Hosting Portal.

## Implemented

- Tenant-scoped direct and named group conversations.
- Participant-only conversation and message reads, including for platform
  administrators. Admin status alone does not expose a private conversation.
- Company-member invite validation, with inactive and locked users excluded.
- Idempotent direct-message creation through a stable unique participant key.
- Stored text messages, newest-first cursor pagination, message search, unread
  counts, and explicit read-through receipts.
- Five-second authenticated polling in the dashboard UI. Polling is used
  deliberately; there is no unverified WebSocket or realtime-infrastructure
  claim.
- Per-user message rate limit of 60 writes per minute in addition to the proxy
  limits.
- Audit events for conversation creation, message sends, and read state changes.
  Message bodies are not copied into audit metadata.
- App Center registration under the Communication category and a Team Chat
  sidebar entry.

Not implemented in this increment: attachments, reactions, message editing,
push notifications, WebRTC voice/video, live streaming, end-to-end encryption,
or external federation. Camera, microphone, and geolocation remain blocked by
the portal's `Permissions-Policy`; no security header was weakened for text
chat.

## Data model

Migration `20261111120000_self_hosted_team_chat` is additive and registered in
`scripts/apply-deploy-schema.mjs`.

| Table | Purpose |
| --- | --- |
| `chat_conversations` | Company-scoped DIRECT/GROUP room, optional group name, unique direct key, and last-message ordering timestamp. |
| `chat_participants` | Unique room/user membership, owner/member role, mute placeholder, join time, and last-read timestamp. |
| `chat_messages` | Text body, optional sender reference, typed-message foundation, and creation/edit timestamps. |

All three tables use foreign keys with tenant or conversation cascade behavior.
A deleted user is removed as a participant, while the sender reference on
existing messages becomes null so conversation history can remain attributable
as “Former member.”

## API

Every route requires `requireSession` and returns `private, no-store` reads.

| Route | Methods | Access |
| --- | --- | --- |
| `/api/communications/members?organizationId=` | GET | Users who can view the company; returns active invite candidates. |
| `/api/communications/conversations?organizationId=` | GET, POST | GET returns only rooms containing the caller. POST requires company access and validates every invitee. |
| `/api/communications/messages?conversationId=` | GET, POST | Room participants only. GET supports `q`, `cursor`, and bounded `limit`; POST validates 1–4000 characters. |
| `/api/communications/conversations/[id]/read` | PATCH | Room participants only; requires `messageId` and advances read state only through that exact displayed message. |

Direct and group room creation always includes the caller. A direct room must
have exactly one other participant. A group must have a name and at least one
other participant. The API does not reveal whether an inaccessible private room
exists.

## Verification

`tests/communications.test.ts` imports the isolated database helper first and
covers the additive migration contract, schema parity, authentication, tenant
boundaries, member validation, direct-message deduplication, group validation,
message send/search/read behavior, unread counts, participant privacy, and
redacted audit metadata.
