import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: string;
      mfaEnabled?: boolean;
    };
  }
  interface User {
    id: string;
    email: string;
    name?: string | null;
    role: string;
    mfaEnabled?: boolean;
  }
  interface JWT {
    userId: string;
    email: string;
    role: string;
    mfaEnabled?: boolean;
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
          where: { email: credentials.email },
          include: { role: true, mfa: true },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        // Check if locked and if lock period has expired
        if (user.isLocked && user.lockedUntil) {
          if (new Date() > user.lockedUntil) {
            // Lock expired — unlock the account
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
          role: user.role.name,
          mfaEnabled: user.mfa?.isEnabled ?? false,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 86400,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.email = user.email;
        token.role = user.role;
        token.mfaEnabled = user.mfaEnabled ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.email = token.email as string;
        session.user.role = token.role as string;
        session.user.mfaEnabled = (token.mfaEnabled as boolean) ?? false;
      }
      return session;
    },
  },
  secret: env.NEXTAUTH_SECRET,
};
