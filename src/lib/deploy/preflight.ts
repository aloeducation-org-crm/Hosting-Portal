/**
 * Deployment target decision — pure logic, no I/O.
 *
 * The repository ships two deployment shapes:
 *
 *   canonical  `scripts/deploy-production.sh` promotes the CI-built standalone
 *              artifact into an immutable release directory, swaps a symlink
 *              atomically, restarts systemd, probes health and `/login`, and
 *              restores the previous release automatically when verification
 *              fails. This is the intended production shape and it requires a
 *              bootstrapped host.
 *
 *   inline     the historical in-place path: `git pull` the checkout, install
 *              dependencies, rebuild on the host, restart PM2. It is what the
 *              production host actually runs today, because the canonical
 *              prerequisites (`/etc/alo-hosting/panel.env`, an external database
 *              file, the systemd unit and the scoped sudoers rule) are not
 *              present there yet.
 *
 * Choosing between them is a decision about *facts on the host*, so the facts are
 * collected by `scripts/deploy-preflight.sh` and the decision is made here, where
 * it can be unit-tested. Preflight is read-only: it must never change the host.
 */

export interface PreflightFacts {
  /** Full 40-hex commit SHA the deployment intends to activate. */
  commitSha: string;
  /** `DEPLOY_PAYLOAD_DIR` contains `.next/standalone/server.js`. */
  artifactUsable: boolean;
  /** `/etc/alo-hosting/panel.env` exists and is readable by the runner. */
  envFileReadable: boolean;
  /** The external production database file exists. */
  dbFilePresent: boolean;
  /** The canonical release root is writable. */
  releasesDirWritable: boolean;
  /** `systemctl` is present and the panel unit is known to systemd. */
  systemdUnitPresent: boolean;
  /** The canonical checkout (`ALO_HOSTING_ROOT`) exists. */
  canonicalRootPresent: boolean;
  /** The inline checkout is a git work tree. */
  inlineRootIsGit: boolean;
  /** The inline checkout has no uncommitted or untracked changes. */
  inlineRootClean: boolean;
  /** `pm2` is on PATH. */
  pm2Present: boolean;
}

export type DeployMode = "canonical" | "inline";

export interface PreflightDecision {
  mode: DeployMode | "blocked";
  /** True when every requirement of the chosen mode is satisfied. */
  ok: boolean;
  /** Requirements that are not satisfied, each naming the fact that failed. */
  missing: string[];
  /** Why the canonical shape was not chosen, when it was not. */
  canonicalBlockedBy: string[];
  reason: string;
}

const CANONICAL_REQUIREMENTS: Array<[keyof PreflightFacts, string]> = [
  ["artifactUsable", "the CI artifact has no standalone server bundle"],
  ["envFileReadable", "/etc/alo-hosting/panel.env is missing or unreadable"],
  ["dbFilePresent", "the external production database file is missing"],
  ["releasesDirWritable", "the release directory is not writable"],
  ["systemdUnitPresent", "the systemd unit for the panel is not present"],
  ["canonicalRootPresent", "the canonical release root is not present"],
];

const INLINE_REQUIREMENTS: Array<[keyof PreflightFacts, string]> = [
  ["inlineRootIsGit", "the inline checkout is not a git work tree"],
  ["inlineRootClean", "the inline checkout has local changes; pulling could overwrite them"],
  ["pm2Present", "pm2 is not available to restart the panel"],
];

/** A full 40-character lowercase hex SHA, or null. */
export function validCommitSha(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

export function decideReleaseTarget(facts: PreflightFacts): PreflightDecision {
  const canonicalBlockedBy = CANONICAL_REQUIREMENTS.filter(([key]) => !facts[key]).map(([, why]) => why);
  const inlineMissing = INLINE_REQUIREMENTS.filter(([key]) => !facts[key]).map(([, why]) => why);

  const sha = validCommitSha(facts.commitSha);
  if (!sha) {
    return {
      mode: "blocked",
      ok: false,
      missing: ["DEPLOY_COMMIT_SHA is not a full 40-character Git SHA"],
      canonicalBlockedBy,
      reason: "Refusing to deploy an unidentifiable commit: the release could not be traced or verified afterwards.",
    };
  }

  if (canonicalBlockedBy.length === 0) {
    return {
      mode: "canonical",
      ok: true,
      missing: [],
      canonicalBlockedBy: [],
      reason: `Promoting the CI-built artifact for ${sha} into an immutable release with atomic activation and automatic rollback.`,
    };
  }

  if (inlineMissing.length === 0) {
    return {
      mode: "inline",
      ok: true,
      missing: [],
      canonicalBlockedBy,
      reason: `Canonical release activation is not available on this host yet, so ${sha} is deployed in place with pre-change capture, additive-only migration, release-identity verification and automatic restore.`,
    };
  }

  return {
    mode: "blocked",
    ok: false,
    missing: [...canonicalBlockedBy, ...inlineMissing],
    canonicalBlockedBy,
    reason:
      "Neither deployment shape is safe on this host: the canonical prerequisites are missing and the inline checkout cannot be updated safely. Nothing was changed. Run scripts/server-doctor.sh and reconcile the host before deploying.",
  };
}
