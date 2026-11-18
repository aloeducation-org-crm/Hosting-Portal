import NextAuth, { type NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth/next";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { secureSessionCookiesEnabled } from "@/lib/session-cookie";
import { verifyUserMfaCode, openMfaSecret, sealMfaSecret } from "@/lib/mfa-challenge";
import { initialSignupApproval, signupApprovalRequired } from "@/lib/account-status";
import { needsSealing } from "@/lib/secret-store";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: string;
      mfaEnabled?: boolean;
      emailVerified?: boolean;
      onboardingCompleted?: boolean;
    };
  }
  interface User {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    role: string;
    mfaEnabled?: boolean;
    emailVerified?: boolean;
    onboardingCompleted?: boolean;
  }
  interface JWT {
    userId: string;
    email: string;
    role: string;
    mfaEnabled?: boolean;
    emailVerified?: boolean;
    onboardingCompleted?: boolean;
  }
}

const PRIVILEGED_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

function isConfiguredOAuthSecret(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  const lower = trimmed.toLowerCase();
  return !lower.includes("replace_with") && !lower.includes("placeholder") && !lower.startsWith("not-configured");
}

async function githubMailboxVerified(accessToken: string, expected: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.github.com/user/emails?per_page=100", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const addresses: unknown = await response.json();
    return Array.isArray(addresses) && addresses.some((item) =>
      item?.verified === true && typeof item.email === "string" && item.email.trim().toLowerCase() === expected);
  } catch {
    return false;
  }
}

function buildAuthProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "MFA Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { role: true, mfa: true },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        // Check if locked. A lock with an expired `lockedUntil` is lifted; a
        // lock without one (or still inside its window) blocks sign-in — a
        // null `lockedUntil` must never silently disable the lockout.
        if (user.isLocked) {
          if (user.lockedUntil && new Date() > user.lockedUntil) {
            await db.user.update({
              where: { id: user.id },
              data: { isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
            });
          } else {
            return null;
          }
        }

        if (!user.isActive) {
          return null;
        }

        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) {
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: { increment: 1 },
              ...(user.failedLoginAttempts >= 4
                ? { isLocked: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
                : {}),
            },
          });
          return null;
        }

        if (signupApprovalRequired(user)) return null;

        // MFA enforcement gate: when TOTP MFA is enabled, credentials sign-in
        // requires a valid TOTP or backup code (never silently bypasses MFA).
        if (user.mfa?.isEnabled && user.mfa?.secret) {
          const mfaCode = credentials.mfaCode?.trim() ?? "";
          if (!mfaCode) {
            return null;
          }
          const mfaCheck = await verifyUserMfaCode({
            storedSecret: user.mfa.secret,
            email: user.email,
            code: mfaCode,
            backupCodesJson: user.mfa.backupCodes,
          });
          if (!mfaCheck.valid) {
            await db.user.update({
              where: { id: user.id },
              data: {
                failedLoginAttempts: { increment: 1 },
                ...(user.failedLoginAttempts >= 4
                  ? { isLocked: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
                  : {}),
              },
            });
            return null;
          }
          const mfaUpdate: Record<string, unknown> = { lastUsedAt: new Date() };
          if (needsSealing(user.mfa.secret)) {
            mfaUpdate.secret = sealMfaSecret(openMfaSecret(user.mfa.secret));
          }
          if (mfaCheck.method === "backup_code") {
            mfaUpdate.backupCodes = mfaCheck.remainingBackupCodesJson ?? null;
          }
          await db.userMfa.update({
            where: { userId: user.id },
            data: mfaUpdate,
          });
        }

        await db.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            isLocked: false,
            lockedUntil: null,
            lastLoginAt: new Date(),
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role.name,
          mfaEnabled: user.mfa?.isEnabled ?? false,
          emailVerified: !!user.emailVerified,
          onboardingCompleted: user.onboardingCompleted ?? false,
        };
      },
    }),
  ];

  // Register OAuth providers ONLY when real credentials are configured;
  // never register dummy placeholder client secrets.
  if (isConfiguredOAuthSecret(env.GOOGLE_CLIENT_ID) && isConfiguredOAuthSecret(env.GOOGLE_CLIENT_SECRET)) {
    providers.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    );
  }

  if (isConfiguredOAuthSecret(env.GITHUB_CLIENT_ID) && isConfiguredOAuthSecret(env.GITHUB_CLIENT_SECRET)) {
    providers.push(
      GitHubProvider({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      }),
    );
  }

  return providers;
}

