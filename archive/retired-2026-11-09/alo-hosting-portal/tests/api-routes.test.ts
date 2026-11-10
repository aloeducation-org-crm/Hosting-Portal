import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock next-auth before any imports that use it ──────────────────────
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

// ─── Mock @/lib/db ─────────────────────────────────────────────────────
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    plan: { findMany: mockFindMany },
    role: { findMany: mockFindMany, findUnique: mockFindUnique, create: vi.fn() },
    rolePermission: { create: vi.fn() },
    domain: { findUnique: mockFindUnique },
  },
}));

// ─── Mock @/lib/auth (required by routes that import it) ───────────────
vi.mock('@/lib/auth', () => ({
  requireSession: vi.fn(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    DEVOPS: 'DEVOPS',
    SUPPORT: 'SUPPORT',
    VIEWER: 'VIEWER',
  },
}));

// ─── Mock @/lib/audit ──────────────────────────────────────────────────
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock dns ───────────────────────────────────────────────────────────
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns')>();
  return {
    ...actual,
    resolve4: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
    resolveCname: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
  };
});

// Helper to create a NextRequest-like object
function createMockRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

// ═══════════════════════════════════════════════════════════════════════
// /api/pricing/plans  GET — public, no auth
// ═══════════════════════════════════════════════════════════════════════
describe('/api/pricing/plans GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active plans successfully', async () => {
    const mockPlans = [
      { id: '1', name: 'Starter', priceCents: 0, isActive: true },
      { id: '2', name: 'Business', priceCents: 2999, isActive: true },
    ];
    mockFindMany.mockResolvedValue(mockPlans);

    const { GET } = await import('../src/app/api/pricing/plans/route');
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(mockFindMany).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it('returns empty array when no plans exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import('../src/app/api/pricing/plans/route');
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// /api/roles  GET — requires auth, SUPER_ADMIN only
// ═══════════════════════════════════════════════════════════════════════
describe('/api/roles GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const { requireSession } = await import('@/lib/auth');
    const { apiError } = await import('@/lib/response');
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      apiError('Authentication required', 'UNAUTHORIZED', undefined, 401),
    );

    const { GET } = await import('../src/app/api/roles/route');
    const request = createMockRequest('http://localhost/api/roles');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 403 when user is not SUPER_ADMIN', async () => {
    const { requireSession } = await import('@/lib/auth');
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1',
      email: 'user@example.com',
      role: 'ADMIN',
      permissions: [],
    });

    const { GET } = await import('../src/app/api/roles/route');
    const request = createMockRequest('http://localhost/api/roles');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns roles with permissions for SUPER_ADMIN', async () => {
    const { requireSession } = await import('@/lib/auth');
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1',
      email: 'admin@alolabs.net',
      role: 'SUPER_ADMIN',
      permissions: [],
    });

    const mockRoles = [
      {
        id: 'r1',
        name: 'SUPER_ADMIN',
        description: 'Full access',
        permissions: [
          { permission: { id: 'p1', name: 'WEBSITE_READ', category: 'website' } },
        ],
      },
    ];
    mockFindMany.mockResolvedValue(mockRoles);

    const { GET } = await import('../src/app/api/roles/route');
    const request = createMockRequest('http://localhost/api/roles');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].permissions).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// /api/domains/search  GET — requires auth
// ═══════════════════════════════════════════════════════════════════════
describe('/api/domains/search GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const { requireSession } = await import('@/lib/auth');
    const { apiError } = await import('@/lib/response');
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      apiError('Authentication required', 'UNAUTHORIZED', undefined, 401),
    );

    const { GET } = await import('../src/app/api/domains/search/route');
    const request = createMockRequest('http://localhost/api/domains/search?q=example.com');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 400 when no query parameter is provided', async () => {
    const { requireSession } = await import('@/lib/auth');
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1', email: 'user@test.com', role: 'ADMIN', permissions: [],
    });

    const { GET } = await import('../src/app/api/domains/search/route');
    const request = createMockRequest('http://localhost/api/domains/search');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('returns available=true when domain is not registered and has no DNS', async () => {
    const { requireSession } = await import('@/lib/auth');
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1', email: 'user@test.com', role: 'ADMIN', permissions: [],
    });
    mockFindUnique.mockResolvedValue(null);

    const { GET } = await import('../src/app/api/domains/search/route');
    const request = createMockRequest('http://localhost/api/domains/search?q=brandnewdomain12345.com');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.available).toBe(true);
  });

  it('returns available=false when domain is already registered', async () => {
    const { requireSession } = await import('@/lib/auth');
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1', email: 'user@test.com', role: 'ADMIN', permissions: [],
    });
    mockFindUnique.mockResolvedValue({
      id: 'd1',
      domain: 'existing.com',
      websiteId: 'w1',
    });

    const { GET } = await import('../src/app/api/domains/search/route');
    const request = createMockRequest('http://localhost/api/domains/search?q=existing.com');
    const response = await GET(request as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.available).toBe(false);
    expect(json.data.reason).toBe('already_registered');
  });
});
