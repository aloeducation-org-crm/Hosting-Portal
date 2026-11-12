/**
 * SEC-11 — host-level deployment settings are operator-only.
 *
 * A deploy project's configuration is written by tenants: the dashboard PATCH
 * route accepts a `config` object, and the AI provisioning routes accept a
 * `deployConfig`. Some of those fields do not describe the customer's app at
 * all — they describe the *host*. Three of them can damage the platform or
 * another tenant:
 *
 *   serviceName     `restartExternalService()` runs `systemctl restart <name>`.
 *                   A tenant naming `alo-hosting-panel` restarts (or, with a
 *                   failing unit, stops) the control plane on the next deploy.
 *   serviceManager  `systemd`/`pm2` reach a privileged service manager; `static`
 *                   does not. This selects which of those code paths run.
 *   port            A tenant claiming the panel's own port shadows the platform
 *                   behind the reverse proxy. Historically only 3051 was
 *                   reserved, and only on the AI routes — the dashboard PATCH
 *                   route had no port check at all.
 *
 * The rule implemented here:
 *
 *   1. Baseline rejections apply to everyone (ports below 1024, ports the host
 *      actually runs the control plane on, and the control-plane unit name).
 *   2. Setting or *changing* a host-level field requires an operator. A tenant
 *      may keep whatever value an operator already confirmed for them, so
 *      existing projects do not break, but may not introduce a new value.
 *
 * This is deliberately a *policy* module with no imports from the deploy engine:
 * it must be usable by a route that only has a parsed body, and it must be
 * testable without a host.
 */

import { ALO_SERVER_SPEC } from "./server-spec";

/** Roles allowed to change host-level deployment settings. */
export const DEPLOY_SETTINGS_OPERATOR_ROLES: readonly string[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DEVOPS",
];

/**
 * Unit names the platform itself runs under. Restarting any of these from a
 * tenant deploy is a control-plane outage, not a customer action.
 *
 * Keep this list aligned with `deploy/systemd/*.service` and the pm2 app named
 * in `ALO_SERVER_SPEC.controlPlane.pm2App`.
 */
export const RESERVED_SERVICE_NAMES: readonly string[] = [
  "alo-hosting-panel",
  "alo-automation-worker",
  "alo-server-hosting",
  "alo-port-8080-validator",
  ALO_SERVER_SPEC.controlPlane.pm2App, // "alo-hosting"
];

/**
 * Ports the control plane and its sidecars listen on. A tenant site on one of
 * these collides with the platform process, so it is refused for everyone.
 *
 * `ALO_SERVER_SPEC.controlPlane.port` is included for hosts still configured the
 * documented way, but it is not sufficient on its own: the shipped systemd unit
 * sets `PORT=3051` while the Docker image exposes 8080, and both have been used.
 * The union is the safe check.
 */
export const RESERVED_PLATFORM_PORTS: readonly number[] = Array.from(
  new Set([ALO_SERVER_SPEC.controlPlane.port, 3000, 3051, 8080]),
);

/** Fields that describe the host rather than the customer's application. */
export const HOST_LEVEL_FIELDS = ["serviceName", "serviceManager", "port"] as const;
export type HostLevelField = (typeof HOST_LEVEL_FIELDS)[number];

export class HostLevelSettingError extends Error {
  readonly code = "OPERATOR_ONLY_SETTING";
  readonly field: HostLevelField;
  constructor(field: HostLevelField, message: string) {
    super(message);
    this.name = "HostLevelSettingError";
    this.field = field;
  }
}

export function isDeploySettingsOperator(role: string | null | undefined): boolean {
  return typeof role === "string" && DEPLOY_SETTINGS_OPERATOR_ROLES.includes(role);
}

export function isReservedServiceName(name: string | null | undefined): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  return RESERVED_SERVICE_NAMES.some(
    (reserved) => reserved.toLowerCase() === name.trim().toLowerCase(),
  );
}

export function isReservedPlatformPort(port: number): boolean {
  return RESERVED_PLATFORM_PORTS.includes(port);
}

