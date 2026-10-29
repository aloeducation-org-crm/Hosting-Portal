/**
 * Release activation guard — pure logic, no I/O.
 *
 * `scripts/deploy-release.sh` used to answer only one question about a target
 * commit: "is it on `origin/main`?" (`git merge-base --is-ancestor`). That is
 * necessary but nowhere near sufficient, and runs #54–#64 of the production
 * workflow proved why:
 *
 *   - A merge to `main` creates a `push` run. Those runs are serialized by the
 *     `hosting-production-deploy` concurrency group and are *never cancelled*,
 *     so an obsolete run waits its turn and then deploys happily. Commit
 *     `123d558` (run #62) is a direct ancestor of `7fc3d15` (run #64): had the
 *     host not been blocked by an unrelated preflight failure, run #62 would
 *     have `git reset --hard` production backwards, passed its own health check
 *     and reported success while silently reverting two commits of deploy and
 *     agent fixes.
 *   - The guard added in PR #18 compared the target against
 *     `git rev-parse origin/main`. On a GitHub Actions runner the checkout is
 *     shallow (`fetch-depth: 1` by default), and `git fetch origin main` in a
 *     shallow clone leaves `origin/main` pointing at the run's own commit. The
 *     comparison then passes for exactly the stale run it exists to reject.
 *
 * So this module decides activation from facts that cannot be faked by clone
 * depth: the authoritative `main` head (fetched over the API or `ls-remote` by
 * `scripts/latest-main-sha.mjs`), explicit ancestry relationships the caller
 * computed against a full history, and the release that is *actually running*
 * (from `release-identity.json`, falling back to the checked-out commit).
 *
 * It is deliberately conservative: unknown means refuse. A deployment that is
 * refused changes nothing and can be retried; a deployment that activates the
 * wrong release changes production and may not be reversible, because additive
 * migrations are not guaranteed to be undoable.
 */

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface ReleaseActivationFacts {
  /** Full 40-hex commit the run intends to activate. */
  targetSha: string;
  /**
   * Authoritative current head of `main`, resolved independently of the local
   * clone (`scripts/latest-main-sha.mjs`). Null when it could not be resolved.
   */
  latestMainSha: string | null;
  /**
   * Commit of the release that is serving traffic right now, from
   * `release-identity.json`, or the checkout's HEAD when no identity record
   * exists. Null when neither is known.
   */
  runningSha: string | null;
  /** True when `targetSha` is an ancestor of (or equal to) `latestMainSha`. */
  targetOnMain: boolean;
  /** True when `runningSha` is an ancestor of (or equal to) `targetSha`. */
  runningIsAncestorOfTarget: boolean;
  /** True when `targetSha` is an ancestor of (or equal to) `runningSha`. */
  targetIsAncestorOfRunning: boolean;
}

export interface RollbackAuthorization {
  /** Operator-supplied intent to move production backwards. */
  allowRollback: boolean;
  /** Who authorized the rollback. Required when one is authorized. */
  operator?: string | null;
  /** Why the rollback is necessary. Required when one is authorized. */
  reason?: string | null;
}

export type ReleaseDecisionCode =
  /** The release may be activated. */
  | "authorize"
  /** The exact same release is already serving; activation is a no-op retry. */
  | "already-running"
  /** The target is not the current head of `main`. */
  | "stale-target"
  /** `main`'s head could not be resolved, so staleness cannot be disproved. */
  | "unknown-main-head"
  /** The target is not on `main` at all. */
  | "unmerged-target"
  /** The target would move production backwards without authorization. */
  | "backward-release"
  /** A rollback was authorized but not attributed to an operator and a reason. */
  | "unattributed-rollback"
  /** The target's relationship to `main` could not be determined. */
  | "unknown-target";

