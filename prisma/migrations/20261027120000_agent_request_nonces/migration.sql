-- Agent request replay prevention.
--
-- `verifySignature()` already rejected timestamps outside a ±5 minute window,
-- but the nonce was only checked for length. A captured request could therefore
-- be replayed, unchanged, for the rest of that window — which on
-- /api/agents/tasks/result means a forged "task succeeded".
--
-- One row per (agent, nonce) consumed. The unique index is what makes the
-- check atomic: two concurrent replays race on the insert and exactly one wins.
-- Rows are kept only as long as the signature window they belong to, then
-- pruned, so the table cannot grow without bound.
--
-- Additive: no DROP, no DELETE, no data rewrite.

CREATE TABLE IF NOT EXISTS "agent_nonces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_nonces_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "server_agents" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_nonces_agentId_nonce_key" ON "agent_nonces"("agentId", "nonce");
CREATE INDEX IF NOT EXISTS "agent_nonces_expiresAt_idx" ON "agent_nonces"("expiresAt");

-- Approval expiry for gated agent tasks: a NULLable timestamp, so existing rows
-- keep their meaning and nothing is rewritten.
ALTER TABLE "agent_tasks" ADD COLUMN "approvedAt" DATETIME;