/**
 * The narrow subset that is safe to enforce inside `validateDeployConfig`.
 *
 * Only the reserved *service name* belongs here. Ports do not: framework
 * detection legitimately proposes the port an application declares in its own
 * manifest (a Next.js app that says `8080` is describing itself, not claiming a
 * host port), and the deploy host assigns the real listening port. Rejecting
 * that candidate at validation time would refuse to detect a normal application.
 *
 * Service names are different: detection never invents one, so any occurrence of
 * a platform unit name came from a caller.
 */
export function assertReservedServiceName(serviceName?: string | null): void {
  if (isReservedServiceName(serviceName)) {
    throw new HostLevelSettingError(
      "serviceName",
      `Service name "${serviceName}" belongs to the hosting platform and cannot be targeted by a tenant deployment.`,
    );
  }
}

/**
 * Checks that apply to every caller at a write boundary, operator or not. Throws
 * `HostLevelSettingError` for the first violation found.
 *
 * Order matters: reserved values are refused before the operator check, so an
 * operator is not silently granted a value that would break the platform, and a
 * tenant receives a specific message rather than a generic "forbidden".
 */
export function assertBaselineDeploySettings(config: {
  port?: number | null;
  serviceName?: string | null;
}): void {
  if (typeof config.port === "number") {
    if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
      throw new HostLevelSettingError(
        "port",
        `Port ${config.port} is not usable for a tenant application: it must be an integer between 1024 and 65535.`,
      );
    }
    if (isReservedPlatformPort(config.port)) {
      throw new HostLevelSettingError(
        "port",
        `Port ${config.port} is reserved for the hosting platform's own processes and cannot be assigned to a tenant application.`,
      );
    }
  }

  if (isReservedServiceName(config.serviceName)) {
    throw new HostLevelSettingError(
      "serviceName",
      `Service name "${config.serviceName}" belongs to the hosting platform and cannot be targeted by a tenant deployment.`,
    );
  }
}

/**
 * Full policy: baseline checks plus the operator requirement for changes to
 * host-level fields.
 *
 * @param proposed   The configuration after applying the request.
 * @param current    The configuration already stored, or null on creation.
 * @param role       The acting user's role.
 */
export function assertDeploySettingsChangeAllowed(
  proposed: { port?: number | null; serviceName?: string | null; serviceManager?: string | null },
  current: {
    port?: number | null;
    serviceName?: string | null;
    serviceManager?: string | null;
  } | null,
  role: string | null | undefined,
): void {
  assertBaselineDeploySettings(proposed);

  if (isDeploySettingsOperator(role)) return;

  const changes: HostLevelField[] = [];
  if ((proposed.port ?? null) !== (current?.port ?? null)) changes.push("port");
  if ((proposed.serviceName ?? null) !== (current?.serviceName ?? null)) changes.push("serviceName");
  if ((proposed.serviceManager ?? null) !== (current?.serviceManager ?? null)) {
    changes.push("serviceManager");
  }

  if (changes.length > 0) {
    throw new HostLevelSettingError(
      changes[0]!,
      `Changing ${changes.join(", ")} affects shared host resources and requires an operator ` +
        `(${DEPLOY_SETTINGS_OPERATOR_ROLES.join(", ")}). Keep the existing value or ask an operator to set it.`,
    );
  }
}

/**
 * Strip host-level fields a non-operator is not allowed to change, leaving the
 * stored values in place. Used where a route merges a patch into stored config:
 * dropping the field is friendlier than rejecting the whole request, and it
 * cannot fail open because the stored value is preserved.
 */
export function stripHostLevelChanges<T extends Record<string, unknown>>(
  patch: T,
  current: { port?: unknown; serviceName?: unknown; serviceManager?: unknown } | null,
  role: string | null | undefined,
): T {
  if (isDeploySettingsOperator(role)) return patch;

  const out: Record<string, unknown> = { ...patch };
  // Restore the stored value for each field rather than deleting it: the merge
  // that follows is a spread, so an absent key would silently drop a valid value.
  for (const field of HOST_LEVEL_FIELDS) {
    if (field in out && out[field] !== (current?.[field] ?? undefined)) {
      if (current && current[field] !== undefined) out[field] = current[field];
      else delete out[field];
    }
  }
  return out as T;
}