export const authOptions: NextAuthOptions = {
  providers: buildAuthProviders(),
  session: {
    strategy: "jwt",
    maxAge: 86400,
  },
  // Keep AuthHandler's cookie convention identical to the custom login/signup
  // routes and to getToken()'s NEXTAUTH_URL-based default in the edge gate.
  useSecureCookies: secureSessionCookiesEnabled(),
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account && (account.provider === "google" || account.provider === "github")) {
        if (!user.email) return false;
        const normalizedEmail = user.email.toLowerCase().trim();

        // Require provider-verified email for Google OAuth
        if (account.provider === "google") {
          const emailVerifiedClaim = (profile as { email_verified?: boolean } | undefined)?.email_verified;
          if (emailVerifiedClaim === false) return false;
        }

        // First check whether this exact OAuth identity is already linked
        const existingAccount = await db.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          include: {
            user: { include: { role: true, mfa: true } },
          },
        });

        let dbUser = existingAccount?.user ?? null;

        if (!dbUser) {
          // NextAuth's GitHub profile alone is not proof of ownership of the
          // selected email. Confirm it before creating or linking any new row.
          if (account.provider === "github") {
            if (!account.access_token || !await githubMailboxVerified(account.access_token, normalizedEmail)) return false;
          } else if ((profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
            return false;
          }
          const emailMatch = await db.user.findUnique({
            where: { email: normalizedEmail },
            include: { role: true, mfa: true },
          });

          if (emailMatch) {
            // Never silently auto-link an unlinked OAuth identity onto an existing
            // privileged account, MFA-protected account, or unverified local account.
            if (
              PRIVILEGED_ROLES.has(emailMatch.role.name) ||
              emailMatch.mfa?.isEnabled ||
              !emailMatch.emailVerified
            ) {
              return false;
            }
            dbUser = emailMatch;
          } else {
            let clientRole = await db.role.findUnique({ where: { name: "CLIENT" } });
            if (!clientRole) {
              clientRole = await db.role.findUnique({ where: { name: "VIEWER" } });
            }
            if (!clientRole) {
              clientRole = await db.role.create({
                data: { name: "CLIENT", description: "Client access" },
              });
            }

            dbUser = await db.user.create({
              data: {
                email: normalizedEmail,
                name: user.name ?? normalizedEmail.split("@")[0],
                image: user.image ?? null,
                roleId: clientRole.id,
                emailVerified: new Date(),
                onboardingCompleted: false,
                signupApprovalStatus: initialSignupApproval(),
              },
              include: { role: true, mfa: true },
            });
          }
        }

        // Enforce active, lockout, approval, and MFA gates consistently for OAuth too
        if (!dbUser.isActive) return false;
        if (dbUser.isLocked) {
          if (dbUser.lockedUntil && new Date() > dbUser.lockedUntil) {
            await db.user.update({
              where: { id: dbUser.id },
              data: { isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
            });
          } else {
            return false;
          }
        }

        // OAuth callback does not execute TOTP verification, so MFA-enabled accounts
        // must authenticate through the password + MFA challenge flow.
        if (dbUser.mfa?.isEnabled) {
          return false;
        }

        if (signupApprovalRequired(dbUser)) return false;

        await db.account.upsert({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          update: {
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            token_type: account.token_type,
            scope: account.scope,
            id_token: account.id_token,
          },
          create: {
            userId: dbUser.id,
            type: account.type,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            token_type: account.token_type,
            scope: account.scope,
            id_token: account.id_token,
          },
        });

        user.id = dbUser.id;
        user.role = dbUser.role.name;
        user.mfaEnabled = dbUser.mfa?.isEnabled ?? false;
        user.emailVerified = !!dbUser.emailVerified;
        user.onboardingCompleted = dbUser.onboardingCompleted;
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        token.userId = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = user.role || "CLIENT";
        token.mfaEnabled = user.mfaEnabled ?? false;
        token.emailVerified = user.emailVerified ?? false;
        token.onboardingCompleted = user.onboardingCompleted ?? false;
        token.emailVerifiedCheckedAt = Date.now();
      } else if (token.sub) {
        const checkedAt = Number(token.emailVerifiedCheckedAt ?? 0);
        if (Date.now() - checkedAt > 60_000) {
          try {
            const dbUser = await db.user.findUnique({
              where: { id: String(token.sub) },
              include: { role: true, mfa: true },
            });
            if (dbUser) {
              token.emailVerified = dbUser.emailVerified !== null;
              token.role = dbUser.role.name;
              token.mfaEnabled = dbUser.mfa?.isEnabled ?? false;
              token.isActive = dbUser.isActive;
              token.isLocked = dbUser.isLocked;
            }
            token.emailVerifiedCheckedAt = Date.now();
          } catch {
            // A transient database error must not sign the user out; the previous
            // claim stands and the next request retries.
          }
        }
      }
      if (trigger === "update" && session) {
        if (session.onboardingCompleted !== undefined) {
          token.onboardingCompleted = session.onboardingCompleted;
        }
        if (session.name !== undefined) {
          token.name = session.name;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId || token.sub) as string;
        session.user.email = token.email as string;
        session.user.role = (token.role as string) || "CLIENT";
        session.user.mfaEnabled = (token.mfaEnabled as boolean) ?? false;
        session.user.emailVerified = (token.emailVerified as boolean) ?? false;
        session.user.onboardingCompleted = (token.onboardingCompleted as boolean) ?? false;
      }
      return session;
    },
  },
  secret: env.NEXTAUTH_SECRET,
};

const nextAuthHandler = NextAuth(authOptions);

export const handlers = {
  GET: nextAuthHandler,
  POST: nextAuthHandler,
};

export async function auth() {
  return getServerSession(authOptions);
}
