type RedisClient = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, ex?: number) => Promise<void>
  del: (key: string | string[]) => Promise<number>
}

let redis: RedisClient | null = null
let initialized = false

async function getRedis(): Promise<RedisClient | null> {
  if (initialized) return redis
  initialized = true
  try {
    const mod = await import('ioredis')
    const Redis = mod.default
    const r = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 3 })
    redis = r as unknown as RedisClient
    return redis
  } catch {
    return null
  }
}

export { getRedis }

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const r = await getRedis()
    if (!r) return null
    const raw = await r.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const r = await getRedis()
    if (!r) return
    const json = JSON.stringify(value)
    await r.set(key, json, ttlSeconds ? ttlSeconds : undefined)
  } catch {
    // silent
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const r = await getRedis()
    if (!r) return
    await r.del(key)
  } catch {
    // silent
  }
}