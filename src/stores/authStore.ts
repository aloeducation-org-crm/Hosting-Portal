import { create } from "zustand";

export interface User {
  id: string;
  name: string | null;
  email: string;
  role?: string;
  permissions?: string[];
  isActive?: boolean;
  plan?: string;
  emailVerified?: boolean;
  onboardingCompleted?: boolean;
  onboardingStep?: number;
  companyName?: string | null;
}

export interface MfaChallengeError extends Error {
  requiresMfa: true;
  mfaToken: string;
  method: string;
}

export function isMfaChallengeError(err: unknown): err is MfaChallengeError {
  return Boolean(
    err &&
      typeof err === "object" &&
      "requiresMfa" in err &&
      (err as MfaChallengeError).requiresMfa === true &&
      typeof (err as MfaChallengeError).mfaToken === "string",
  );
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  completeMfaLogin: (mfaToken: string, mfaCode: string) => Promise<User>;
  signup: (
    name: string,
    email: string,
    password: string,
    options?: { role?: "CLIENT" | "RESELLER"; companyName?: string }
  ) => Promise<User & { verificationToken?: string }>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  setAuth: (user: User, token?: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (user, token) => {
    set({
      user,
      token: token ?? "session",
      isAuthenticated: true,
      isLoading: false,
    });
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const body = await res.json();
      if (!res.ok || !body?.success) {
        const errMsg = body?.message || body?.error?.message || "Invalid email or password";
        throw new Error(errMsg);
      }

      const userData = body.data;
      if (userData?.requiresMfa && typeof userData.mfaToken === "string") {
        set({ isLoading: false });
        const mfaErr = new Error("Multi-factor verification required") as MfaChallengeError;
        mfaErr.requiresMfa = true;
        mfaErr.mfaToken = userData.mfaToken;
        mfaErr.method = userData.method || "totp";
        throw mfaErr;
      }

      const user: User = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        permissions: userData.permissions,
        plan: userData.plan || "starter",
        emailVerified: userData.emailVerified,
        onboardingCompleted: userData.onboardingCompleted,
        onboardingStep: userData.onboardingStep,
      };

      set({
        user,
        token: "session",
        isAuthenticated: true,
        isLoading: false,
      });

      return user;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  completeMfaLogin: async (mfaToken: string, mfaCode: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/mfa-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, mfaCode }),
        credentials: "include",
      });

      const body = await res.json();
      if (!res.ok || !body?.success) {
        const errMsg = body?.message || body?.error?.message || "Invalid verification code";
        throw new Error(errMsg);
      }

      const userData = body.data;
      const user: User = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        permissions: userData.permissions,
        plan: userData.plan || "starter",
        emailVerified: userData.emailVerified,
        onboardingCompleted: userData.onboardingCompleted,
        onboardingStep: userData.onboardingStep,
      };

      set({
        user,
        token: "session",
        isAuthenticated: true,
        isLoading: false,
      });

      return user;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  signup: async (name: string, email: string, password: string, options) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          role: options?.role || "CLIENT",
          companyName: options?.companyName,
        }),
        credentials: "include",
      });

      const body = await res.json();
      if (!res.ok || !body?.success) {
        const errMsg = body?.message || body?.error?.message || "Registration failed";
        throw new Error(errMsg);
      }

      const userData = body.data;
      const user: User & { verificationToken?: string } = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        permissions: userData.permissions,
        plan: userData.plan || "starter",
        emailVerified: userData.emailVerified,
        onboardingCompleted: userData.onboardingCompleted,
        onboardingStep: userData.onboardingStep,
        verificationToken: userData.verificationToken,
      };

      set({
        user,
        token: "session",
        isAuthenticated: Boolean(userData.onboardingCompleted),
        isLoading: false,
      });

      return user;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore network error on logout
    }
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
      });
      if (res.ok) {
        const body = await res.json();
        const userData = body.data;
        set({
          user: {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role,
            permissions: userData.permissions,
            isActive: userData.isActive,
            plan: userData.plan || "starter",
            emailVerified: userData.emailVerified,
            onboardingCompleted: userData.onboardingCompleted,
            onboardingStep: userData.onboardingStep,
            companyName: userData.companyName,
          },
          token: "session",
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