export interface ReleaseActivationDecision {
  authorized: boolean;
  code: ReleaseDecisionCode;
  /** True when this activation moves production to an older commit. */
  rollback: boolean;
  reason: string;
  /** Facts echoed back so the caller can record them in the audit trail. */
  evidence: {
    targetSha: string;
    latestMainSha: string | null;
    runningSha: string | null;
  };
}

function validSha(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SHA_PATTERN.test(trimmed) ? trimmed : null;
}

function refuse(
  code: ReleaseDecisionCode,
  reason: string,
  facts: ReleaseActivationFacts,
  rollback = false,
): ReleaseActivationDecision {
  return {
    authorized: false,
    code,
    rollback,
    reason,
    evidence: {
      targetSha: facts.targetSha,
      latestMainSha: facts.latestMainSha,
      runningSha: facts.runningSha,
    },
  };
}

/**
 * Decide whether `targetSha` may be activated on this host.
 *
 * Ordering matters, and the rollback branch is evaluated before the staleness
 * branch on purpose. A rollback target is by definition not main's head, so a
 * staleness-first ordering would make recovery impossible while looking strict.
 * What keeps that exemption safe is that a rollback still has to be merged into
 * main (step 2), still has to be an actual ancestor of the running release
 * (step 4), and still has to be authorized *and attributed* to an operator and a
 * reason, which are written to an audit record. An obsolete queued run gets none
 * of that for free: nobody set the flag, so it is refused at step 4 or step 5.
 */
export function decideReleaseActivation(
  facts: ReleaseActivationFacts,
  authorization: RollbackAuthorization = { allowRollback: false },
): ReleaseActivationDecision {
  const target = validSha(facts.targetSha);
  if (!target) {
    return refuse(
      "unknown-target",
      `DEPLOY_COMMIT_SHA is not a full 40-character Git SHA (got '${facts.targetSha ?? ""}'); the release could not be identified or verified afterwards.`,
      { ...facts, targetSha: facts.targetSha },
    );
  }

  const latestMain = validSha(facts.latestMainSha);
  const running = validSha(facts.runningSha);
  const evidence = { targetSha: target, latestMainSha: latestMain, runningSha: running };

  // 1. The head of main must be known. Fail closed: an unresolvable head means
  //    staleness cannot be disproved, and "probably current" is not a fact a
  //    production release should rest on.
  if (!latestMain) {
    return {
      ...refuse(
        "unknown-main-head",
        "The current head of main could not be resolved, so this run cannot prove it is not obsolete. Nothing was changed. Resolve main over the API or git ls-remote and retry.",
        { ...facts, ...evidence },
      ),
      evidence,
    };
  }

  // 2. The target must be merged into main. Checked for every deployment,
  //    including an authorized rollback: withdrawing to a commit that was never
  //    on main is not a rollback, it is an unreviewed release.
  if (!facts.targetOnMain) {
    return {
      ...refuse(
        "unmerged-target",
        `Commit ${target} is not an ancestor of main (${latestMain}); refusing to deploy something that was not merged and reviewed.`,
        { ...facts, ...evidence },
      ),
      evidence,
    };
  }

  // 3. Re-activating the release that is already serving is a retry, not a
  //    rollback. Allowed, and reported distinctly so the log is not misleading —
  //    a deployment that changed nothing must not read as a new release.
  if (running && running === target) {
    return {
      authorized: true,
      code: "already-running",
      rollback: false,
      reason: `Release ${target} is already the running release; re-activating it is an idempotent retry, not a rollback.`,
      evidence,
    };
  }

  // 4. Backwards movement. `running` is unknown on a host that has never
  //    completed a deployment through these scripts, which is a first
  //    deployment rather than a rollback, so it must not be blocked.
  const backwards = Boolean(
    running && facts.targetIsAncestorOfRunning && !facts.runningIsAncestorOfTarget,
  );

  if (backwards) {
    if (!authorization.allowRollback) {
      return {
        ...refuse(
          "backward-release",
          `Refusing an unintended backwards deployment: the running release is ${running} and the target ${target} is an ancestor of it. A rollback must be deliberate — set ALLOW_RELEASE_ROLLBACK=1 together with RELEASE_ROLLBACK_OPERATOR and RELEASE_ROLLBACK_REASON, and read docs/audit/DEPLOYMENT_RUNBOOK.md first: additive migrations applied by the newer release are not guaranteed to be reversible.`,
          { ...facts, ...evidence },
          true,
        ),
        evidence,
      };
    }

    const operator = (authorization.operator ?? "").trim();
    const reason = (authorization.reason ?? "").trim();
    if (!operator || !reason) {
      return {
        ...refuse(
          "unattributed-rollback",
          "A rollback was authorized but not attributed. Set RELEASE_ROLLBACK_OPERATOR (who authorized it) and RELEASE_ROLLBACK_REASON (why the newer release must be withdrawn); both are written to the rollback audit record.",
          { ...facts, ...evidence },
          true,
        ),
        evidence,
      };
    }

    // An authorized rollback is exempt from the staleness rule below and only
    // from that rule: it still had to be merged (step 2), and it is still
    // attributed and audited. Without this exemption a rollback could never be
    // expressed at all, because a rollback target is by definition not main's
    // head — the guard would have made recovery impossible while looking strict.
    return {
      authorized: true,
      code: "authorize",
      rollback: true,
      reason: `Explicitly authorized rollback from ${running} to ${target} by ${operator}: ${reason}. Additive migrations applied by ${running} are NOT reversed by this; verify schema compatibility before proceeding.`,
      evidence,
    };
  }

  // 5. Forward deployments must be main's current head. This is the rule that
  //    stops an obsolete queued run: merges to main are serialized by the
  //    workflow's single-flight group and never cancelled, so a superseded run
  //    waits its turn and would otherwise deploy an older commit, pass its own
  //    health check and report success while reverting production.
  if (target !== latestMain) {
    return {
      ...refuse(
        "stale-target",
        `Refusing to deploy an obsolete queued run: this run carries ${target} but main is now ${latestMain}. Only the current head of main may reach production; re-run the workflow for ${latestMain} instead.`,
        { ...facts, ...evidence },
      ),
      evidence,
    };
  }

  return {
    authorized: true,
    code: "authorize",
    rollback: false,
    reason: running
      ? `Activating ${target}, a forward release from the running ${running} and the current head of main.`
      : `Activating ${target}; no running release identity is recorded on this host, so this is treated as a first deployment rather than a rollback.`,
    evidence,
  };
}

