import { env } from "@/lib/env";
import { cacheIncrWindow } from "@/lib/redis";

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

export const MAX_RATE_LIMIT_BUCKETS = 10_000;

const buckets = new Map<string, Bucket>();

function pruneBuckets(now: number): void {
  if (buckets.size < MAX_RATE_LIMIT_BUCKETS) return;
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) {
      buckets.delete(k);
    }
  }
  // If still above capacity under sustained spoofed-key traffic, evict oldest entries (Map preserves insertion order)
  while (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

export function checkRateLimit(
  identifier: string,
  options?: {
    tier?: PlanRateTier;
    windowMs?: number;
    maxRequests?: number;
  },
): RateLimitResult {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_SECONDS * 1000;
  const limit =
    options?.maxRequests ??
    (options?.tier ? PLAN_LIMITS_PER_MINUTE[options.tier] : env.RATE_LIMIT_MAX_REQUESTS);

  const now = Date.now();
  const existing = buckets.get(identifier);

  if (!existing || now >= existing.resetAt) {
    if (!existing) {
      pruneBuckets(now);
    }
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

/**
 * Distributed rate limiter: uses Redis (`REDIS_URL`) when available across
 * multiple portal replicas, falling back transparently to the bounded local
 * memory store when Redis is unconfigured or unreachable.
 */
export async function checkRateLimitAsync(
  identifier: string,
  options?: {
    tier?: PlanRateTier;
    windowMs?: number;
    maxRequests?: number;
  },
): Promise<RateLimitResult> {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_SECONDS * 1000;
  const limit =
    options?.maxRequests ??
    (options?.tier ? PLAN_LIMITS_PER_MINUTE[options.tier] : env.RATE_LIMIT_MAX_REQUESTS);

  const redisHit = await cacheIncrWindow(`rl:${identifier}`, windowMs);
  if (redisHit) {
    const now = Date.now();
    const resetAt = now + redisHit.ttlMs;
    if (redisHit.count > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, redisHit.ttlMs),
      };
    }
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - redisHit.count),
      resetAt,
      retryAfterMs: 0,
    };
  }

  return checkRateLimit(identifier, options);
}

export function getRateLimitBucketCount(): number {
  return buckets.size;
}

export function resetRateLimits(): void {
  buckets.clear();
}
