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

vi.mock('../src/lib/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  user: { findUnique: vi.fn() },
  website: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}))

import { callHelper } from '../src/lib/helpers'

describe('callHelper', () => {
  it('rejects non-allowlisted helper names', async () => {
    await expect(
      callHelper('malicious-script', ['rm', '-rf', '/'] as never[])
    ).rejects.toThrow()
  })

  it('rejects path traversal attempts', async () => {
    await expect(
      callHelper('alo-hosting-helper', ['../../etc/passwd'] as never[])
    ).rejects.toThrow()
  })

  it('rejects empty helper name', async () => {
    await expect(
      callHelper('', ['arg1'] as never[])
    ).rejects.toThrow()
  })
})
