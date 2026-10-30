/**
 * Shared plumbing for the `/api/internal/crm/*` service endpoints.
 *
 * Keeps the individual route files thin and — more importantly — IDENTICAL in
 * their security posture, so a new endpoint cannot accidentally forget rate
 * limiting, correlation, or the rule that authentication failures return one
 * generic message.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { authenticateService, toEnvelope, type IntegrationResult } from "./crm-storage-router";
import { SERVICE_AUTH_DENIED, type ServicePrincipal, type ServiceScope } from "./service-auth";

/** Header used to join a CRM-side log line to the Hosting-Portal audit record. */
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Rate limit tier for service traffic. A CRM webhook burst can be large, so this
 * uses the enterprise tier rather than the default; the limit is still enforced
 * and a 429 still carries `retry-after` so the client can back off safely
 * instead of hammering.
 */
const SERVICE_RATE_TIER = "enterprise" as const;

export interface ServiceRouteContext {
  principal: ServicePrincipal;
  correlationId: string;
}

/**
 * Authenticates and rate-limits a service request in one step.
 *
 * On success returns the principal and correlation id. On failure returns a
 * ready-to-send `NextResponse` — the route must return it verbatim.
 *
 * Rate limiting is keyed on the NON-SECRET prefix of the supplied token rather
 * than the credential id, so it costs no database lookup and still isolates one
 * caller from another. An unauthenticated caller is keyed by prefix too, which
 * bounds credential-guessing attempts.
 */
export async function requireServiceAuth(
  request: NextRequest,
  scope: ServiceScope,
): Promise<
  | { ok: true; context: ServiceRouteContext }
  | { ok: false; response: NextResponse }
> {
  const correlationId = request.headers.get("x-request-id") ?? request.headers.get(CORRELATION_HEADER);
  const authorizationHeader = request.headers.get("authorization");
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const rateKey = `crm-service:${token ? token.slice(0, 12) : request.headers.get("x-forwarded-for") ?? "unknown"}`;

  const limit = checkRateLimit(rateKey, { tier: SERVICE_RATE_TIER });
  if (!limit.allowed) {
    logger.warn(
      { event: "crm.service.rate_limited", rateKey, correlationId },
      "Service request rate limited",
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          status: 429,
          success: false,
          message: "Rate limit exceeded for this service credential",
          data: null,
          error: { code: "RATE_LIMITED", details: { retryAfterMs: limit.retryAfterMs } },
          requestId: correlationId ?? null,
        },
        {
          status: 429,
          headers: {
            "retry-after": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
            [CORRELATION_HEADER]: correlationId ?? "",
          },
        },
      ),
    };
  }

  const auth = await authenticateService({ authorizationHeader, correlationId }, scope);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        toEnvelope(
          {
            ok: false,
            status: auth.status,
            // Deliberately generic. `auth.code` is the precise cause and is
            // logged, never returned.
            code: "UNAUTHORIZED",
            message: SERVICE_AUTH_DENIED,
          } satisfies IntegrationResult<never>,
          auth.correlationId,
        ).body,
        { status: auth.status, headers: { [CORRELATION_HEADER]: auth.correlationId } },
      ),
    };
  }

  return { ok: true, context: { principal: auth.principal, correlationId: auth.correlationId } };
}

/** Sends a router result with the correlation header attached. */
export function serviceResponse<T>(result: IntegrationResult<T>, correlationId: string): NextResponse {
  const envelope = toEnvelope(result, correlationId);
  return NextResponse.json(envelope.body, {
    status: envelope.status,
    headers: { [CORRELATION_HEADER]: correlationId, "cache-control": "no-store" },
  });
}
