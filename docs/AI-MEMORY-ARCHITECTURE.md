# AI Memory Architecture

**Status: PLANNED — NOT IMPLEMENTED.** Nothing in this document exists in code.
It is a design that has been checked against what the repository actually
contains today, so that implementation extends the existing architecture instead
of replacing it.

---

## 1. What exists today (verified by inspection)

| Present | Where |
| --- | --- |
| Conversation and message persistence | `AIConversation` (schema line ~1789), `AIMessage` (~1807) |
| Provider abstraction and routing | `src/lib/ai/providers.ts`, `src/lib/ai/client.ts` |
| Tool/automation layer with an allowlist | `src/lib/ai/automation/` |
| Durable job orchestration | `src/lib/orchestrator/` |
| Audit logging | `src/lib/audit.ts` |
| Encryption at rest for secrets | `src/lib/encryption.ts` |

| Absent | Consequence |
| --- | --- |
| Episodic, verified-fact, semantic or operational memory | The assistant cannot recall a decision, a corrected fact, a document, or an unfinished task across conversations |
| Provenance, confidence, correction history | A model-generated guess is indistinguishable from a fact an operator confirmed |
| Retrieval with permissions, recency and token budgeting | Context is either absent or an uncontrolled dump |
| Retention and deletion controls | No way to honour "forget this" |
| Memory-specific injection defence | Text retrieved from a document or transcript can carry instructions |

Do not describe any of the absent rows as a gap that is "almost done". It is not
started.

---

## 2. Design principles

1. **Memory is data with provenance, not prompt text.** Every record carries
   source, timestamp, tenant, confidence and an access rule. Retrieval returns
   records; the prompt assembler decides what to render.
2. **Verified facts are separated from model output.** A fact only becomes
   `VERIFIED` when a named human confirms it, or when it is read from a system of
   record (a database row, an audit log, an API response). Model-generated
   summaries are stored as `INFERRED` and may never be promoted automatically.
3. **Retrieved text is never an instruction.** Content from documents,
   transcripts, tool output and stored memories is wrapped and labelled as data.
   It cannot raise a risk level, grant a scope, approve a job, or change a
   security policy — those are enforced by deterministic code in the
   orchestrator and the agent allowlist, which already refuse caller-supplied
   risk downgrades.
4. **Tenant isolation is a query property, not a filter applied later.** Every
   retrieval takes a tenant/actor scope and the database enforces it.
5. **Bounded context.** A token budget per category, with recency and relevance
   deciding what fills it. If the budget is exhausted, less is retrieved — the
   budget is never silently exceeded.
6. **Deletable.** Retention per category, explicit deletion, and cascade into any
   derived index.
7. **Auditable.** Creating, correcting, verifying and deleting a memory writes an
   audit row through the existing `createAuditLog`.

---

## 3. Categories

| Category | Contents | Written by | Retention (default) | Confidence |
| --- | --- | --- | --- | --- |
| **Conversation history** | Messages and transcripts | existing `AIConversation` / `AIMessage` | configurable, e.g. 90 days | n/a |
| **Episodic memory** | Notable interactions, decisions, incidents, outcomes | extraction job, human-confirmed | 12 months | `INFERRED` → `VERIFIED` on confirmation |
| **Verified facts** | Customer/business facts: contact details, contract terms, preferred contact window, environment specifics | human confirmation **or** a system of record | until corrected or deleted | carries `source`, `observedAt`, `confidence`, `correctionHistory` |
| **Semantic memory** | Searchable knowledge from approved documents and business content | ingest job over approved sources only | tied to the source document | `VERIFIED` when the source is approved |
| **Operational memory** | Preferences, workflow state, unresolved tasks, prior decisions relevant to a task | orchestrator + assistant, human-visible | until resolved | mixed, labelled per record |

A contradiction does not overwrite silently: the new record is stored, the old
one is marked superseded with a reason, and both remain visible in the correction
history. Which one retrieval prefers is an explicit rule (recency + confidence +
source authority), not an accident of insert order.

---

## 4. Data model (proposed, additive)

New Prisma models, additive migration only — no change to `AIConversation` or
`AIMessage`, so existing records and features are untouched:

```
MemoryRecord   id, tenantId, ownerId?, category, subjectKey, content,
               contentType, confidence, status (ACTIVE|SUPERSEDED|DELETED),
               sourceType (HUMAN|SYSTEM_OF_RECORD|MODEL|DOCUMENT),
               sourceRef, observedAt, expiresAt?, createdBy, verifiedBy?,
               verifiedAt?, supersededBy?, createdAt, updatedAt
MemoryLink     id, fromRecordId, toRecordId, relation
               (SUPPORTS|CONTRADICTS|SUPERSEDES|DERIVED_FROM)
MemoryRevision id, recordId, previousContent, changeReason, actorId, createdAt
MemoryIndex    id, recordId, embeddingRef, model, dimensions, indexedAt
```

`tenantId` is part of every unique index and every query filter. `content` that
may hold personal data is minimized at write time and passes through the existing
`redact()` before storage, so a credential can never be persisted as a "fact".

Embeddings must be produced by a locally hosted model (see
`MULTILINGUAL-VOICE-EVALUATION.md` §Local inference for the same constraint
applied to speech). A paid external embedding API may be offered as an option,
disabled by default, and core operation must not require it.

---

## 5. Retrieval

```
task + actor + tenant
  → category filters allowed for this task and this actor's role
  → candidate recall (keyword + vector, per category)
  → permission filter (tenant, owner, role, sensitivity label)
  → ranking: relevance × recency × confidence × source authority
  → per-category token budget, then a global budget
  → rendered as labelled data blocks with provenance
```

Rules that are enforced in code, not in the prompt:

- a record whose `status` is not `ACTIVE` is never retrieved;
- an `INFERRED` record is rendered with its confidence and may not be used to
  justify a privileged or destructive action;
- a record from another tenant is unreachable, and a test asserts that a query
  scoped to tenant A returns nothing from tenant B even when B's content is a
  better lexical match;
- the assembled context always states which records it used, so an answer can be
  traced to its sources.

---

## 6. Prompt-injection defence

Retrieved memory, documents and transcripts are untrusted input.

1. **Structural separation.** Retrieved content is passed in a clearly delimited
   data section, never concatenated into the instruction section.
2. **No capability from text.** Risk level, scopes, approvals and allowlists come
   from the worker definition and the agent allowlist. The orchestrator already
   refuses a caller-supplied risk downgrade; memory retrieval is just another
   caller.
3. **Sanitization on ingest and on render.** Instruction-shaped patterns ("ignore
   previous instructions", role markers, tool-call syntax) are flagged, the record
   is labelled `SUSPECT`, and it is excluded from privileged contexts.
4. **Human in the loop for anything consequential.** A memory can *suggest* an
   action; only a named human can approve a privileged or destructive one.
5. **Tests required before this is called implemented:** a stored memory
   containing an instruction must not change the assistant's action class; a
   document containing a fake approval must not mark a job approved; a
   cross-tenant record must not be retrievable; a superseded fact must not be
   presented as current.

---

## 7. User-facing controls

- View the memories held about them, with source and timestamp.
- Correct a fact (creates a revision, marks the old record superseded).
- Delete a memory (soft delete with retention window, then hard delete and index
  removal).
- Export, subject to the existing authorization rules.
- See when an answer used memory and which records.

---

## 8. Restart safety

Memory writes are ordinary database rows, so a service or worker restart cannot
lose them. Extraction and indexing run as orchestrator jobs, which means they get
leases, retries with backoff, dead-lettering and an audit trail for free — an
interrupted indexing job is recovered by `recoverAbandoned()`, not re-run blind.
Idempotency keys make a repeated extraction request a no-op.

---

## 9. Implementation order (each step separately reviewable and tested)

1. Additive schema + `MemoryRecord` CRUD with tenant scoping and audit rows.
2. Retrieval with permission filter, ranking and token budget (no embeddings yet:
   keyword + recency + confidence).
3. Verified-fact confirmation flow in the UI, with correction history.
4. Contradiction handling (`CONTRADICTS` links, supersede rule, tests).
5. Retention and deletion, including cascade.
6. Local embedding model + vector recall, behind a feature flag.
7. Document ingest for approved sources only.
8. Injection-defence test suite, then enable memory in privileged contexts.

Do not enable step 8's context before its tests pass.
