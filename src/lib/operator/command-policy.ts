/**
 * Authorisation policy for the AI operator command surface.
 *
 * Why this file exists
 * --------------------
 * `POST /api/ai/operator` is reachable by *any* signed-in account, because it
 * only calls `requireSession`. Several of its commands mint commercial
 * entitlements: `activate_plan` creates an active Subscription, a completed
 * Order and a `paid` Invoice without taking any money; `generate_invoice` and
 * `mark_invoice_paid` can both set an invoice to `paid` directly. Before this
 * table existed, the handler computed `isAdmin` and used it only as a *row
 * filter* ("show me every invoice" vs "show me mine"), never as an
 * authorisation gate — so a CLIENT could grant itself the Enterprise plan and
 * mark the invoice paid.
 *
 * The rule this module enforces is deliberately blunt:
 *
 *   1. A customer session may **never** change a billing or entitlement record.
 *   2. Entitlement-changing commands require an administrative role.
 *   3. Everything else a customer can run is scoped to their own rows by the
 *      handler; the role required here is only the floor.
 *
 * Keeping the table in one place (rather than adding `if (!isAdmin)` lines next
 * to each branch) means a new command cannot be added without a reviewer seeing
 * that it needs an explicit policy row — `OPERATOR_COMMANDS` is a exhaustive
 * record, and TypeScript fails the build if a member of `OperatorCommand` is
 * missing.
 */
import { isAdminRole, type AuthUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

/** Every command the operator endpoint accepts. Mirrors the Zod enum in the route. */
export type OperatorCommand =
  | "natural_language"
  | "status_report"
  | "activate_plan"
  | "generate_invoice"
  | "mark_invoice_paid"
  | "auto_deploy_site"
  | "create_crm_lead"
  | "launch_marketing_campaign";

export interface OperatorCommandPolicy {
  /**
   * True when the command writes a commercial record (subscription, order,
   * invoice, plan assignment) or otherwise grants an entitlement the customer
   * has not paid for through the payment handler.
   */
  changesEntitlement: boolean;
  /** Administrative role required. `null` means any authenticated user. */
  requiresAdmin: boolean;
  /** Why this policy exists — surfaced in the 403 so operators can act on it. */
  rationale: string;
}

/**
 * Commands that used to fall through `natural_language` inference are resolved
 * *before* this check runs, so an inference can never smuggle a privileged
 * command past the gate: the route maps the prompt to a concrete command name
 * first and authorises that name.
 */
export const OPERATOR_COMMANDS: Record<OperatorCommand, OperatorCommandPolicy> = {
  natural_language: {
    changesEntitlement: false,
    requiresAdmin: false,
    rationale:
      "Intent detection only. It is re-checked after the concrete command is inferred.",
  },
  status_report: {
    changesEntitlement: false,
    requiresAdmin: false,
    rationale: "Read-only platform snapshot, already filtered to the caller's own rows.",
  },
  activate_plan: {
    changesEntitlement: true,
    requiresAdmin: true,
    rationale:
      "Creates an active subscription, a completed order and a paid invoice without any payment. Self-service plan changes must go through POST /api/subscriptions and the payment handler, never the AI operator.",
  },
  generate_invoice: {
    changesEntitlement: true,
    requiresAdmin: true,
    rationale:
      "Can create an invoice already marked paid (markPaid), which records revenue that was never collected.",
  },
  mark_invoice_paid: {
    changesEntitlement: true,
    requiresAdmin: true,
    rationale:
      "Settles a receivable. Only a finance action (or the payment webhook) may do this; a customer marking their own invoice paid clears the debt for free.",
  },
  auto_deploy_site: {
    changesEntitlement: false,
    requiresAdmin: false,
    rationale:
      "Provisions a site the caller owns. Port, hostname and control-plane protections are enforced separately in the handler.",
  },
  create_crm_lead: {
    changesEntitlement: false,
    requiresAdmin: false,
    rationale: "CRM record scoped to the caller's organisation.",
  },
  launch_marketing_campaign: {
    changesEntitlement: false,
    requiresAdmin: false,
    rationale: "Marketing record scoped to the caller's organisation.",
  },
};

export function policyFor(command: OperatorCommand): OperatorCommandPolicy {
  return OPERATOR_COMMANDS[command];
}

export class OperatorForbiddenError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(
    readonly command: OperatorCommand,
    readonly rationale: string,
  ) {
    super(`Command "${command}" requires an administrative role. ${rationale}`);
    this.name = "OperatorForbiddenError";
  }
}

/**
 * Throw unless `user` may run `command`.
 *
 * Denials are logged with the actor and command so an attempt to self-grant a
 * plan is visible in operations, not silently swallowed.
 */
export function assertOperatorCommandAllowed(user: AuthUser, command: OperatorCommand): void {
  const policy = policyFor(command);
  if (!policy.requiresAdmin) return;
  if (isAdminRole(user.role)) return;

  logger.warn(
    { actorUserId: user.id, actorRole: user.role, command },
    "operator command denied: administrative role required",
  );
  throw new OperatorForbiddenError(command, policy.rationale);
}

/** Convenience predicate for tests and for UI affordances. */
export function canRunOperatorCommand(role: string | null | undefined, command: OperatorCommand): boolean {
  if (!policyFor(command).requiresAdmin) return true;
  return isAdminRole(role);
}
