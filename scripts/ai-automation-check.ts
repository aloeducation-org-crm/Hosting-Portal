#!/usr/bin/env node
/**
 * Operator check for the AI layer. Prints the resolved provider chain, runs the
 * read-only "single-domain triage" workflow against real panel data, and
 * optionally probes each provider with a live call.
 *
 *   npx tsx scripts/ai-automation-check.ts                 # config + local workflow (no AI needed)
 *   npx tsx scripts/ai-automation-check.ts --live          # also probe providers (network + quota)
 *   npx tsx scripts/ai-automation-check.ts --domain=x.test # check a specific domain
 *
 * No workflow run is persisted. Exits non-zero if the local workflow fails.
 */

import { resolveProviders, redactProvider } from "../src/lib/ai/providers";
import { probeProvider } from "../src/lib/ai/client";
import { runWorkflowGraph } from "../src/lib/ai/automation/engine";
import { HOSTING_TOOLS } from "../src/lib/ai/automation/tools";
import { completeWithAI } from "../src/lib/ai/client";
import { WORKFLOW_TEMPLATES } from "../src/lib/ai/automation/templates";

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const domain = args.find((arg) => arg.startsWith("--domain="))?.split("=")[1] ?? "example.com";

  const resolution = resolveProviders(process.env);
  console.log(`\nProvider chain (${resolution.providers.length}):`);
  for (const [index, provider] of resolution.providers.entries()) {
    const redacted = redactProvider(provider);
    console.log(
      `  ${index + 1}. ${redacted.id} [${redacted.tier}] ${redacted.baseUrl} model=${redacted.model}` +
        `${redacted.anonymous ? " (anonymous)" : ""}${redacted.baseUrlVerified ? "" : " (UNVERIFIED HOST)"}`,
    );
  }
  for (const skip of resolution.skipped) console.log(`  - skipped ${skip.id}: ${skip.reason}`);
  for (const warning of resolution.warnings) console.log(`  ! ${warning}`);

  if (!resolution.providers.length) {
    console.error("\nNo provider resolved: automations that call a model will return 503.");
  }

  if (live) {
    console.log("\nLive probes:");
    for (const provider of resolution.providers) {
      const probe = await probeProvider(provider);
      console.log(`  ${probe.ok ? "OK  " : "FAIL"} ${probe.providerLabel} (${probe.latencyMs}ms) ${probe.error ?? probe.model ?? ""}`);
    }
  }

  // Local, AI-free workflow against the real database: proves tools + engine wiring.
  const localGraph = {
    nodes: [
      { id: "start", type: "trigger" as const },
      { id: "overview", type: "hosting.automationOverview" as const },
      { id: "sites", type: "hosting.listSites" as const, config: { limit: 5 } },
      { id: "deploys", type: "hosting.listDeployments" as const, config: { limit: 5 } },
      { id: "health", type: "hosting.siteHealth" as const, config: { domain: "{{ input.domain }}" } },
      { id: "out", type: "output" as const, config: { value: "{{ steps.sites.output.count }}" } },
    ],
    edges: [
      { from: "start", to: "overview" },
      { from: "overview", to: "sites" },
      { from: "sites", to: "deploys" },
      { from: "deploys", to: "health" },
      { from: "health", to: "out" },
    ],
  };

  const local = await runWorkflowGraph(localGraph, { ai: completeWithAI, tools: HOSTING_TOOLS }, {
    input: { domain },
    actor: { userId: "cli-operator-check", isAdmin: true },
  });
  console.log(`\nLocal workflow (no model): ${local.status} in ${local.durationMs}ms`);
  for (const step of local.steps) {
    const detail = step.status === "succeeded" ? JSON.stringify(step.output).slice(0, 120) : step.error ?? step.skippedReason;
    console.log(`  ${step.status.padEnd(9)} ${step.nodeId.padEnd(8)} ${detail ?? ""}`);
  }
  if (local.status !== "succeeded") process.exitCode = 1;

  const template = WORKFLOW_TEMPLATES.find((entry) => entry.id === "site-inventory-digest");
  console.log(`\nTemplates available: ${WORKFLOW_TEMPLATES.map((entry) => entry.id).join(", ")}`);
  console.log(`To run "${template?.name}" with a model, use POST /api/ai/workflows/${template?.id}/run from the panel.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
