import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentSha256 } from "@/lib/ai/code-change-proposal";
import { runAutonomousCodingTask, type AgentProposal, type AutonomousAgentDeps } from "@/lib/ai/autonomous-agent";

const generate = vi.hoisted(() => vi.fn());

function workspaceFixture(files: Record<string, string> = {}) {
  const root = path.join(tmpdir(), `agent-${Math.random().toString(36).slice(2)}`);
  return root;
}

async function writeFixture(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

function proposalFixture(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    summary: "Implement the requested change.",
    changes: [],
    checks: [],
    ...overrides,
  };
}

function deps(overrides: Partial<AutonomousAgentDeps> = {}): AutonomousAgentDeps {
  return {
    generate: generate,
    runCheck: vi.fn(async (kind: string) => ({ kind, passed: true, ran: true, detail: `${kind} passed` })),
    ...overrides,
  };
}

function task(root: string, allowedPaths: string[], snapshot: Record<string, string | null>, instruction = "Add the feature.") {
  return {
    instruction,
    workspaceRoot: root,
    providerId: "gateway",
    scope: {
      projectId: "p",
      baseCommit: "a".repeat(40),
      allowedPaths,
      snapshot,
    },
  };
}

const generation = (data: unknown) => ({ data, completion: { provider: "gateway", model: "local-model", requestId: "gen-1" } });

beforeEach(() => {
  generate.mockReset();
});

