/**
 * Release identity: what commit is actually running.
 *
 * A health endpoint that only says "database connected" cannot distinguish the
 * intended release from the previous one, from a half-built tree, or from a
 * process that never restarted. The deployment writes this record next to the
 * running application and `/api/health` reports it back, so the deploy step can
 * prove the release it activated is the release that is serving — and so an
 * operator can answer "what is live right now?" from the outside.
 *
 * The file is generated at deploy time, never committed, and contains no
 * secrets: a commit SHA, checksums, timestamps and the deployment mode.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RELEASE_IDENTITY_FILE = "release-identity.json";

export interface ReleaseIdentity {
  /** Full 40-character commit SHA this release was built from. */
  commitSha: string;
  /** Which deployment path produced it. */
  mode: "canonical" | "inline";
  /** sha256 of the CI artifact archive the release was promoted from, when known. */
  artifactSha256: string | null;
  /** Per-file checksums of the promoted build output, when known. */
  files?: Record<string, string>;
  activatedAt: string;
  /** Unique per activation, so a repeated SHA still shows a fresh restart. */
  deploymentId: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Absolute path of the identity file for a release root. */
export function releaseIdentityPath(root: string): string {
  return path.join(root, RELEASE_IDENTITY_FILE);
}

/**
 * Read and validate the identity record.
 * Returns null when the file is absent or malformed — an unknown release must be
 * reported as unknown, never as a guessed SHA.
 */
export function readReleaseIdentity(root: string = process.cwd()): ReleaseIdentity | null {
  let raw: string;
  try {
    raw = readFileSync(releaseIdentityPath(root), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseIdentity>;
    if (typeof parsed.commitSha !== "string" || !SHA_PATTERN.test(parsed.commitSha)) return null;
    if (parsed.mode !== "canonical" && parsed.mode !== "inline") return null;
    if (typeof parsed.activatedAt !== "string" || Number.isNaN(Date.parse(parsed.activatedAt))) return null;
    return {
      commitSha: parsed.commitSha,
      mode: parsed.mode,
      artifactSha256: typeof parsed.artifactSha256 === "string" ? parsed.artifactSha256 : null,
      files: parsed.files && typeof parsed.files === "object" ? (parsed.files as Record<string, string>) : undefined,
      activatedAt: parsed.activatedAt,
      deploymentId: typeof parsed.deploymentId === "string" ? parsed.deploymentId : randomUUID(),
    };
  } catch {
    return null;
  }
}

/** Write the identity record atomically (temp file + rename). */
export function writeReleaseIdentity(root: string, identity: Omit<ReleaseIdentity, "deploymentId"> & { deploymentId?: string }): string {
  if (!SHA_PATTERN.test(identity.commitSha)) {
    throw new Error(`commitSha must be a full 40-character Git SHA, got ${identity.commitSha.length} characters`);
  }
  const target = releaseIdentityPath(root);
  const record: ReleaseIdentity = { ...identity, deploymentId: identity.deploymentId ?? randomUUID() };
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  // A rename is atomic within a filesystem, so a reader never sees a half-written file.
  renameSync(tmp, target);
  return target;
}
