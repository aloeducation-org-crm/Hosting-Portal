import { teardownIsolatedDb } from "./helpers/isolated-db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { authOptions } from "@/lib/nextauth";
import { initialSignupApproval, signupApprovalRequired } from "@/lib/account-status";
import { createMfaChallengeToken } from "@/lib/mfa-challenge";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as mfa } from "@/app/api/auth/mfa-challenge/route";
import { POST as onboarding } from "@/app/api/auth/onboarding/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import { PATCH as review } from "@/app/api/admin/users/approve/route";
import { POST as createUser } from "@/app/api/users/route";
import { PUT as updateUser } from "@/app/api/users/[id]/route";

vi.mock("@/lib/smtp", () => ({ sendEmail: vi.fn(async () => ({ sent: false, messageId: "test-only" })) }));

const password = "Test-only-valid-password-500!";
type Identity = { id: string; email: string };
let superAdmin: Identity;
let admin: Identity;

async function request(url: string, method: string, body?: object, identity?: Identity) {
  const headers = new Headers();
  if (body) headers.set("content-type", "application/json");
  if (identity) {
    const jwt = await encode({ token: { sub: identity.id, email: identity.email, emailVerified: true }, secret: env.NEXTAUTH_SECRET });
    headers.set("cookie", `next-auth.session-token=${jwt}`);
  }
  return new NextRequest(`http://localhost:3101${url}`, { method, body: body && JSON.stringify(body), headers });
}

