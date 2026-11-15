-- AI workflow engine: causal trace ids + crash-resilient resumable runs.
--
-- traceId threads through every step of a run for cross-service correlation
-- (logs, audit trail, agent tasks). Indexed for lookup-by-trace so a run can
-- be found from a log line without knowing the runId. Resumability reuses the
-- existing `steps` column (already a JSON blob of StepResult[]); no new column
-- is needed for that — the runner flushes steps incrementally and the engine
-- re-loads succeeded steps on resume.

ALTER TABLE "ai_workflow_runs" ADD COLUMN "traceId" TEXT;

CREATE INDEX IF NOT EXISTS "ai_workflow_runs_traceId_idx" ON "ai_workflow_runs"("traceId");
