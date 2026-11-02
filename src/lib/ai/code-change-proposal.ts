import { createHash } from "node:crypto";
import { z } from "zod";

/** Proposal admission ONLY. No file writes, shell execution or authorization. */
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const change = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), path: z.string().min(1).max(240), content: z.string().min(1).max(65536) }).strict(),
  z.object({ action: z.literal("update"), path: z.string().min(1).max(240), beforeSha256: hash, content: z.string().min(1).max(65536) }).strict(),
]);
const proposalSchema = z.object({
  projectId: z.string().min(1).max(128),
  baseCommit: sha,
  purpose: z.enum(["repair", "feature-reconstruction", "documentation"]),
  summary: z.string().trim().min(1).max(2000),
  changes: z.array(change).min(1).max(20),
  checks: z.array(z.enum(["lint", "typecheck", "test", "build"])).min(1).max(4),
}).strict();

export interface CodeChangeContext {
  /** All context must come from trusted server-side scope and snapshot lookup. */
  projectId: string;
  baseCommit: string;
  allowedPaths: readonly string[];
  /** Exact regular-file snapshot contents; null means verified absent. */
  snapshot: ReadonlyMap<string, string | null>;
}

export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function safePath(value: string): boolean {
  return !/[\s\x00-\x1f\x7f]/.test(value) && /^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

function protectedPath(value: string): boolean {
  return /(^|\/)(node_modules|vendor|secrets?|credentials?|deploy|agents?|orchestrator|security|rea)(\/|$)/i.test(value) ||
    /(^|\/)(auth|middleware|proxy|code-change-proposal|code-evolution|capability-requests|capability-http)([.-]|\/|$)/i.test(value) ||
    !/\.(ts|tsx|js|jsx|json|css|md|txt|py)$/.test(value) ||
    /(^|\/)(package(-lock)?\.json|.*lock.*|.*private.*|.*secret.*|.*credential.*)$/i.test(value);
}

/**
 * Validate untrusted model output against an explicitly scoped immutable
 * snapshot. Returned digest identifies a review artifact, NOT a permission.
 * A future isolated runner must recheck disk paths/symlinks and approval itself.
 */
export function prepareCodeChangeProposal(input: unknown, context: CodeChangeContext) {
  const proposal = proposalSchema.parse(input);
  if (proposal.projectId !== context.projectId || proposal.baseCommit !== context.baseCommit) {
    throw new Error("Project or base commit does not match the trusted scope.");
  }
  const seen = new Set<string>();
  let bytes = 0;
  for (const item of proposal.changes) {
    const key = item.path.toLowerCase();
    if (!safePath(item.path) || protectedPath(item.path) || !context.allowedPaths.includes(item.path)) {
      throw new Error("Change path is outside the permitted review scope.");
    }
    if (seen.has(key)) throw new Error("Duplicate or case-colliding change path.");
    seen.add(key);
    if (!context.snapshot.has(item.path)) throw new Error("Missing verified snapshot entry.");
    const existing = context.snapshot.get(item.path);
    if (item.action === "add" && existing !== null) throw new Error("An addition must not overwrite an existing file.");
    if (item.action === "update" && (typeof existing !== "string" || contentSha256(existing) !== item.beforeSha256)) {
      throw new Error("Update does not match the verified original content.");
    }
    if (!item.content.trim() || item.content.includes("\u0000")) throw new Error("Empty or binary replacement is not permitted.");
    bytes += Buffer.byteLength(item.content, "utf8");
  }
  if (bytes > 131072) throw new Error("Proposal exceeds the review size limit.");
  if (new Set(proposal.checks).size !== proposal.checks.length) throw new Error("Duplicate checks.");
  const canonical = { ...proposal, changes: [...proposal.changes].sort((a, b) => a.path.localeCompare(b.path, "en")), checks: [...proposal.checks].sort() };
  return {
    state: "REQUIRES_APPROVAL" as const,
    executable: false as const,
    digest: contentSha256(JSON.stringify(canonical)),
    proposal: canonical,
  };
}

/** Validate and copy a narrow source snapshot BEFORE any provider transmission. */
export function snapshotCodeChangeScope(context: CodeChangeContext): CodeChangeContext {
  z.object({ projectId: z.string().min(1).max(128), baseCommit: sha }).parse(context);
  if (!Array.isArray(context.allowedPaths) || context.allowedPaths.length < 1 || context.allowedPaths.length > 20) {
    throw new Error("Source scope requires 1–20 exact paths.");
  }
  const snapshot = new Map<string, string | null>();
  const keys = new Set<string>();
  let bytes = 0;
  for (const path of context.allowedPaths) {
    if (typeof path !== "string" || path.length > 240 || !safePath(path) || protectedPath(path) || keys.has(path.toLowerCase())) {
      throw new Error("Invalid, protected or duplicate source scope path.");
    }
    keys.add(path.toLowerCase());
    if (!context.snapshot.has(path)) throw new Error("Missing verified source snapshot.");
    const content = context.snapshot.get(path);
    if (content !== null && (typeof content !== "string" || content.includes("\u0000"))) throw new Error("Invalid source snapshot content.");
    bytes += typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0;
    snapshot.set(path, content);
  }
  if (bytes > 131072) throw new Error("Source snapshot exceeds the disclosure size limit.");
  return { projectId: context.projectId, baseCommit: context.baseCommit, allowedPaths: [...context.allowedPaths], snapshot };
}
