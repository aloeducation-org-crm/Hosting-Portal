CREATE TABLE IF NOT EXISTS "pilot_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "consentRef" TEXT NOT NULL,
    "consentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suppressedAt" DATETIME,
    "unsubscribeHash" TEXT,
    "unsubscribeSecret" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_recipients_unsubscribeHash_key" ON "pilot_recipients"("unsubscribeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_recipients_ownerId_channel_address_key" ON "pilot_recipients"("ownerId", "channel", "address");

CREATE TABLE IF NOT EXISTS "pilot_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "smsText" TEXT,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pilot_messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "pilot_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pilot_messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_messages_ownerId_requestKey_key" ON "pilot_messages"("ownerId", "requestKey");
CREATE INDEX IF NOT EXISTS "pilot_messages_ownerId_channel_createdAt_idx" ON "pilot_messages"("ownerId", "channel", "createdAt");
CREATE INDEX IF NOT EXISTS "pilot_messages_ownerId_state_createdAt_idx" ON "pilot_messages"("ownerId", "state", "createdAt");
CREATE INDEX IF NOT EXISTS "pilot_messages_state_updatedAt_idx" ON "pilot_messages"("state", "updatedAt");
CREATE INDEX IF NOT EXISTS "pilot_messages_campaignId_state_idx" ON "pilot_messages"("campaignId", "state");

CREATE TABLE IF NOT EXISTS "pilot_messaging_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'STARTED',
    "remoteId" TEXT,
    "httpStatus" INTEGER,
    "blockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "pilot_messaging_attempts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "pilot_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_messaging_attempts_messageId_provider_key" ON "pilot_messaging_attempts"("messageId", "provider");
CREATE INDEX IF NOT EXISTS "pilot_messaging_attempts_provider_createdAt_idx" ON "pilot_messaging_attempts"("provider", "createdAt");
CREATE INDEX IF NOT EXISTS "pilot_messaging_attempts_provider_blockedUntil_idx" ON "pilot_messaging_attempts"("provider", "blockedUntil");
