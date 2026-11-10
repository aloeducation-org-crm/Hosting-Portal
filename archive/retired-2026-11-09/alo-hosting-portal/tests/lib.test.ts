import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════
// response.ts tests
// ═══════════════════════════════════════════════════════════════════════
describe('response.ts', () => {
  it('apiSuccess returns correct shape with data', async () => {
    const { apiSuccess } = await import('../src/lib/response');
    const result = apiSuccess({ id: '1' }, 'OK', 200);

    expect(result.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.message).toBe('OK');
    expect(result.data).toEqual({ id: '1' });
    expect(result.error).toBeNull();
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('apiSuccess defaults message and status', async () => {
    const { apiSuccess } = await import('../src/lib/response');
    const result = apiSuccess(null);

    expect(result.status).toBe(200);
    expect(result.message).toBe('Success');
    expect(result.data).toBeNull();
  });

  it('apiError returns correct shape', async () => {
    const { apiError } = await import('../src/lib/response');
    const result = apiError('Something went wrong', 'INTERNAL_ERROR', { field: 'x' }, 500);

    expect(result.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Something went wrong');
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(result.error.details).toEqual({ field: 'x' });
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('apiError omits details when not provided', async () => {
    const { apiError } = await import('../src/lib/response');
    const result = apiError('Not found', 'NOT_FOUND', undefined, 404);

    expect(result.error.details).toBeUndefined();
  });

  it('each call generates a unique requestId', async () => {
    const { apiSuccess } = await import('../src/lib/response');
    const ids = new Set([
      apiSuccess(null).requestId,
      apiSuccess(null).requestId,
      apiSuccess(null).requestId,
    ]);
    expect(ids.size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// password.ts tests
// ═══════════════════════════════════════════════════════════════════════
describe('password.ts', () => {
  it('hashPassword returns a bcrypt hash', async () => {
    const { hashPassword } = await import('../src/lib/password');
    const hash = await hashPassword('testpassword');

    // bcrypt hashes start with $2b$
    expect(hash).toMatch(/^\$2[aby]\$\d+\$/);
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifyPassword returns true for correct password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/lib/password');
    const hash = await hashPassword('correctpass');
    const result = await verifyPassword('correctpass', hash);

    expect(result).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/lib/password');
    const hash = await hashPassword('correctpass');
    const result = await verifyPassword('wrongpass', hash);

    expect(result).toBe(false);
  });

  it('different hashes are produced for the same password (salt)', async () => {
    const { hashPassword } = await import('../src/lib/password');
    const hash1 = await hashPassword('samepass');
    const hash2 = await hashPassword('samepass');

    expect(hash1).not.toBe(hash2);
  });

  it('verifyPassword returns false for empty string', async () => {
    const { hashPassword, verifyPassword } = await import('../src/lib/password');
    const hash = await hashPassword('password123');
    const result = await verifyPassword('', hash);

    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// security.ts — rate limiter
// ═══════════════════════════════════════════════════════════════════════
describe('security.ts rate limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit', async () => {
    // Need to reset module to get fresh rate limit map
    vi.resetModules();

    // Mock env to control rate limit params
    vi.doMock('@/lib/env', () => ({
      env: {
        RATE_LIMIT_WINDOW_SECONDS: 60,
        RATE_LIMIT_MAX_REQUESTS: 3,
      },
    }));

    const { rateLimit } = await import('../src/lib/security');
    const check = rateLimit({ windowMs: 10000, maxRequests: 3 });

    expect(check('user-1').allowed).toBe(true);
    expect(check('user-1').allowed).toBe(true);
    expect(check('user-1').allowed).toBe(true);
  });

  it('blocks requests after max is reached', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: {
        RATE_LIMIT_WINDOW_SECONDS: 60,
        RATE_LIMIT_MAX_REQUESTS: 100,
      },
    }));

    const { rateLimit } = await import('../src/lib/security');
    const check = rateLimit({ windowMs: 10000, maxRequests: 2 });

    expect(check('user-2').allowed).toBe(true);
    expect(check('user-2').allowed).toBe(true);
    expect(check('user-2').allowed).toBe(false);
    expect(check('user-2').retryAfterMs).toBeGreaterThan(0);
  });

  it('different identifiers have independent limits', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: {
        RATE_LIMIT_WINDOW_SECONDS: 60,
        RATE_LIMIT_MAX_REQUESTS: 100,
      },
    }));

    const { rateLimit } = await import('../src/lib/security');
    const check = rateLimit({ windowMs: 10000, maxRequests: 1 });

    expect(check('user-a').allowed).toBe(true);
    expect(check('user-a').allowed).toBe(false);
    expect(check('user-b').allowed).toBe(true); // Different user
  });
});

// ═══════════════════════════════════════════════════════════════════════
// audit.ts — createAuditLog
// ═══════════════════════════════════════════════════════════════════════
describe('audit.ts createAuditLog', () => {
  it('calls db.auditLog.create with correct parameters', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    vi.doMock('@/lib/db', () => ({
      db: { auditLog: { create: mockCreate } },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn() },
    }));

    const { createAuditLog } = await import('../src/lib/audit');

    await createAuditLog({
      actorId: 'user-1',
      actorEmail: 'admin@test.com',
      actorRole: 'SUPER_ADMIN',
      action: 'WEBSITE_CREATE',
      resourceType: 'Website',
      resourceId: 'w-1',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        actorEmail: 'admin@test.com',
        actorRole: 'SUPER_ADMIN',
        action: 'WEBSITE_CREATE',
        resourceType: 'Website',
        resourceId: 'w-1',
        domain: undefined,
        result: undefined,
        requestId: undefined,
        ipAddress: undefined,
        userAgent: undefined,
        metadata: undefined,
        errorCode: undefined,
        durationMs: undefined,
      },
    });
  });

  it('does not throw when db write fails (swallows error)', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('DB down'));
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      db: { auditLog: { create: mockCreate } },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn() },
    }));

    const { createAuditLog } = await import('../src/lib/audit');

    // Should not throw even when DB fails
    await expect(
      createAuditLog({ action: 'TEST' }),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// smtp.ts — sendEmail fallback when no SMTP configured
// ═══════════════════════════════════════════════════════════════════════
describe('smtp.ts sendEmail', () => {
  it('returns sent=true and logs when SMTP_HOST is not configured', async () => {
    const mockInfo = vi.fn();
    vi.doMock('@/lib/env', () => ({
      env: {
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
        SMTP_FROM: 'noreply@alolabs.net',
        APP_URL: 'http://localhost:3000',
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { info: mockInfo, error: vi.fn() },
    }));

    const { sendEmail } = await import('../src/lib/smtp');
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test Email',
      text: 'Hello',
    });

    expect(result.sent).toBe(true);
    expect(result.messageId).toMatch(/^<.+@localhost>$/);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Test Email',
      }),
      'SMTP not configured — email logged (dev mode)',
    );
  });
});
