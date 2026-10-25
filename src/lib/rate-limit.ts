import { env } from "@/lib/env";

export type PlanRateTier = "starter" | "business" | "enterprise" | "admin";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

const PLAN_LIMITS_PER_MINUTE: Record<PlanRateTier, number> = {
  starter: 60,
  business: 300,
  enterprise: 1200,
  admin: 5000,
};

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  identifier: string,
  options?: {
    tier?: PlanRateTier;
    windowMs?: number;
    maxRequests?: number;
  }
): RateLimitResult {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_SECONDS * 1000;
  const limit =
    options?.maxRequests ??
    (options?.tier ? PLAN_LIMITS_PER_MINUTE[options.tier] : env.RATE_LIMIT_MAX_REQUESTS);

  const now = Date.now();
  const existing = buckets.get(identifier);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(identifier, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfterMs: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterMs: Math.max(0, existing.resetAt - now),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterMs: 0,
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
