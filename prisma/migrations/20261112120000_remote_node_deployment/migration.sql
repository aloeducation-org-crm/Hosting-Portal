-- Remote node deployment: pin the enrolled compute node (ServerAgent) a
-- GitProject is deployed to. Purely additive, nullable, no default.
ALTER TABLE "git_projects" ADD COLUMN "agentId" TEXT;
CREATE INDEX IF NOT EXISTS "git_projects_agent_id_idx" ON "git_projects"("agentId");
