/**
 * Multi-business tenant & organization isolation helper.
 *
 * ALO Labs operates distinct brands and client workspaces (e.g., ALO Education,
 * TECH360, ALO Marketing, and external client organizations) on a shared
 * control plane. Routes and workers should use these helpers to scope reads and
 * authorize cross-workspace access explicitly rather than relying on flat
 * userId checks alone.
 */
import { db } from "@/lib/db";
import { isAdminRole, type AuthUser } from "@/lib/auth";
import { apiError } from "@/lib/response";

export type OrganizationRole = "OWNER" | "ADMIN" | "OPERATOR" | "MEMBER" | "VIEWER";

export interface TenantScope {
  userId: string;
  isPlatformAdmin: boolean;
  organizationIds: string[];
  activeOrganizationId: string | null;
}

/**
 * Resolves all organizations the user belongs to (or owns). Platform admins
 * (`ADMIN` / `SUPER_ADMIN`) retain global visibility when `requestedOrgId` is
 * omitted, or can narrow their view explicitly to a single organization via
 * `requestedOrgId`.
 */
export async function resolveTenantScope(
  user: AuthUser,
  requestedOrgId?: string | null,
): Promise<TenantScope> {
  const isPlatformAdmin = isAdminRole(user.role);

  const [owned, memberships] = await Promise.all([
    db.organization.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    }),
    db.membership.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    }),
  ]);

  const orgSet = new Set<string>();
  for (const o of owned) orgSet.add(o.id);
  for (const m of memberships) orgSet.add(m.organizationId);
  const organizationIds = Array.from(orgSet);

  const requested = requestedOrgId?.trim() || null;
  if (requested) {
    if (!isPlatformAdmin && !orgSet.has(requested)) {
      throw apiError(
        "Forbidden: you do not have access to this organization workspace",
        "TENANT_FORBIDDEN",
        undefined,
        403,
      );
    }
    return {
      userId: user.id,
      isPlatformAdmin,
      organizationIds,
      activeOrganizationId: requested,
    };
  }

  return {
    userId: user.id,
    isPlatformAdmin,
    organizationIds,
    activeOrganizationId: organizationIds[0] ?? null,
  };
}

/**
 * Builds a Prisma `where` clause fragment for Website records honoring both
 * direct ownership and organization membership boundaries.
 */
export function websiteTenantWhere(scope: TenantScope): Record<string, unknown> {
  if (scope.isPlatformAdmin) {
    return scope.activeOrganizationId
      ? { organizationId: scope.activeOrganizationId }
      : {};
  }

  if (scope.activeOrganizationId) {
    return {
      OR: [
        { organizationId: scope.activeOrganizationId },
        { ownerId: scope.userId, organizationId: null },
      ],
    };
  }

  if (scope.organizationIds.length > 0) {
    return {
      OR: [
        { ownerId: scope.userId },
        { organizationId: { in: scope.organizationIds } },
      ],
    };
  }

  return { ownerId: scope.userId };
}

/**
 * Asserts that `user` can access a resource belonging to `resourceOwnerId`
 * and/or `resourceOrganizationId`. Throws a 403 `ApiResponse` on violation.
 */
export async function assertTenantAccess(
  user: AuthUser,
  resource: { ownerId?: string | null; organizationId?: string | null },
): Promise<void> {
  if (isAdminRole(user.role)) return;
  if (resource.ownerId && resource.ownerId === user.id) return;

  if (resource.organizationId) {
    const [owned, member] = await Promise.all([
      db.organization.findFirst({
        where: { id: resource.organizationId, ownerId: user.id },
        select: { id: true },
      }),
      db.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: resource.organizationId,
          },
        },
        select: { id: true },
      }),
    ]);
    if (owned || member) return;
  }

  throw apiError(
    "Forbidden: resource belongs to another tenant workspace",
    "TENANT_FORBIDDEN",
    undefined,
    403,
  );
}
