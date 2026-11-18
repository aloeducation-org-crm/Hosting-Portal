/**
 * Account verification and self-selected role policy (SEC-06).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * Two related gaps, both reachable from the public signup form:
 *
 *   1. A new account could use the whole customer API — create sites, import
 *      repositories, run builds — before its email address was verified. The
 *      only thing verification gated was nothing at all; `emailVerified` was
 *      recorded and never consulted.
 *   2. `RESELLER` was self-selected at signup with no vetting. The signup route
 *      gated SUPER_ADMIN, ADMIN, DEVOPS and SUPPORT behind an administrator
 *      caller, but left RESELLER open, and `isResellerRole()` treats a reseller
 *      as an administrator for several surfaces. Anyone could claim the label.
 *
 * ── The policy ──────────────────────────────────────────────────────────────
 * Three tiers, because "verified" is not the only thing that matters and a
 * single allow/deny would either break onboarding or keep the hole:
 *
 *   - `verification-exempt` — reading your own profile, seeing your own
 *     dashboard, resending verification, signing out, health. Everything needed
 *     to complete onboarding without being able to affect the platform.
 *   - `verification-required` — anything that creates a resource, consumes
 *     metered capacity, can reach the network or the filesystem, or sends mail
 *     to a third party. An unverified address is an unaccountable actor, so it
 *     gets no such capability.
 *   - `administrator-required` — anything that affects other tenants.
 *
 * Role selection is separate: only the platform may confer a role that carries
 * administrative reach. A self-selected `RESELLER` is therefore downgraded to
 * `CLIENT` at signup and *requested* instead, recorded for review. The reseller
 * capability then has to be granted by an administrator, which is an auditable
 * action rather than a checkbox.
 *
 * ── Why a module ────────────────────────────────────────────────────────────
 * The defect existed because the rule was implicit: nothing enforced it, so
 * nothing could be tested. Making the three lists explicit means a new route
 * must be classified, and the classification can be asserted in a test.
 */

export type AccountTier = "verification-exempt" | "verification-required" | "administrator-required";

/**
 * Paths an unverified session may reach.
 *
 * Prefix-matched. Kept deliberately small and enumerated: a wildcard would make
 * this impossible to review, and the failure mode of a missing entry (an
 * unverified user cannot do something) is recoverable, while the failure mode of
 * an accidental wildcard is not.
 */
export const VERIFICATION_EXEMPT_PREFIXES = [
  "/api/auth", // login, logout, session, signup, verify-email, forgot/reset, providers, MFA challenge
  "/api/user/profile",
  "/api/user/password",
  "/api/user/mfa",
  "/api/dashboard/stats", // read-only, scoped to the caller
  "/api/activity/recent",
  "/api/notifications",
  "/api/health",
  "/api/csrf",
  "/api/onboarding",
  "/api/plans",
  "/api/pricing",
] as const;

/**
 * Administrative prefixes. These require a role, independently of verification.
 */
export const ADMINISTRATOR_PREFIXES = [
  "/api/users",
  "/api/roles",
  "/api/servers",
  "/api/platform/",
  "/api/orchestrator/jobs",
  "/api/agents/enrollment-tokens",
  "/api/security/",
  "/api/audit-logs",
  "/api/infrastructure/",
  "/api/automation/admin",
] as const;

/**
 * Segment-boundary prefix match.
 *
 * `"/api/user/profile"` matches `"/api/user/profile"` and
 * `"/api/user/profile/avatar"`, but not `"/api/user/profile-export"`. This
 * matters in the exempt list: a plain `startsWith` would let an attacker-shaped
 * variant of an exempt path inherit the exemption.
 */
export function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => {
    if (pathname === prefix) return true;
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return pathname.startsWith(`${base}/`);
  });
}

export interface VerificationDecision {
  allowed: boolean;
  tier: AccountTier;
  reason?: string;
  /** HTTP status the caller should receive when `allowed` is false. */
  status?: number;
  code?: string;
}

/**
 * Decide whether a session may reach a path given its verification state.
 *
 * Administrators are exempt: an administrator account is created by an
 * administrator, and locking the platform's own operators out of the console
 * during an incident because their email bounced is a worse outcome than the
 * risk of an unverified administrator.
 */
export function decideVerificationAccess(input: {
  pathname: string;
  emailVerified: boolean;
  isAdministrator: boolean;
}): VerificationDecision {
  if (matchesPrefix(input.pathname, ADMINISTRATOR_PREFIXES)) {
    return { allowed: true, tier: "administrator-required" };
  }
  if (input.isAdministrator) {
    return { allowed: true, tier: "verification-exempt" };
  }
  if (input.emailVerified) {
    return { allowed: true, tier: "verification-required" };
  }
  if (matchesPrefix(input.pathname, VERIFICATION_EXEMPT_PREFIXES)) {
    return { allowed: true, tier: "verification-exempt", reason: "onboarding route" };
  }
  return {
    allowed: false,
    tier: "verification-required",
    status: 403,
    code: "EMAIL_NOT_VERIFIED",
    reason:
      "Verify your email address before using this feature. Check your inbox for the verification link, or request a new one.",
  };
}

/**
 * Resolve the role a self-service signup may actually hold.
 *
 * `requested` is what the form asked for. `callerIsAdministrator` is true only
 * when an authenticated administrator is creating the account. Everything that
 * carries administrative reach is reduced to CLIENT for self-service, and the
 * downgrade is reported so the caller can record it.
 */
export interface RoleDecision {
  role: string;
  downgraded: boolean;
  requested: string;
  /** True when the role needs an administrator to confer it after review. */
  requiresGrant: boolean;
}

export const SELF_SERVICE_FORBIDDEN_ROLES = ["SUPER_ADMIN", "ADMIN", "DEVOPS", "SUPPORT", "RESELLER"] as const;

export function resolveSignupRole(input: {
  requested?: string | null;
  callerIsAdministrator: boolean;
}): RoleDecision {
  const requested = (input.requested ?? "CLIENT").toUpperCase();
  if (input.callerIsAdministrator) {
    return { role: requested, downgraded: false, requested, requiresGrant: false };
  }
  if ((SELF_SERVICE_FORBIDDEN_ROLES as readonly string[]).includes(requested)) {
    return {
      role: "CLIENT",
      downgraded: true,
      requested,
      // A reseller is not an error: it is a capability to be assessed. The
      // account is a normal customer until an administrator grants it.
      requiresGrant: requested === "RESELLER",
    };
  }
  return { role: requested, downgraded: false, requested, requiresGrant: false };
}

/**
 * Roles that carry administrative reach, for authorisation checks elsewhere.
 * Mirrors the list `resolveSignupRole` will not let a customer hold.
 */
export function isPrivilegedRole(role?: string | null): boolean {
  if (!role) return false;
  return ["SUPER_ADMIN", "ADMIN", "RESELLER", "DEVOPS", "SUPPORT"].includes(role);
}
