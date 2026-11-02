import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_AI_TOOL_CATALOG,
  EXTERNAL_AI_TOOL_POLICY,
  externalToolCatalogForAgent,
} from "@/lib/ai/external-tool-catalog";
import { HOSTING_TOOLS } from "@/lib/ai/automation/tools";
import { WORKFLOW_NODE_TYPES, parseGraph } from "@/lib/ai/automation/graph";
import { WORKFLOW_TEMPLATES } from "@/lib/ai/automation/templates";
import { runWorkflowGraph } from "@/lib/ai/automation/engine";

const EXPECTED_IDS = [
  "rea",
  "claude-plugins-official",
  "ruflo",
  "android-skills",
  "scientific-agent-skills",
  "opencode",
  "cli-anything",
  "cursor-plugins",
  "ai-memory",
  "voicestudio",
  "container",
  "treg",
  "wifi-password-cracker-pro",
] as const;

describe("external AI capability intake", () => {
  it("records every supplied reference with a unique review-only identifier", () => {
    expect(EXTERNAL_AI_TOOL_CATALOG.map((entry) => entry.id)).toEqual([...EXPECTED_IDS]);
    expect(new Set(EXTERNAL_AI_TOOL_CATALOG.map((entry) => entry.id)).size).toBe(EXPECTED_IDS.length);
    expect(EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "rea")?.suppliedLabel).toContain("Recreate Software Features");
    expect(EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "ai-memory")?.canonicalRef).toBe("https://github.com/akitaonrails/ai-memory");
    expect(EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "claude-plugins-official")?.canonicalRef).toBe("https://github.com/anthropics/claude-plugins-official");
    expect(EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "scientific-agent-skills")?.canonicalRef).toBe("https://github.com/K-Dense-AI/scientific-agent-skills");
    expect(EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "treg")?.suppliedRef).toBe("https://treg.to/");
  });

  it("keeps every record non-executable, pinned and safely represented as data", () => {
    for (const entry of EXTERNAL_AI_TOOL_CATALOG) {
      expect(entry.executable).toBe(false);
      expect(["DEFERRED", "EXCLUDED"]).toContain(entry.admissionState);
      expect(["REQUIRES_SETUP", "NOT_ADMISSIBLE"]).toContain(entry.executionState);
      expect(entry.gates.length).toBeGreaterThan(0);
      expect(entry.notes.length).toBeGreaterThan(10);
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.pinnedCommit).toMatch(/^[a-f0-9]{40}$/);
      for (const ref of [entry.suppliedRef, entry.canonicalRef]) {
        const url = new URL(ref);
        expect(url.protocol).toBe("https:");
        expect(url.username).toBe("");
        expect(url.password).toBe("");
        expect(url.search).toBe("");
        expect(url.hash).toBe("");
      }
    }
    const wifi = EXTERNAL_AI_TOOL_CATALOG.find((entry) => entry.id === "wifi-password-cracker-pro")!;
    expect(wifi.admissionState).toBe("EXCLUDED");
    expect(wifi.executionState).toBe("NOT_ADMISSIBLE");
    expect(wifi.candidateFeatures).toEqual([]);
  });

  it("returns a bounded prompt-safe catalogue with no execution authority", () => {
    const result = externalToolCatalogForAgent();
    expect(result.count).toBe(EXPECTED_IDS.length);
    expect(result.executionEnabled).toBe(false);
    expect(result.executionState).toBe("REQUIRES_SETUP");
    expect(result.policy).toBe(EXTERNAL_AI_TOOL_POLICY);
    expect(result.policy).toMatch(/review material only/i);
    expect(result.entries.every((entry) => entry.executable === false)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"executable":true');
  });

  it("exposes the catalogue only to an authenticated workflow actor", async () => {
    const tool = HOSTING_TOOLS.externalToolCatalog!;
    await expect(tool({}, { input: null })).rejects.toThrow(/Tenant context required/);
    const admin = await tool({}, { input: null, actor: { isAdmin: true } });
    expect(admin).toMatchObject({ count: EXPECTED_IDS.length, executionEnabled: false });
    const tenant = await tool({}, { input: null, actor: { userId: "tenant-1", isAdmin: false } });
    expect(tenant).toMatchObject({ count: EXPECTED_IDS.length, executionEnabled: false });
  });

  it("makes the read-only catalogue available as a workflow node and template", () => {
    expect(WORKFLOW_NODE_TYPES).toContain("hosting.externalToolCatalog");
    expect(() => parseGraph({
      nodes: [{ id: "start", type: "trigger" }, { id: "catalog", type: "hosting.externalToolCatalog" }],
      edges: [{ from: "start", to: "catalog" }],
    })).not.toThrow();
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === "external-ai-capability-review");
    expect(template).toBeTruthy();
    expect(template?.graph.nodes.some((node) => node.type === "hosting.externalToolCatalog")).toBe(true);
    expect(template?.description).toMatch(/never installs/i);
  });

  it("runs the catalogue node through the real read-only tool", async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: "start", type: "trigger" },
          { id: "catalog", type: "hosting.externalToolCatalog" },
          { id: "out", type: "output", config: { value: "{{ steps.catalog.output.count }}" } },
        ],
        edges: [
          { from: "start", to: "catalog" },
          { from: "catalog", to: "out" },
        ],
      },
      {
        ai: vi.fn(async () => ({ text: "", provider: "fixture", model: "fixture", tokensUsed: 0 })),
        tools: HOSTING_TOOLS,
      },
      { actor: { isAdmin: true } },
    );
    expect(result.status).toBe("succeeded");
    expect(String(result.output)).toBe(String(EXPECTED_IDS.length));
    expect(result.aiCalls).toBe(0);
  });
});
