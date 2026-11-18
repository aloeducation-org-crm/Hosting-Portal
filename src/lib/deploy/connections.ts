/**
 * Git connection authorization (SEC-02).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * `accessToken(connectionId)` in `projects.ts` looked a connection up by primary
 * key and returned a token for it. There was no ownership check anywhere on the
 * path, and three routes handed it a caller-supplied id:
 *
 *   GET  /api/github/repos?connectionId=<any id>          → token of another tenant
 *   POST /api/deploy/projects  { connectionId: <any id> }  → import another tenant's private repo
 *   POST /api/deploy/projects/<id>/detect                  → via the project's own connection
 *
 * So any signed-in account that could guess or observe a connection id could
 * read a different customer's private repositories, their file contents and
 * their branches with that customer's GitHub credential. `GitConnection.id` is
 * a uuid(), so the defect was not trivially exploitable by enumeration, but the
 * ids are returned by `GET /api/github/status`, which listed **every**
 * connection on the platform to **every** signed-in user. That made the leak
 * reachable without guessing.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A connection belongs to the user who completed the OAuth/App connect flow
 * (`connectedById`). It is usable by:
 *
 *   - that user; or
 *   - a platform administrator (`SUPER_ADMIN`/`ADMIN`/`DEVOPS`), because
 *     administration of the deploy layer is an administrative function.
 *
 * A connection with no `connectedById` (an installation registered by the
 * platform itself) is usable by administrators only. It is never usable by an
 * ordinary account, because there is no account it belongs to.
 *
 * Revoked connections are not usable by anyone; the grant is gone, and the
 * encrypted token has been nulled.
 *
 * ── The platform token ──────────────────────────────────────────────────────
 * When no connection is supplied, `accessToken` falls back to the server's
 * `GITHUB_TOKEN`. That credential is platform-wide, so it must not become a
 * shared back door:
 *
 *   - it is only offered to a request that explicitly has no connection id;
 *   - it may only read **public** repositories unless
 *     `DEPLOY_ALLOW_PLATFORM_TOKEN_PRIVATE_REPOS=1` is set, and repository
 *     listing through it is filtered to public repositories. Otherwise any
 *     signed-in account could enumerate ALO's private repository names through
 *     the platform token, and clone them.
 *
 * ── Why one module ──────────────────────────────────────────────────────────
 * The original defect existed in three of four call sites because the check was
 * something each route had to remember. The regression test in
 * `tests/deploy-tenant-isolation.test.ts` asserts that no route resolves a
 * connection by id without going through this module.
 */
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { resolveToken, type TokenSource } from "./github";
import { logger } from "@/lib/logger";

export interface GitConnectionRecord {
  id: string;
  provider: string;
  mode: string;
  accountLogin: string;
  accountType: string | null;
  installationId: string | null;
  scopes?: string | null;
  connectedById: string | null;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
}

