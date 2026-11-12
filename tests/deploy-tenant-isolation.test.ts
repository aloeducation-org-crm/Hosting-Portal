/**
 * SEC-02 regression tests — Git connection tenant isolation.
 *
 * The defect: `accessToken(connectionId)` resolved any connection by primary key
 * and returned a usable GitHub token for it. Three routes (`GET /api/github/repos`,
 * `POST /api/deploy/projects`, `POST /api/deploy/projects/:id/detect`) accepted a
 * caller-influenced connection id, and `GET /api/github/status` handed every
 * signed-in user the full list of connection ids and account logins. One
 * customer could therefore read another customer's private repositories.
 *
 * These tests cover the rule itself (pure function, no database), the token
 * resolution path (with a stubbed Prisma client), and a source scan that fails
 * if a route ever goes back to reading `gitConnection` by id directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  canUseConnection,
  requireConnectionAccess,
  tokenForConnection,
  tokenForProject,
  assertRepositoryAllowedForSource,
  listUsableConnections,
  GitAuthorizationError,
  type GitConnectionRecord,
} from "../src/lib/deploy/connections";
import type { AuthUser } from "../src/lib/auth";

const ROOT = path.resolve(__dirname, "..");

const dbState: { connections: GitConnectionRecord[] } = { connections: [] };

vi.mock("@/lib/db", () => ({
  db: {
    gitConnection: {
      findUnique: async ({ where }: { where: { id: string } }) => dbState.connections.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: { where?: { connectedById?: string; status?: string } } = {}) =>
        dbState.connections.filter(
          (c) => (!where?.connectedById || c.connectedById === where.connectedById) && (!where?.status || c.status === where.status),
        ),
    },
  },
}));

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({ id: "user-1", email: "one@example.com", name: "One", role: "CLIENT", ...over }) as AuthUser;

const connection = (over: Partial<GitConnectionRecord> = {}): GitConnectionRecord => ({
  id: "conn-1",
  provider: "github",
  mode: "oauth",
  accountLogin: "tenant-one",
  accountType: "User",
  installationId: null,
  scopes: null,
  connectedById: "user-1",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  dbState.connections = [];
  delete process.env.GITHUB_TOKEN;
  delete process.env.DEPLOY_ALLOW_PLATFORM_TOKEN_PRIVATE_REPOS;
});

describe("SEC-02 ownership rule", () => {
  it("allows the account that connected it", () => {
    expect(canUseConnection(user(), connection())).toBe(true);
  });

  it("denies a different customer", () => {
    expect(canUseConnection(user({ id: "user-2", email: "two@example.com" }), connection())).toBe(false);
  });

  it("denies a viewer and a billing admin who are not administrators", () => {
    expect(canUseConnection(user({ id: "user-2", role: "VIEWER" }), connection())).toBe(false);
    expect(canUseConnection(user({ id: "user-2", role: "BILLING" }), connection())).toBe(false);
  });

  it("allows platform administrators", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "DEVOPS"]) {
      expect(canUseConnection(user({ id: "admin", role }), connection()), role).toBe(true);
    }
  });

  it("denies a platform-owned connection to an ordinary account", () => {
    expect(canUseConnection(user(), connection({ connectedById: null }))).toBe(false);
    expect(canUseConnection(user({ role: "ADMIN" }), connection({ connectedById: null }))).toBe(true);
  });

  it("denies a revoked connection to everyone, including its owner", () => {
    expect(canUseConnection(user(), connection({ status: "revoked" }))).toBe(false);
    expect(canUseConnection(user({ role: "SUPER_ADMIN" }), connection({ status: "revoked" }))).toBe(false);
  });
});

describe("SEC-02 requireConnectionAccess", () => {
  it("returns the connection to its owner", async () => {
    dbState.connections = [connection()];
    await expect(requireConnectionAccess(user(), "conn-1")).resolves.toMatchObject({ id: "conn-1" });
  });

  it("refuses a cross-tenant read with 403 and does not leak the owner", async () => {
    dbState.connections = [connection()];
    const error = await requireConnectionAccess(user({ id: "user-2" }), "conn-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitAuthorizationError);
    expect((error as GitAuthorizationError).status).toBe(403);
    // The message must not name the other tenant's account.
    expect((error as GitAuthorizationError).message).not.toContain("tenant-one");
    expect((error as GitAuthorizationError).message).not.toContain("user-1");
  });

  it("returns 404 for an unknown id rather than 403 (no existence oracle)", async () => {
    const error = await requireConnectionAccess(user(), "does-not-exist").catch((e: unknown) => e);
    expect((error as GitAuthorizationError).status).toBe(404);
  });

  it("refuses a revoked connection with a specific, actionable error", async () => {
    dbState.connections = [connection({ status: "revoked" })];
    const error = await requireConnectionAccess(user(), "conn-1").catch((e: unknown) => e);
    expect((error as GitAuthorizationError).status).toBe(409);
    expect((error as GitAuthorizationError).code).toBe("CONNECTION_REVOKED");
  });
});

describe("SEC-02 listing", () => {
  it("returns only the caller's connections to a customer", async () => {
    dbState.connections = [
      connection({ id: "conn-1", connectedById: "user-1", accountLogin: "one" }),
      connection({ id: "conn-2", connectedById: "user-2", accountLogin: "two" }),
    ];
    const rows = await listUsableConnections(user());
    expect(rows.map((r) => r.id)).toEqual(["conn-1"]);
  });

  it("returns every active connection to an administrator", async () => {
    dbState.connections = [
      connection({ id: "conn-1", connectedById: "user-1" }),
      connection({ id: "conn-2", connectedById: "user-2" }),
      connection({ id: "conn-3", connectedById: "user-2", status: "revoked" }),
    ];
    const rows = await listUsableConnections(user({ role: "ADMIN" }));
    expect(rows.map((r) => r.id).sort()).toEqual(["conn-1", "conn-2"]);
  });
});

describe("SEC-02 token resolution", () => {

  it("refuses to mint a token when no credential exists", async () => {
    const error = await tokenForConnection(null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitAuthorizationError);
    expect((error as GitAuthorizationError).code).toBe("NO_GITHUB_CREDENTIALS");
  });

  it("refuses a project whose connection was revoked", async () => {
    dbState.connections = [connection({ status: "revoked" })];
    const error = await tokenForProject({ connectionId: "conn-1" }).catch((e: unknown) => e);
    expect((error as GitAuthorizationError).code).toBe("CONNECTION_REVOKED");
  });

  it("refuses a project whose connection row was deleted", async () => {
    const error = await tokenForProject({ connectionId: "gone" }).catch((e: unknown) => e);
    expect((error as GitAuthorizationError).code).toBe("CONNECTION_MISSING");
  });

  it("falls back to the platform token only when no connection is stored", async () => {
    process.env.GITHUB_TOKEN = "ghp_platform_token_value_123456";
    const source = await tokenForProject({ connectionId: null });
    expect(source.mode).toBe("token");
    expect(source.label).toBe("server token");
  });
});

describe("SEC-02 platform token may not read private repositories", () => {
  const platform = { mode: "token" as const, label: "server token", token: "ghp_x" };
  const tenant = { mode: "oauth" as const, label: "connected account", token: "gho_x" };

  it("refuses a private repository through the platform token", async () => {
    const error = await assertRepositoryAllowedForSource(platform, { private: true, fullName: "alo/private" }).catch((e: unknown) => e);
    expect((error as GitAuthorizationError).code).toBe("PLATFORM_TOKEN_PUBLIC_ONLY");
  });

  it("allows a public repository through the platform token", async () => {
    await expect(assertRepositoryAllowedForSource(platform, { private: false, fullName: "alo/public" })).resolves.toBeUndefined();
  });

  it("allows a private repository through the tenant's own connection", async () => {
    await expect(assertRepositoryAllowedForSource(tenant, { private: true })).resolves.toBeUndefined();
  });

  it("allows private repositories through the platform token only with the explicit override", async () => {
    process.env.DEPLOY_ALLOW_PLATFORM_TOKEN_PRIVATE_REPOS = "1";
    await expect(assertRepositoryAllowedForSource(platform, { private: true })).resolves.toBeUndefined();
  });
});

describe("SEC-02 no route resolves a connection by id directly", () => {
  const files = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
      }
    };
    walk(path.join(ROOT, "src/app/api"));
    return out;
  })();

  it("routes git connection lookups through src/lib/deploy/connections.ts", () => {
    const offenders = files.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /gitConnection\.findUnique|gitConnection\.findFirst|gitConnection\.findMany/.test(source);
    });
    // Allowed exceptions, each justified: the connection lifecycle routes own
    // the record itself (connect callback creates it, disconnect revokes it).
    const allowed = [
      path.join("src/app/api/github/disconnect/route.ts"),
    ];
    const unexpected = offenders.filter((file) => !allowed.some((a) => file.endsWith(a)));
    expect(unexpected).toEqual([]);
  });

  it("keeps the ownership predicate in exactly one module", () => {
    const engineSources = files.filter((f) => !f.endsWith(path.join("api", "github", "disconnect", "route.ts")));
    const duplicateRule = engineSources.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /connectedById\s*!==\s*user\.id/.test(source);
    });
    expect(duplicateRule).toEqual([]);
  });
});

describe("SEC-02 import path requires an authorized caller", () => {
  it("ImportInput carries the caller so the connection can be authorized", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/deploy/projects.ts"), "utf8");
    expect(source).toMatch(/user:\s*AuthUser/);
    expect(source).toMatch(/requireConnectionAccess\(user, connectionId/);
    // The old unowned signature must not come back.
    expect(source).not.toMatch(/export async function accessToken\(\s*connectionId\?/);
  });
});
