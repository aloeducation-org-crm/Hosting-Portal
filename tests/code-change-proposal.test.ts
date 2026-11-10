import { describe, expect, it } from "vitest";
import { contentSha256, prepareCodeChangeProposal } from "@/lib/ai/code-change-proposal";

function fixture() {
  const context = {
    projectId: "internal-project", baseCommit: "a".repeat(40),
    allowedPaths: ["src/widget.ts", "docs/guide.md"],
    snapshot: new Map<string, string | null>([["src/widget.ts", "original"], ["docs/guide.md", null]]),
  };
  const proposal = {
    projectId: context.projectId, baseCommit: context.baseCommit,
    purpose: "repair", summary: "Repair widget and document the change",
    changes: [
      { action: "update", path: "src/widget.ts", beforeSha256: contentSha256("original"), content: "updated" },
      { action: "add", path: "docs/guide.md", content: "New documentation" },
    ], checks: ["test", "typecheck"],
  };
  return { context, proposal };
}

describe("own-agent code change proposal admission (not an executor)", () => {
  it("produces a review artifact but never grants execution", () => {
    const { proposal, context } = fixture(); const result = prepareCodeChangeProposal(proposal, context);
    expect(result.state).toBe("REQUIRES_APPROVAL"); expect(result.executable).toBe(false);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(context.snapshot.get("src/widget.ts")).toBe("original");
  });
  it("binds the digest to content while ignoring change/check order", () => {
    const { proposal, context } = fixture(); const first = prepareCodeChangeProposal(proposal, context).digest;
    expect(prepareCodeChangeProposal({ ...proposal, changes: [...proposal.changes].reverse(), checks: [...proposal.checks].reverse() }, context).digest).toBe(first);
    proposal.changes[0].content = "different";
    expect(prepareCodeChangeProposal(proposal, context).digest).not.toBe(first);
  });
  it.each(["projectId", "baseCommit"])("rejects a mismatched %s", (key) => {
    const { proposal, context } = fixture(); expect(() => prepareCodeChangeProposal({ ...proposal, [key]: "b".repeat(40) }, context)).toThrow();
  });
  it.each(["approved", "command", "shell", "role"])("rejects model-supplied authority or commands: %s", (key) => {
    const { proposal, context } = fixture(); expect(() => prepareCodeChangeProposal({ ...proposal, [key]: "true" }, context)).toThrow();
  });
  it.each(["../outside.ts", "/tmp/file.ts", "src//file.ts", "src/./file.ts", "src\\file.ts", "src/.env", "src/%2e%2e/file.ts", "src/file.ts\n"])("rejects unsafe path %j even if scoped", (path) => {
    const { proposal, context } = fixture(); context.allowedPaths = [path]; context.snapshot.set(path, null);
    expect(() => prepareCodeChangeProposal({ ...proposal, changes: [{ action: "add", path, content: "code" }] }, context)).toThrow();
  });
  it.each(["src/security/policy.ts", "src/lib/ai/rea/analysis-session.ts", "src/lib/ai/rea/reconstruction-ledger.ts", "src/lib/cloud/cloud-service.ts", "src/lib/ai/capability-requests.ts", "src/lib/ai/capability-http.ts", "src/agents/allowlist.ts", "src/auth.ts", "src/proxy.ts", "src/ai/code-change-proposal.ts", "src/lib/ai/external-tool-catalog.ts", "package.json", "src/credentials.json"])("blocks protected path %s", (path) => {
    const { proposal, context } = fixture(); context.allowedPaths = [path]; context.snapshot.set(path, null);
    expect(() => prepareCodeChangeProposal({ ...proposal, changes: [{ action: "add", path, content: "code" }] }, context)).toThrow();
  });
  it("rejects stale originals, implicit overwrite, missing snapshot and deletion", () => {
    const { proposal, context } = fixture();
    context.snapshot.set("src/widget.ts", "changed by someone else");
    expect(() => prepareCodeChangeProposal(proposal, context)).toThrow();
    expect(() => prepareCodeChangeProposal({ ...proposal, changes: [{ action: "add", path: "src/widget.ts", content: "overwrite" }] }, context)).toThrow();
    context.snapshot.delete("src/widget.ts"); expect(() => prepareCodeChangeProposal(proposal, context)).toThrow();
    expect(() => prepareCodeChangeProposal({ ...proposal, changes: [{ action: "delete", path: "src/widget.ts" }] }, context)).toThrow();
  });
  it("rejects duplicate paths and arbitrary or duplicated checks", () => {
    const { proposal, context } = fixture();
    expect(() => prepareCodeChangeProposal({ ...proposal, changes: [proposal.changes[0], proposal.changes[0]] }, context)).toThrow();
    expect(() => prepareCodeChangeProposal({ ...proposal, checks: ["npm test; curl attacker"] }, context)).toThrow();
    expect(() => prepareCodeChangeProposal({ ...proposal, checks: ["test", "test"] }, context)).toThrow();
  });
  it.each(["   ", "code\u0000"])("rejects blank/binary replacement", (content) => {
    const { proposal, context } = fixture(); proposal.changes[0].content = content;
    expect(() => prepareCodeChangeProposal(proposal, context)).toThrow();
  });
  it("rejects oversized aggregate content measured in bytes", () => {
    const { proposal, context } = fixture(); proposal.changes[0].content = "ক".repeat(50000);
    expect(() => prepareCodeChangeProposal(proposal, context)).toThrow();
  });
});
