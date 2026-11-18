import { createHash } from "node:crypto";
import { z } from "zod";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { validateRepositoryName } from "@/lib/deploy/github";
import { WorkerError } from "@/lib/orchestrator/contracts";
import { SHA1, STATIC_LIMITS, staticAssetType, validStaticBranch } from "./static-config";

const sha = z.string().regex(SHA1);
const repoSchema = z.object({ full_name: z.string(), private: z.literal(false), default_branch: z.string().min(1).max(250) });
const commitSchema = z.object({ sha, tree: z.object({ sha }) });
const treeSchema = z.object({ sha, truncated: z.literal(false), tree: z.array(z.object({
  path: z.string(), type: z.string(), mode: z.string(), sha, size: z.number().int().nonnegative().optional(),
})).max(3000) });
const blobSchema = z.object({ sha, encoding: z.literal("base64"), content: z.string(), size: z.number().int().nonnegative() });

async function publicGitHub<T>(resource: string, schema: z.ZodType<T>, maxBytes: number, signal: AbortSignal): Promise<T> {
  // Deliberately no platform token, credentials, arbitrary upstream or redirect.
  const res = await fetch(`https://api.github.com${resource}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  }).catch((error) => {
    signal.throwIfAborted();
    if (error instanceof WorkerError) throw error;
    throw new WorkerError("GITHUB_UNAVAILABLE", "Could not reach the public GitHub API. Try again later.");
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
      throw new WorkerError("GITHUB_RATE_LIMITED", "GitHub's public API limit was reached. An operator can retry after the limit resets.", false);
    }
    if (res.status >= 500) throw new WorkerError("GITHUB_UNAVAILABLE", "The public GitHub API is temporarily unavailable.");
    throw new WorkerError("NOT_FOUND", "The public GitHub repository or branch could not be read.", false);
  }
  const reader = res.body?.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new WorkerError("VALIDATION_FAILED", "GitHub source exceeds the static hosting size limit.", false);
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { await reader?.cancel().catch(() => {}); }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")));
  } catch {
    throw new WorkerError("VALIDATION_FAILED", "GitHub did not return a complete supported public Git source.", false);
  }
}

export type StaticSourcePin = { commitSha: string; treeSha: string; sourceBranch: string };

function repoPath(repository: string) {
  return `/repos/${validateRepositoryName(repository)}`;
}

export async function pinStaticSource(repository: string, requestedRef: string | null, signal: AbortSignal): Promise<StaticSourcePin> {
  const apiPath = repoPath(repository);
  const repo = await publicGitHub(apiPath, repoSchema, 128 * 1024, signal);
  if (repo.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new WorkerError("VALIDATION_FAILED", "Use the GitHub repository's current owner and name.", false);
  }
  const sourceBranch = requestedRef ?? repo.default_branch;
  if (!validStaticBranch(sourceBranch)) throw new WorkerError("VALIDATION_FAILED", "The GitHub branch name is not supported.", false);
  // /git/ref/heads pins a branch, not a same-named tag. GitHub's commit
  // metadata endpoint resolves the tree of that exact, immutable commit.
  const ref = await publicGitHub(`${apiPath}/git/ref/heads/${sourceBranch.split("/").map(encodeURIComponent).join("/")}`,
    z.object({ ref: z.string(), object: z.object({ type: z.literal("commit"), sha }) }), 16 * 1024, signal);
  if (ref.ref !== `refs/heads/${sourceBranch}`) throw new WorkerError("VALIDATION_FAILED", "GitHub returned a different branch.", false);
  const commit = await publicGitHub(`${apiPath}/git/commits/${ref.object.sha}`, commitSchema, 128 * 1024, signal);
  if (commit.sha !== ref.object.sha) throw new WorkerError("VALIDATION_FAILED", "GitHub returned a different commit.", false);
  return { sourceBranch, commitSha: commit.sha, treeSha: commit.tree.sha };
}

type TreeEntry = z.infer<typeof treeSchema>["tree"][number];
export type StaticAsset = { path: string; sha: string; size: number };
const buildManifest = /(?:^|\/)(?:package\.json|Dockerfile(?:\.[^/]+)?|(?:docker-)?compose\.ya?ml|composer\.json|requirements\.txt|pyproject\.toml|Pipfile|Gemfile|go\.mod|Cargo\.toml|pom\.xml|\.gitmodules)$/i;

export async function selectStaticAssets(tree: TreeEntry[]): Promise<StaticAsset[]> {
  if (tree.some((entry) => entry.type === "commit" || buildManifest.test(entry.path))) {
    throw new WorkerError("VALIDATION_FAILED", "This repository requires a build, runtime, or submodule. This hosting product accepts build-free HTML sites only.", false);
  }
  // Only an explicit public asset allowlist reaches the edge. Non-publishable
  // files (including dotfiles, configuration and Git metadata) are never read.
  const assets: StaticAsset[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of tree) {
    if (entry.type === "tree" || !staticAssetType(entry.path)) continue;
    if (entry.type !== "blob" || entry.mode !== "100644" || entry.size === undefined) {
      throw new WorkerError("VALIDATION_FAILED", "Static assets must be regular, non-executable Git files; symlinks are not supported.", false);
    }
    if (seen.has(entry.path.toLowerCase())) throw new WorkerError("VALIDATION_FAILED", "Static asset paths collide.", false);
    seen.add(entry.path.toLowerCase());
    total += entry.size;
    if (entry.size > STATIC_LIMITS.fileBytes || total > STATIC_LIMITS.releaseBytes || assets.length >= STATIC_LIMITS.files) {
      throw new WorkerError("VALIDATION_FAILED", "This site exceeds the static file count or size limit.", false);
    }
    assets.push({ path: entry.path, size: entry.size, sha: entry.sha });
  }
  const index = assets.find((asset) => asset.path === "index.html" && asset.size > 0);
  const detection = await detectFramework(memoryReader(Object.fromEntries(assets.map((asset) => [asset.path, ""]))));
  if (!index || detection.framework !== "static-html" || detection.ambiguous) {
    throw new WorkerError("VALIDATION_FAILED", "A build-free site needs a non-empty index.html at the repository root.", false);
  }
  return assets;
}

export async function listStaticAssets(repository: string, treeSha: string, signal: AbortSignal): Promise<StaticAsset[]> {
  if (!SHA1.test(treeSha)) throw new WorkerError("VALIDATION_FAILED", "The pinned Git tree is invalid.", false);
  const tree = await publicGitHub(`${repoPath(repository)}/git/trees/${treeSha}?recursive=1`, treeSchema, 1024 ** 2, signal);
  if (tree.sha !== treeSha) throw new WorkerError("VALIDATION_FAILED", "GitHub returned a different tree.", false);
  return selectStaticAssets(tree.tree);
}

export async function readStaticAsset(repository: string, asset: StaticAsset, signal: AbortSignal): Promise<Buffer> {
  const blob = await publicGitHub(`${repoPath(repository)}/git/blobs/${asset.sha}`, blobSchema,
    Math.ceil(asset.size * 1.5) + 4096, signal);
  const bytes = Buffer.from(blob.content, "base64");
  const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob.size !== asset.size || bytes.length !== asset.size || blob.sha !== asset.sha || hash !== asset.sha) {
    throw new WorkerError("VERIFICATION_REQUIRED", "A GitHub asset did not match its pinned Git blob hash.", false);
  }
  if (bytes.subarray(0, 64).toString().startsWith("version https://git-lfs.github.com/spec/v1\n")) {
    throw new WorkerError("VALIDATION_FAILED", "Git LFS assets are not supported on the static plan.", false);
  }
  return bytes;
}
