import { getServerSession } from "next-auth/next";
import { apiError } from "@/lib/response";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN" as const,
  ADMIN: "ADMIN" as const,
  DEVOPS: "DEVOPS" as const,
  SUPPORT: "SUPPORT" as const,
  VIEWER: "VIEWER" as const,
};

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = [
  "WEBSITE_SUSPEND",
  "WEBSITE_RESUME",
  "WEBSITE_CREATE",
  "WEBSITE_READ",
  "WEBSITE_UPDATE",
  "WEBSITE_DELETE",
  "WEBSITE_DEPLOY",
  "WEBSITE_RESTART",
  "DOMAIN_CREATE",
  "DOMAIN_READ",
  "DOMAIN_UPDATE",
  "DOMAIN_DELETE",
  "SSL_MANAGE",
  "DATABASE_CREATE",
  "DATABASE_READ",
  "DATABASE_UPDATE",
  "DATABASE_DELETE",
  "BACKUP_CREATE",
  "BACKUP_READ",
  "BACKUP_RESTORE",
  "FILE_MANAGE",
  "LOGS_READ",
  "USER_CREATE",
  "USER_READ",
  "USER_UPDATE",
  "USER_DELETE",
  "ROLE_MANAGE",
  "AUDIT_READ",
  "SERVER_MANAGE",
  "SYSTEM_MANAGE",
] as const;

export type PermissionName = (typeof PERMISSIONS)[number];

const ROLE_HIERARCHY: Record<RoleName, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  DEVOPS: 60,
  SUPPORT: 40,
  VIEWER: 20,
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  permissions: string[];
};

export async function requireSession(request: NextRequest): Promise<AuthUser> {
  const session = await getServerSession();

  if (!session?.user) {
    throw apiError("Authentication required", "UNAUTHORIZED", undefined, 401);
  }

  if (!session.user.email) {
    throw apiError("Invalid session", "UNAUTHORIZED", undefined, 401);
  }

  const user = await db.user.findUnique({
    where: { email: session.user.email },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  if (!user) {
    throw apiError("User not found", "UNAUTHORIZED", undefined, 401);
  }

  if (!user.isActive || user.isLocked) {
    throw apiError("Account is disabled or locked", "FORBIDDEN", undefined, 403);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.name,
    permissions: user.role.permissions.map((rp) => rp.permission.name),
  };
}

export async function requireRole(request: NextRequest, roles: string[]): Promise<AuthUser> {
  const user = await requireSession(request);

  if (!roles.includes(user.role)) {
    throw apiError(
      "Insufficient role",
      "FORBIDDEN",
      { required: roles, actual: user.role },
      403,
    );
  }

  return user;
}

export async function requirePermission(request: NextRequest, permission: string): Promise<AuthUser> {
  const user = await requireSession(request);

  if (user.role === ROLES.SUPER_ADMIN) {
    return user;
  }

  if (!user.permissions.includes(permission)) {
    throw apiError(
      "Insufficient permission",
      "FORBIDDEN",
      { required: permission, userPermissions: user.permissions },
      403,
    );
  }

  return user;
}

export async function requireSuperAdmin(request: NextRequest): Promise<AuthUser> {
  return requireRole(request, [ROLES.SUPER_ADMIN]);
}

export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[], perms: string[]): boolean {
  return perms.some((p) => permissions.includes(p));
}

export function hasRole(role: string, required: string[]): boolean {
  return required.includes(role);
}

export function isRoleAtLeast(role: string, minimum: string): boolean {
  const roleLevel = ROLE_HIERARCHY[role as RoleName] ?? 0;
  const minLevel = ROLE_HIERARCHY[minimum as RoleName] ?? 0;
  return roleLevel >= minLevel;
}

/**
 * Verify a Bearer token against INTERNAL_SECRET.
 * Returns the decoded payload if valid, throws apiError otherwise.
 */
export function verifyToken(token: string): { id: string; email: string; role: string } {
  if (!token || token !== env.INTERNAL_SECRET) {
    throw apiError('Invalid or expired token', 'UNAUTHORIZED', undefined, 401);
  }
  // For internal service tokens, return a system-level user
  return { id: 'system', email: 'system@alolabs.net', role: ROLES.SUPER_ADMIN };
}
