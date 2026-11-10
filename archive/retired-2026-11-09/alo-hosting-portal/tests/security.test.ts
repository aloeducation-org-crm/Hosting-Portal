import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/lib/env', () => ({
  DATABASE_URL: 'file:./test.db',
  NODE_ENV: 'test' as const,
  HOSTNAME: '127.0.0.1',
  PORT: 3101,
  APP_URL: 'http://localhost:3101',
  NEXTAUTH_URL: 'http://localhost:3101',
  NEXTAUTH_SECRET: 'test-secret-change-in-production-at-least-32-characters',
  JWT_SECRET: 'test-jwt-secret-change-in-production-at-least-32-chars',
  SITE_BASE: '/tmp/alo-sites',
  BACKUP_BASE: '/tmp/alo-backups',
  CADDY_CONFIG_DIR: '/tmp/caddy-sites',
  CADDY_LOG_DIR: '/tmp/caddy-logs',
  HELPER_TIMEOUT_SECONDS: 10,
  DEPLOY_TIMEOUT_SECONDS: 30,
  BACKUP_RETENTION_COUNT: 3,
  MAX_UPLOAD_SIZE_MB: 10,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: 100,
  ALLOW_STATIC: true,
  ALLOW_PHP: true,
  ALLOW_NODE: true,
  ALLOW_NEXTJS: true,
  COMMERCIAL_HOSTING: false,
}))

import { rateLimit, requireRole } from '../src/lib/security'

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    const limiter = rateLimit({ windowMs: 1000, maxRequests: 5 })
    expect(limiter('ip-a').allowed).toBe(true)
  })

  it('blocks requests over the limit', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 3 })
    limiter('ip-b')
    limiter('ip-b')
    limiter('ip-b')
    const result = limiter('ip-b')
    expect(result.allowed).toBe(false)
  })

  it('resets after window expires', () => {
    const limiter = rateLimit({ windowMs: 0, maxRequests: 1 })
    limiter('ip-c')
    const result = limiter('ip-c')
    expect(result.allowed).toBe(true)
  })

  it('provides retryAfterMs when blocked', () => {
    const limiter = rateLimit({ windowMs: 10000, maxRequests: 1 })
    limiter('ip-d')
    const result = limiter('ip-d')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(0)
  })
})

describe('requireRole', () => {
  const checker = requireRole('ADMIN', 'SUPER_ADMIN')

  it('returns true for an allowed role', () => {
    expect(checker('ADMIN')).toBe(true)
    expect(checker('SUPER_ADMIN')).toBe(true)
  })

  it('returns false for a disallowed role', () => {
    expect(checker('VIEWER')).toBe(false)
    expect(checker('SUPPORT')).toBe(false)
  })

  it('returns false for undefined role', () => {
    expect(checker(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(checker('')).toBe(false)
  })
})
