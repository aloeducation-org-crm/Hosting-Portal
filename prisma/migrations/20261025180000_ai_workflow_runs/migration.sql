-- AI automation server: run history for executed workflows.
CREATE TABLE "ai_workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "userId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'running',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "input" TEXT,
    "output" TEXT,
    "steps" TEXT,
    "error" TEXT,
    "providers" TEXT,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ai_workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ai_workflows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ai_workflow_runs_workflowId_idx" ON "ai_workflow_runs"("workflowId");
CREATE INDEX "ai_workflow_runs_status_idx" ON "ai_workflow_runs"("status");
CREATE INDEX "ai_workflow_runs_startedAt_idx" ON "ai_workflow_runs"("startedAt");
CREATE INDEX "ai_workflows_status_idx" ON "ai_workflows"("status");
