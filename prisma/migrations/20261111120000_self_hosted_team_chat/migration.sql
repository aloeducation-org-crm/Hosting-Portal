-- Self-hosted tenant chat with direct and group conversations.
-- Access is enforced through chat_participants and organization membership.
-- This migration is additive and idempotent for the deploy schema applier.

CREATE TABLE IF NOT EXISTS "chat_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GROUP',
    "name" TEXT,
    "directKey" TEXT,
    "createdById" TEXT,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_directKey_key" ON "chat_conversations"("directKey");

CREATE INDEX IF NOT EXISTS "chat_conversations_organizationId_lastMessageAt_idx" ON "chat_conversations"("organizationId", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "chat_conversations_createdById_idx" ON "chat_conversations"("createdById");

CREATE TABLE IF NOT EXISTS "chat_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" DATETIME,
    CONSTRAINT "chat_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_conversationId_userId_key" ON "chat_participants"("conversationId", "userId");

CREATE INDEX IF NOT EXISTS "chat_participants_userId_idx" ON "chat_participants"("userId");

CREATE INDEX IF NOT EXISTS "chat_participants_conversationId_idx" ON "chat_participants"("conversationId");

CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "chat_messages_senderId_idx" ON "chat_messages"("senderId");