beforeAll(async () => {
  superAdmin = await db.user.findFirstOrThrow({ where: { role: { name: "SUPER_ADMIN" } } });
  const adminRole = await db.role.upsert({ where: { name: "ADMIN" }, create: { name: "ADMIN" }, update: {} });
  admin = await db.user.create({ data: { email: "pilot-admin@test.invalid", roleId: adminRole.id, onboardingCompleted: true, emailVerified: new Date() } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(teardownIsolatedDb);

async function register(email: string, identity?: Identity) {
  const response = await signup(await request("/api/auth/signup", "POST", { name: "Pilot Test", email, password, role: "SUPER_ADMIN" }, identity));
  expect(response.status).toBe(201);
  expect(response.headers.has("set-cookie")).toBe(false);
  return (await response.json()).data as Identity & { role: string; verificationToken: string; approvalRequired: boolean };
}

async function authorizeCredentials(email: string) {
  const provider = authOptions.providers.find((candidate) => candidate.id === "credentials") as unknown as {
    options: { authorize: (body: { email: string; password: string }, req: object) => Promise<unknown> };
  };
  return provider.options.authorize({ email, password }, { headers: {} });
}

describe("pilot signup review", () => {
  it("uses fail-closed defaults without changing legacy rows", () => {
    expect(initialSignupApproval("")).toBe("PENDING");
    expect(initialSignupApproval("oops")).toBe("PENDING");
    expect(initialSignupApproval("open")).toBe("APPROVED");
    expect(signupApprovalRequired({ signupApprovalStatus: "PENDING", onboardingCompleted: true, role: { name: "ADMIN" } })).toBe(true);
    expect(signupApprovalRequired({ signupApprovalStatus: null, onboardingCompleted: true, role: { name: "CLIENT" } })).toBe(false);
  });

  it("requires a verified address and super-admin review across password, NextAuth, MFA and stale sessions", async () => {
    vi.stubEnv("SIGNUP_APPROVAL_MODE", "pilot");
    const user = await register("sister-company@test.invalid", admin);
    expect(user).toMatchObject({ role: "CLIENT", approvalRequired: true });
    expect(await db.subscription.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    const decide = async (actor: Identity, action = "approve") => review(await request("/api/admin/users/approve", "PATCH", { userId: user.id, action }, actor));
    expect((await decide(admin)).status).toBe(403);
    expect((await decide(superAdmin)).status).toBe(409);
    const checkLogin = async () => login(await request("/api/auth/login", "POST", { email: user.email, password }));
    expect((await checkLogin()).status).toBe(403);
    expect(await authorizeCredentials(user.email)).toBeNull();
    const mfaRes = await mfa(await request("/api/auth/mfa-challenge", "POST", { mfaToken: createMfaChallengeToken(user.id, user.email), code: "000000" }));
    expect((await mfaRes.json()).error.code).toBe("PENDING_APPROVAL");
    expect((await onboarding(await request("/api/auth/onboarding", "POST", { completed: true }, user))).status).toBe(403);
    expect((await session(await request("/api/auth/session", "GET", undefined, user))).status).toBe(403);

    expect((await verifyEmail(await request("/api/auth/verify-email", "POST", { action: "verify", token: user.verificationToken }))).status).toBe(200);
    expect((await checkLogin()).status).toBe(403); // verification does not approve
    expect((await decide(superAdmin)).status).toBe(200);
    expect((await decide(superAdmin)).status).toBe(409); // concurrent/replayed approval does not duplicate audit
    expect((await checkLogin()).headers.has("set-cookie")).toBe(true);
    expect(await authorizeCredentials(user.email)).toBeTruthy();
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ signupApprovalStatus: "APPROVED", onboardingCompleted: false });
    expect(await db.auditLog.count({ where: { action: "USER_APPROVE", resourceId: user.id, actorUserId: superAdmin.id } })).toBe(1);
    expect((await decide(superAdmin, "suspend")).status).toBe(200);
    expect((await session(await request("/api/auth/session", "GET", undefined, user))).status).toBe(403);
  });

  it("binds verification to an unused email-verification token and its exact account", async () => {
    const pending = await register("mailbox-binding@test.invalid");
    await db.verificationToken.createMany({ data: [
      { token: "wrong-purpose", type: "PASSWORD_RESET", identifier: pending.email, userId: pending.id, expiresAt: new Date(Date.now() + 60_000) },
      { token: "wrong-address", type: "EMAIL_VERIFICATION", identifier: "different@test.invalid", userId: pending.id, expiresAt: new Date(Date.now() + 60_000) },
    ] });
    const submit = async (token: string) => verifyEmail(await request("/api/auth/verify-email", "POST", { token }));
    expect((await submit("wrong-purpose")).status).toBe(400);
    expect((await submit("wrong-address")).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: pending.id } })).emailVerified).toBeNull();
    expect((await (await submit(pending.verificationToken)).json()).data).toMatchObject({ verified: true, approvalRequired: true });
    expect((await (await submit(pending.verificationToken)).json()).data).toMatchObject({ alreadyVerified: true });
    expect(await db.auditLog.count({ where: { action: "EMAIL_VERIFIED", resourceId: pending.id } })).toBe(1);
  });

  it("blocks approval bypass via general user and role-management endpoints", async () => {
    vi.stubEnv("SIGNUP_APPROVAL_MODE", "pilot");
    const trySuper = await createUser(await request("/api/users", "POST", { email: "illegal-admin@test.invalid", password, role: "SUPER_ADMIN" }, admin));
    expect(trySuper.status).toBe(403);
    const manual = await createUser(await request("/api/users", "POST", { email: "manually-created@test.invalid", password, role: "CLIENT", signupApprovalStatus: "APPROVED" }, admin));
    expect(manual.status).toBe(201);
    const newUser = (await manual.json()).data;
    expect(newUser).toMatchObject({ signupApprovalStatus: "PENDING", emailVerified: null });
    const put = async (target: string, body: object, actor = admin) => updateUser(await request(`/api/users/${target}`, "PUT", body, actor), { params: Promise.resolve({ id: target }) });
    expect((await put(newUser.id, { role: "ADMIN", isActive: true })).status).toBe(403);
    expect((await put(newUser.id, { isActive: true }, superAdmin)).status).toBe(409);
    expect((await put(admin.id, { role: "SUPER_ADMIN" })).status).toBe(403);
    expect((await put(superAdmin.id, { password })).status).toBe(403);
    expect((await review(await request("/api/admin/users/approve", "PATCH", { userId: newUser.id, action: "reject" }, superAdmin))).status).toBe(200);
    expect((await put(newUser.id, { isActive: true }, superAdmin)).status).toBe(409);
  });

  it("does not issue unapproved OAuth sessions, and requires GitHub mailbox evidence", async () => {
    vi.stubEnv("SIGNUP_APPROVAL_MODE", "pilot");
    const signIn = authOptions.callbacks!.signIn!;
    const google = { provider: "google", providerAccountId: "pilot-google", type: "oauth" as const };
    const googleUser = { id: "provider-google", role: "CLIENT", email: "pilot-google@test.invalid" };
    expect(await signIn({ account: google, user: googleUser, profile: { email_verified: true } as never })).toBe(false);
    expect(await db.user.findUnique({ where: { email: googleUser.email } })).toMatchObject({ signupApprovalStatus: "PENDING" });
    expect(await db.account.count({ where: { providerAccountId: "pilot-google" } })).toBe(0);
    const github = { provider: "github", providerAccountId: "pilot-github", type: "oauth" as const, access_token: "test-only-fake-github-key" };
    const githubUser = { id: "provider-github", role: "CLIENT", email: "pilot-github@test.invalid" };
    const transport = vi.fn(async () => Response.json([{ email: githubUser.email, verified: false }]));
    vi.stubGlobal("fetch", transport);
    expect(await signIn({ account: github, user: githubUser })).toBe(false);
    expect(await db.user.findUnique({ where: { email: githubUser.email } })).toBeNull();
    transport.mockResolvedValueOnce(Response.json([{ email: githubUser.email, verified: true }]));
    expect(await signIn({ account: github, user: githubUser })).toBe(false);
    const pending = await db.user.findUniqueOrThrow({ where: { email: githubUser.email } });
    expect(pending.signupApprovalStatus).toBe("PENDING");
    expect((await review(await request("/api/admin/users/approve", "PATCH", { userId: pending.id, action: "approve" }, superAdmin))).status).toBe(200);
    transport.mockResolvedValueOnce(Response.json([{ email: githubUser.email, verified: true }]));
    expect(await signIn({ account: github, user: githubUser })).toBe(true);
    expect(transport).toHaveBeenCalledWith("https://api.github.com/user/emails?per_page=100", expect.objectContaining({ redirect: "error" }));
  });

  it("opens only newly created registrations when explicitly configured", async () => {
    const held = await register("before-open@test.invalid");
    vi.stubEnv("SIGNUP_APPROVAL_MODE", "open");
    const later = await register("after-open@test.invalid");
    expect(later.approvalRequired).toBe(false);
    expect(await db.user.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({ signupApprovalStatus: "APPROVED", onboardingCompleted: false });
    expect(await authorizeCredentials(later.email)).toBeTruthy();
    expect(await authorizeCredentials(held.email)).toBeNull();
  });
});
