import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentSha256 } from "@/lib/ai/code-change-proposal";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", () => ({ completeJSON: generate }));
import { codeEvolutionSourceDigest, proposeCodeEvolution } from "@/lib/ai/code-evolution";

function fixture() {
  const scope = { projectId: "p", baseCommit: "a".repeat(40), allowedPaths: ["src/widget.ts"], snapshot: new Map<string, string | null>([["src/widget.ts", "original"]]) };
  const grant = { projectId: "p", baseCommit: scope.baseCommit, snapshotDigest: codeEvolutionSourceDigest(scope), providerId: "gateway", sourceDisclosureApproved: true as const, expiresAt: Date.now() + 60000 };
  const request = { instruction: "Repair widget", purpose: "repair" };
  const response = {
    data: { projectId: "p", baseCommit: scope.baseCommit, purpose: "repair", summary: "Proposed repair; tests not run", changes: [{ action: "update", path: "src/widget.ts", beforeSha256: contentSha256("original"), content: "proposed" }], checks: ["test"] },
    completion: { provider: "gateway", model: "local-model", requestId: "generation-1" },
  };
  generate.mockResolvedValue(response);
  return { scope, grant, request, response };
}
beforeEach(() => { generate.mockReset(); });

describe("own-agent provider-to-review proposal pipeline", () => {
  it("uses exactly the approved provider and returns no execution permission", async () => {
    const f = fixture(); const result = await proposeCodeEvolution(f.request, f.scope, f.grant);
    expect(result).toMatchObject({ state: "REQUIRES_APPROVAL", executable: false, executionState: "REQUIRES_SETUP", generation: f.response.completion });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toMatchObject({ onlyProviders: ["gateway"], retriesPerProvider: 0, maxTokens: 4096, timeoutMs: 30000 });
    expect(f.scope.snapshot.get("src/widget.ts")).toBe("original");
  });
  it.each([
    { sourceDisclosureApproved: false }, { expiresAt: 1 }, { projectId: "other" },
    { baseCommit: "b".repeat(40) }, { snapshotDigest: "b".repeat(64) }, { providerId: "" },
  ])("blocks missing/mismatched disclosure authority before any provider call %j", async (override) => {
    const f = fixture(); await expect(proposeCodeEvolution(f.request, f.scope, { ...f.grant, ...override } as never)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not disclose snapshot paths outside the explicit scope", async () => {
    const f = fixture(); f.scope.snapshot.set("src/unrelated.ts", "DO NOT DISCLOSE");
    await proposeCodeEvolution(f.request, f.scope, f.grant);
    expect(JSON.stringify(generate.mock.calls[0][0])).not.toContain("DO NOT DISCLOSE");
  });
  it("rejects protected source paths before transmission", async () => {
    const f = fixture(); f.scope.allowedPaths = ["src/security/policy.ts"]; f.scope.snapshot.set(f.scope.allowedPaths[0], "policy");
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant)).rejects.toThrow(); expect(generate).not.toHaveBeenCalled();
  });
  it("rejects invalid/oversized source scope before transmission", async () => {
    const f = fixture(); f.scope.snapshot.set("src/widget.ts", "ক".repeat(50000));
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant)).rejects.toThrow(); expect(generate).not.toHaveBeenCalled();
  });
  it("rejects added authority in the instruction envelope", async () => {
    const f = fixture(); await expect(proposeCodeEvolution({ ...f.request, command: "run shell" }, f.scope, f.grant)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
  it("validates returned model output instead of trusting claims of approval", async () => {
    const f = fixture(); generate.mockResolvedValue({ ...f.response, data: { ...f.response.data, approved: true } });
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant)).rejects.toThrow();
  });
  it("rejects a different purpose/provider", async () => {
    const f = fixture(); f.response.data.purpose = "feature-reconstruction";
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant)).rejects.toThrow("purpose");
    f.response.completion.provider = "unapproved";
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant)).rejects.toThrow("Unexpected provider");
  });
  it("fails on provider failure without repair loops", async () => {
    const f = fixture(); generate.mockRejectedValue(new Error("Provider unavailable"));
    const outcome = await proposeCodeEvolution(f.request, f.scope, f.grant).then(
      () => ({ failed: false, message: "" }),
      (error: Error) => ({ failed: true, message: error.message }),
    );
    expect(outcome).toEqual({ failed: true, message: "Provider unavailable" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("honours cancellation before and after generation", async () => {
    const f = fixture(); const cancelled = new AbortController(); cancelled.abort();
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant, cancelled.signal)).rejects.toThrow("cancelled"); expect(generate).not.toHaveBeenCalled();
    const during = new AbortController(); generate.mockImplementation(async () => { during.abort(); return f.response; });
    await expect(proposeCodeEvolution(f.request, f.scope, f.grant, during.signal)).rejects.toThrow("cancelled");
  });
  it("copies the trusted snapshot before awaiting model generation", async () => {
    const f = fixture(); generate.mockImplementation(async () => { f.scope.snapshot.set("src/widget.ts", "concurrent change"); f.scope.allowedPaths.length = 0; return f.response; });
    const result = await proposeCodeEvolution(f.request, f.scope, f.grant);
    expect(result.proposal.changes[0]).toMatchObject({ beforeSha256: contentSha256("original") });
    // Future application must independently recheck the real disk baseline.
  });
});
