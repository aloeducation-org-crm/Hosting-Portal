import { NextResponse } from "next/server";
import { apiError, type ApiResponse } from "@/lib/response";
import { ROLES, type AuthUser } from "@/lib/auth";
import { redact } from "./redact";

export function errorResponse(error: unknown): NextResponse {
  if (error && typeof error === "object" && "status" in error) {
    const api = error as ApiResponse;
    return NextResponse.json(api, { status: api.status });
  }
  // Never leak raw error text: it may contain a clone URL / token / path.
  const message = redact(error instanceof Error ? error.message : "Internal server error").slice(0, 300);
  return NextResponse.json(apiError(message, "INTERNAL_ERROR", undefined, 500), { status: 500 });
}

export function badRequest(message: string, code = "VALIDATION_ERROR"): NextResponse {
  return NextResponse.json(apiError(message, code, undefined, 400), { status: 400 });
}

export function notFound(message = "Not found"): NextResponse {
  return NextResponse.json(apiError(message, "NOT_FOUND", undefined, 404), { status: 404 });
}

export function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json(apiError(message, "FORBIDDEN", undefined, 403), { status: 403 });
}

/** Project-level authorization: owner, creator, or an admin. */
export function canAccessProject(
  user: AuthUser,
  project: { createdById?: string | null } ,
  website: { ownerId?: string | null } | null,
): boolean {
  if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN || user.role === ROLES.DEVOPS) return true;
  if (project.createdById && project.createdById === user.id) return true;
  if (website?.ownerId && website.ownerId === user.id) return true;
  return false;
}