/** Error shape understood by `errorResponse` in `deploy/http.ts`. */
export class GitAuthorizationError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = "FORBIDDEN") {
    super(message);
    this.name = "GitAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

export function notFoundError(message: string): GitAuthorizationError {
  return new GitAuthorizationError(message, 404, "NOT_FOUND");
}

/**
 * Who may administer the deploy layer.
 *
 * This mirrors `canAccessProject` in `deploy/http.ts`, which already lets these
 * three roles read and operate every tenant's deployment project. Making the set
 * explicit here — rather than calling the coarser `isAdminRole`, which excludes
 * DEVOPS — keeps the connection rule consistent with the project rule it sits
 * beside. Narrowing DEVOPS out of cross-tenant deploy access is a separate RBAC
 * change (Phase 1 in the master brief) and must not be smuggled into a security
 * fix: it would break operators mid-incident with no migration path.
 */
export const DEPLOY_ADMIN_ROLES: ReadonlySet<string> = new Set(["SUPER_ADMIN", "ADMIN", "DEVOPS"]);

export function canAdministerDeployLayer(role?: string | null): boolean {
  return Boolean(role && DEPLOY_ADMIN_ROLES.has(role));
}

/**
 * Pure ownership predicate. Exported so tests can assert the rule directly
 * without a database.
 */
export function canUseConnection(
  user: Pick<AuthUser, "id" | "role">,
  connection: Pick<GitConnectionRecord, "connectedById" | "status">,
): boolean {
  if (connection.status !== "active") return false;
  if (canAdministerDeployLayer(user.role)) return true;
  if (!connection.connectedById) return false;
  return connection.connectedById === user.id;
}

/**
 * Load a connection and refuse it unless the caller may use it.
 *
 * A cross-tenant attempt is written to the application log with the actor, the
 * connection owner and the request path. It is deliberately not written as an
 * `AuditLog` row in the caller's tenant, because that would let an attacker
 * write rows into another tenant's audit feed.
 */
export async function requireConnectionAccess(
  user: AuthUser,
  connectionId: string,
  context: { route?: string } = {},
): Promise<GitConnectionRecord> {
  const connection = (await db.gitConnection.findUnique({ where: { id: connectionId } })) as GitConnectionRecord | null;
  if (!connection) throw notFoundError("Connection not found");
  if (connection.status !== "active") {
    throw new GitAuthorizationError("This Git connection has been revoked; reconnect the account.", 409, "CONNECTION_REVOKED");
  }
  if (!canUseConnection(user, connection)) {
    logger.warn(
      {
        event: "git_connection_cross_tenant_denied",
        actorId: user.id,
        actorRole: user.role,
        connectionId: connection.id,
        connectionOwnerId: connection.connectedById,
        route: context.route ?? "unknown",
      },
      "cross-tenant git connection access denied",
    );
    throw new GitAuthorizationError("This Git connection belongs to another account.", 403, "FORBIDDEN");
  }
  return connection;
}

/** Connections the caller may use, for the status/selection UI. */
export async function listUsableConnections(user: AuthUser): Promise<GitConnectionRecord[]> {
  const where = canAdministerDeployLayer(user.role) ? {} : { connectedById: user.id };
  const rows = (await db.gitConnection.findMany({
    where: { ...where, status: "active" },
    orderBy: { createdAt: "desc" },
  })) as GitConnectionRecord[];
  return rows.filter((row) => canUseConnection(user, row));
}

/** Does the caller hold any credential that could reach a private repository? */
export function platformAllowsPrivateRepos(): boolean {
  return process.env.DEPLOY_ALLOW_PLATFORM_TOKEN_PRIVATE_REPOS === "1";
}

/**
 * Resolve the token for a request.
 *
 * `connectionId` must have already been authorized with
 * `requireConnectionAccess`; this function takes the *record* rather than an id
 * so it is not possible to pass an unverified id here by mistake.
 */
export async function tokenForConnection(connection: GitConnectionRecord | null): Promise<TokenSource> {
  const source = await resolveToken(connection);
  if (!source.token) {
    throw new GitAuthorizationError(
      "No GitHub credentials available. Connect a GitHub account or configure a GitHub App/token first.",
      400,
      "NO_GITHUB_CREDENTIALS",
    );
  }
  return source;
}

/**
 * A repository visible through the platform token must be public.
 *
 * Called by the import path and by detection so that "no connection" cannot be
 * used to read a private repository with the server credential.
 */
export async function assertRepositoryAllowedForSource(
  source: TokenSource,
  repository: { private?: boolean; fullName?: string } | null,
): Promise<void> {
  if (source.mode !== "token") return;
  if (platformAllowsPrivateRepos()) return;
  if (repository && repository.private === true) {
    throw new GitAuthorizationError(
      "Private repositories require a connected GitHub account. The platform token may only be used for public repositories.",
      403,
      "PLATFORM_TOKEN_PUBLIC_ONLY",
    );
  }
}

/**
 * Token resolution bound to a deployed project.
 *
 * The project's connection is authorized once, at import time, and stored on the
 * row. Re-checking ownership here on every deploy would break a project whose
 * original owner left the team, but the connection itself must still be active:
 * a revoked connection must stop being usable for builds immediately.
 */
export async function tokenForProject(project: { connectionId?: string | null }): Promise<TokenSource> {
  if (!project.connectionId) return tokenForConnection(null);
  const connection = (await db.gitConnection.findUnique({ where: { id: project.connectionId } })) as GitConnectionRecord | null;
  if (!connection) {
    throw new GitAuthorizationError("The Git connection for this project no longer exists; reconnect the account.", 409, "CONNECTION_MISSING");
  }
  if (connection.status !== "active") {
    throw new GitAuthorizationError("The Git connection for this project has been revoked; reconnect the account.", 409, "CONNECTION_REVOKED");
  }
  return tokenForConnection(connection);
}

/** Public shape of a connection for API responses. Never includes a token. */
export function publicConnection(connection: GitConnectionRecord) {
  return {
    id: connection.id,
    provider: connection.provider,
    mode: connection.mode,
    accountLogin: connection.accountLogin,
    accountType: connection.accountType,
    status: connection.status,
    installationId: connection.installationId,
    createdAt: connection.createdAt,
  };
}
