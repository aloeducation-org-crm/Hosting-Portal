-- Remote node deployment: pin the enrolled compute node (ServerAgent) a
-- GitProject is deployed to, and record which node executed each Deployment
-- row so node reassignment triggers a fresh deployment rather than reusing an
-- earlier node's verified state. Purely additive, nullable, no default.
ALTER TABLE "git_projects" ADD COLUMN "agentId" TEXT;
CREATE INDEX IF NOT EXISTS "git_projects_agent_id_idx" ON "git_projects"("agentId");
ALTER TABLE "deployments" ADD COLUMN "executedByAgentId" TEXT;

