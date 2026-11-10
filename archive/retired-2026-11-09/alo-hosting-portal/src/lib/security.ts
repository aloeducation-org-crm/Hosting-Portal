import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { env } from './env'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetAt <= now) rateLimitMap.delete(key)
  }
}, 60_000)

export function rateLimit(options?: { windowMs?: number; maxRequests?: number }) {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_SECONDS * 1000
  const maxRequests = options?.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS

  return function checkLimit(identifier: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    const entry = rateLimitMap.get(identifier)
    if (!entry || entry.resetAt <= now) {
      rateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (entry.count >= maxRequests) {
      return { allowed: false, retryAfterMs: entry.resetAt - now }
    }
    entry.count++
    return { allowed: true, retryAfterMs: 0 }
  }
}

export async function authenticateRequest(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const payload = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    return payload ?? null
  } catch {
    return null
  }
}

export function requireRole(...roles: string[]) {
  return function checkRole(userRole?: string): boolean {
    if (!userRole) return false
    return roles.includes(userRole)
  }
}
