import NextAuth, { type NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth/next";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

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

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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

        // Check if locked and if lock period has expired
        if (user.isLocked && user.lockedUntil) {
          if (new Date() > user.lockedUntil) {
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
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID || "google-oauth-client-id",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "google-oauth-client-secret",
    }),
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID || "github-oauth-client-id",
      clientSecret: env.GITHUB_CLIENT_SECRET || "github-oauth-client-secret",
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 86400,
  },
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account && (account.provider === "google" || account.provider === "github")) {
        if (!user.email) return false;
        const normalizedEmail = user.email.toLowerCase().trim();
        let dbUser = await db.user.findUnique({
          where: { email: normalizedEmail },
          include: { role: true },
        });

        if (!dbUser) {
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
              lastLoginAt: new Date(),
            },
            include: { role: true },
          });
        }

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
