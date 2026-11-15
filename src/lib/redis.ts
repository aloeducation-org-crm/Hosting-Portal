type RedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (...args: Array<string | number>) => Promise<unknown>;
  del: (key: string | string[]) => Promise<number>;
  incr: (key: string) => Promise<number>;
  pexpire: (key: string, ms: number) => Promise<number>;
  pttl: (key: string) => Promise<number>;
};

let redis: RedisClient | null = null;
let initialized = false;

async function getRedis(): Promise<RedisClient | null> {
  if (initialized) return redis;
  initialized = true;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  try {
    const mod = await import("ioredis");
    const Redis = mod.default;
    const r = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    r.on?.("error", () => {
      // Errors degrade gracefully to null cache reads/writes
    });
    redis = r as unknown as RedisClient;
    return redis;
  } catch {
    return null;
  }
}

export { getRedis };

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const r = await getRedis();
    if (!r) return null;
    const raw = await r.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    const json = JSON.stringify(value);
    if (typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      await r.set(key, json, "EX", Math.max(1, Math.floor(ttlSeconds)));
    } else {
      await r.set(key, json);
    }
  } catch {
    // silent fallback
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    await r.del(key);
  } catch {
    // silent fallback
  }
}

/**
 * Atomically increments a counter key in Redis and ensures an expiry window is
 * attached. Returns null when Redis is not configured or unreachable so callers
 * can fall back to local bounded memory buckets.
 */
export async function cacheIncrWindow(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number } | null> {
  try {
    const r = await getRedis();
    if (!r) return null;
    const count = await r.incr(key);
    if (count === 1) {
      await r.pexpire(key, Math.max(1000, Math.floor(windowMs)));
      return { count, ttlMs: Math.max(1000, Math.floor(windowMs)) };
    }
    const pttl = await r.pttl(key);
    if (pttl < 0) {
      await r.pexpire(key, Math.max(1000, Math.floor(windowMs)));
      return { count, ttlMs: Math.max(1000, Math.floor(windowMs)) };
    }
    return { count, ttlMs: pttl };
  } catch {
    return null;
  }
}