describe("autonomous coding agent", () => {
  it("generates, applies and verifies a scoped file update", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    const before = "export const v = 1;\n";
    generate.mockResolvedValue(
      generation({
        summary: "Changed the export value.",
        changes: [{ action: "update", path: "src/widget.ts", beforeSha256: contentSha256(before), content: "export const v = 2;\n" }],
        checks: ["test"],
      }),
    );

    const result = await runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": before }), deps());

    expect(result.ok).toBe(true);
    expect(result.code).toBe("OK");
    expect(result.applied).toEqual([{ path: "src/widget.ts", action: "update" }]);
    expect(await readFile(path.join(root, "src/widget.ts"), "utf8")).toBe("export const v = 2;\n");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ kind: "test", passed: true, ran: true });
    expect(result.generation).toMatchObject({ provider: "gateway", model: "local-model" });
    await rm(root, { recursive: true, force: true });
  });

  it("applies an addition of a new file", async () => {
    const root = workspaceFixture();
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "add", path: "src/new.ts", content: "export const x = 1;\n" }],
        checks: [],
      })),
    );
    const result = await runAutonomousCodingTask(task(root, ["src/new.ts"], { "src/new.ts": null }), deps());
    expect(result.ok).toBe(true);
    expect(result.applied).toEqual([{ path: "src/new.ts", action: "add" }]);
    expect(await readFile(path.join(root, "src/new.ts"), "utf8")).toBe("export const x = 1;\n");
    await rm(root, { recursive: true, force: true });
  });

  it("returns NO_CHANGES_NEEDED when the model proposes no changes", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    generate.mockResolvedValue(generation(proposalFixture()));
    const result = await runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps());
    expect(result.code).toBe("NO_CHANGES_NEEDED");
    expect(result.ok).toBe(true);
    expect(result.applied).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a change path outside the granted scope before any write", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n", "src/other.ts": "export const o = 1;\n" });
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "update", path: "src/other.ts", beforeSha256: contentSha256("export const o = 1;\n"), content: "export const o = 9;\n" }],
        checks: [],
      })),
    );
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps()),
    ).rejects.toThrow("outside the permitted scope");
    expect(await readFile(path.join(root, "src/other.ts"), "utf8")).toBe("export const o = 1;\n");
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a protected path even if it is in scope", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/security/policy.ts": "export const p = 1;\n" });
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "update", path: "src/security/policy.ts", beforeSha256: contentSha256("export const p = 1;\n"), content: "export const p = 9;\n" }],
        checks: [],
      })),
    );
    await expect(
      runAutonomousCodingTask(task(root, ["src/security/policy.ts"], { "src/security/policy.ts": "export const p = 1;\n" }), deps()),
    ).rejects.toThrow("protected or unsafe");
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to overwrite a file whose content drifted from the snapshot", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 2;\n" });
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "update", path: "src/widget.ts", beforeSha256: contentSha256("export const v = 1;\n"), content: "export const v = 3;\n" }],
        checks: [],
      })),
    );
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps()),
    ).rejects.toThrow("File changed since the snapshot");
    expect(await readFile(path.join(root, "src/widget.ts"), "utf8")).toBe("export const v = 2;\n");
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a path that escapes the workspace root via traversal", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "add", path: "../escape.ts", content: "export const e = 1;\n" }],
        checks: [],
      })),
    );
    // safePath already rejects "..", so validation throws before any write.
    await expect(
      runAutonomousCodingTask(task(root, ["../escape.ts"], { "../escape.ts": null }), deps()),
    ).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("reports CHECKS_FAILED honestly when a check does not pass", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    const before = "export const v = 1;\n";
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "update", path: "src/widget.ts", beforeSha256: contentSha256(before), content: "export const v = 2;\n" }],
        checks: ["test", "build"],
      })),
    );
    const runCheck = vi.fn(async (kind: string) =>
      kind === "test" ? { kind, passed: true, ran: true, detail: "test passed" } : { kind, passed: false, ran: true, detail: "build failed" },
    );
    const result = await runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": before }), deps({ runCheck }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CHECKS_FAILED");
    expect(result.verified).toBe(false);
    expect(result.checks.find((c) => c.kind === "build")).toMatchObject({ passed: false, ran: true });
    expect(result.warnings?.some((w) => w.includes("build"))).toBe(true);
    // The change was still applied — only the verification is honest about failing.
    expect(result.applied).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it("never claims a check passed that did not run", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    const before = "export const v = 1;\n";
    generate.mockResolvedValue(
      generation(proposalFixture({
        changes: [{ action: "update", path: "src/widget.ts", beforeSha256: contentSha256(before), content: "export const v = 2;\n" }],
        checks: ["test"],
      })),
    );
    const runCheck = vi.fn(async () => {
      throw new Error("runner unavailable");
    });
    const result = await runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": before }), deps({ runCheck }));
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ kind: "test", passed: false, ran: false });
    await rm(root, { recursive: true, force: true });
  });

  it("rejects unapproved provider output", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    generate.mockResolvedValue({ data: proposalFixture(), completion: { provider: "unapproved", model: "m", requestId: "r" } });
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps()),
    ).rejects.toThrow("Unexpected provider");
    await rm(root, { recursive: true, force: true });
  });

  it("rejects invalid/oversized model output instead of inventing data", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    generate.mockResolvedValue(generation({ summary: "x", changes: "nope", checks: [] }));
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps()),
    ).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("honours cancellation before and during generation", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps(), cancelled.signal),
    ).rejects.toThrow("cancelled");

    const during = new AbortController();
    generate.mockImplementation(async () => {
      during.abort();
      return generation(proposalFixture());
    });
    await expect(
      runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }), deps(), during.signal),
    ).rejects.toThrow("cancelled");
    await rm(root, { recursive: true, force: true });
  });

  it("sends the task and scope to the model, scoped to the chosen provider", async () => {
    const root = workspaceFixture();
    await writeFixture(root, { "src/widget.ts": "export const v = 1;\n" });
    generate.mockResolvedValue(generation(proposalFixture()));
    await runAutonomousCodingTask(task(root, ["src/widget.ts"], { "src/widget.ts": "export const v = 1;\n" }, "Repair the widget."), deps());
    expect(generate).toHaveBeenCalledTimes(1);
    const [messages, options] = generate.mock.calls[0];
    expect(JSON.parse(messages[1].content)).toMatchObject({ task: { instruction: "Repair the widget." } });
    expect(options).toMatchObject({ onlyProviders: ["gateway"], retriesPerProvider: 0 });
    await rm(root, { recursive: true, force: true });
  });
});