/**
 * One line of the rollback audit trail.
 *
 * A rollback is the only deployment that knowingly moves production backwards,
 * so it is the one that most needs to answer "who did this, from what, to what,
 * and why" months later. Written as JSONL next to the deploy logs, never into
 * the Git checkout (which would make the next deployment's dirty-tree check
 * fail — the defect that blocked runs #54, #58, #60, #62 and #64).
 */
export interface RollbackAuditRecord {
  event: "release-rollback";
  recordedAt: string;
  operator: string;
  reason: string;
  sourceRelease: string | null;
  targetRelease: string;
  mainHeadAtDecision: string | null;
  deploymentId?: string | null;
  result?: "authorized" | "refused";
}

export function rollbackAuditRecord(input: {
  operator: string;
  reason: string;
  decision: ReleaseActivationDecision;
  deploymentId?: string | null;
  recordedAt?: string;
}): RollbackAuditRecord {
  return {
    event: "release-rollback",
    recordedAt: input.recordedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    operator: input.operator,
    reason: input.reason,
    sourceRelease: input.decision.evidence.runningSha,
    targetRelease: input.decision.evidence.targetSha,
    mainHeadAtDecision: input.decision.evidence.latestMainSha,
    deploymentId: input.deploymentId ?? null,
    result: input.decision.authorized ? "authorized" : "refused",
  };
}
