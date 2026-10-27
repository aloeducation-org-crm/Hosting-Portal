import { createHash, timingSafeEqual } from "crypto";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { apiError } from "@/lib/response";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env, isUnsafeDefaultSecret } from "@/lib/env";
import { authOptions, handlers, auth } from "@/lib/nextauth";

export { authOptions, handlers, auth };

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN" as const,
  ADMIN: "ADMIN" as const,
  RESELLER: "RESELLER" as const,
  CLIENT: "CLIENT" as const,
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

export const ROLE_HIERARCHY: Record<RoleName, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  RESELLER: 70,
  DEVOPS: 60,
  SUPPORT: 40,
  CLIENT: 30,
  VIEWER: 20,
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  permissions: string[];
};

export function isAdminRole(role?: string | null): boolean {
  return role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN;
}

export function isResellerRole(role?: string | null): boolean {
  return role === ROLES.RESELLER || isAdminRole(role);
}

export function isClientRole(role?: string | null): boolean {
  return role === ROLES.CLIENT || role === ROLES.VIEWER;
}

export function canAccessWebsite(
  user: { id: string; role: string },
  website: { ownerId: string | null } | null | undefined,
): boolean {
  if (!website) return false;
  return isAdminRole(user.role) || Boolean(website.ownerId && website.ownerId === user.id);
}

export function assertWebsiteAccess(
  user: { id: string; role: string },
  website: { ownerId: string | null } | null | undefined,
): void {
  if (!canAccessWebsite(user, website)) {
    throw apiError("Forbidden", "FORBIDDEN", undefined, 403);
  }
}

export function verifyInternalSecretValue(
  supplied: string | null | undefined,
  expected: string | null | undefined = process.env.INTERNAL_SECRET ?? env.INTERNAL_SECRET,
): boolean {
  const cleanSupplied = supplied?.trim() ?? "";
  const cleanExpected = expected?.trim() ?? "";
  if (
    !cleanSupplied ||
    !cleanExpected ||
    cleanExpected.length < 16 ||
    isUnsafeDefaultSecret(cleanExpected)
  ) {
    return false;
  }
  const actualDigest = createHash("sha256").update(cleanSupplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(cleanExpected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export async function requireSession(request: NextRequest): Promise<AuthUser> {
  let email: string | undefined;

  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      email = session.user.email;
    }
  } catch {
    // Outside Next.js headers() async context (e.g., direct route unit tests); fall through to request JWT check.
  }

  if (!email && request) {
    try {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET,
      });
      if (token?.email) {
        email = String(token.email);
      }
    } catch {
      // Ignore token parsing error on mock requests
    }
  }

  if (!email) {
    throw apiError("Authentication required", "UNAUTHORIZED", undefined, 401);
  }

  const user = await db.user.findUnique({
    where: { email },
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

export async function requireAdmin(request: NextRequest): Promise<AuthUser> {
  return requireRole(request, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
}

export async function requireReseller(request: NextRequest): Promise<AuthUser> {
  return requireRole(request, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.RESELLER]);
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
 * Verify a Bearer token against INTERNAL_SECRET using constant-time digest comparison.
 * Returns the decoded payload if valid, throws apiError otherwise.
 */
export function verifyToken(token: string): { id: string; email: string; role: string } {
  const secret = env.INTERNAL_SECRET;
  if (!token || !secret || (env.NODE_ENV === "production" && isUnsafeDefaultSecret(secret))) {
    throw apiError("Invalid or expired token", "UNAUTHORIZED", undefined, 401);
  }
  const actualDigest = createHash("sha256").update(token, "utf8").digest();
  const expectedDigest = createHash("sha256").update(secret, "utf8").digest();
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    throw apiError("Invalid or expired token", "UNAUTHORIZED", undefined, 401);
  }
  return { id: "system", email: "system@alolabs.net", role: ROLES.SUPER_ADMIN };
}
