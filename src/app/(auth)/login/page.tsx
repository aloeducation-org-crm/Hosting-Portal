"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { useAuthStore, isMfaChallengeError } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Zap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Github,
  Chrome,
  ShieldAlert,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";

const loginFormSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

/** Allow only safe same-origin relative paths for post-login redirect. */
function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/dashboard";
  }
  if (/[\r\n\0]/.test(trimmed)) return "/dashboard";
  return trimmed;
}

function LoginContent({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const completeMfaLogin = useAuthStore((s) => s.completeMfaLogin);
  const safeCallback = safeRedirectPath(callbackUrl);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "github" | null>(null);
  const [enabledOAuth, setEnabledOAuth] = useState<{ google: boolean; github: boolean }>({
    google: false,
    github: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.data || !Array.isArray(body.data)) return;
        const list = body.data as Array<{ id: string; enabled: boolean }>;
        setEnabledOAuth({
          google: Boolean(list.find((p) => p.id === "google")?.enabled),
          github: Boolean(list.find((p) => p.id === "github")?.enabled),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function navigateAfterLogin(user: { onboardingCompleted?: boolean; role?: string }) {
    if (user.onboardingCompleted === false) {
      router.push("/onboarding");
    } else if (
      (user.role === "SUPER_ADMIN" || user.role === "ADMIN") &&
      safeCallback === "/dashboard"
    ) {
      router.push("/dashboard");
    } else {
      router.push(safeCallback);
    }
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const parsed = loginFormSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.[0],
        password: flat.password?.[0],
      });
      return;
    }

    setLoading(true);
    try {
      const user = await login(parsed.data.email, parsed.data.password);
      navigateAfterLogin(user);
    } catch (err) {
      if (isMfaChallengeError(err)) {
        setMfaToken(err.mfaToken);
        setMfaCode("");
      } else {
        setError(err instanceof Error ? err.message : "Invalid email or password");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError("");
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      setError("Enter your 6-digit authenticator code or a backup code");
      return;
    }

    setLoading(true);
    try {
      const user = await completeMfaLogin(mfaToken, trimmed);
      navigateAfterLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid verification code");
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: "google" | "github") {
    setError("");
    setOauthLoading(provider);
    try {
      await signIn(provider, { callbackUrl: safeCallback });
    } catch {
      setError(`Failed to start ${provider} authentication`);
      setOauthLoading(null);
    }
  }

  const hasAnyOAuth = enabledOAuth.google || enabledOAuth.github;

  return (
    <Card className="border-slate-200 shadow-xl shadow-slate-200/50">
      <CardHeader className="space-y-1 text-center pb-4">
        <div className="flex justify-center mb-2 lg:hidden">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E8501A]">
            <Zap className="h-6 w-6 text-white" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900">
          {mfaToken ? "Two-Factor Verification" : "Sign in to ALO Labs"}
        </CardTitle>
        <CardDescription className="text-slate-500">
          {mfaToken
            ? "Enter the 6-digit code from your authenticator app or a recovery backup code"
            : "Sign in to the ALO Labs Hosting & Operations Control Plane"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" className="py-2.5">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {mfaToken ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="mfa-code">Verification Code</Label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456 or backup code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={loading}
                  className="pl-9 tracking-widest"
                  autoFocus
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify &amp; Sign In
            </Button>

            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setMfaToken(null);
                setMfaCode("");
                setError("");
              }}
              className="w-full text-slate-600"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to password sign-in
            </Button>
          </form>
        ) : (
          <>
            {hasAnyOAuth && (
              <>
                <div className={`grid gap-3 ${enabledOAuth.google && enabledOAuth.github ? "grid-cols-2" : "grid-cols-1"}`}>
                  {enabledOAuth.google && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOAuthSignIn("google")}
                      disabled={loading || oauthLoading !== null}
                      className="w-full border-slate-200 hover:bg-slate-50"
                    >
                      {oauthLoading === "google" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Chrome className="mr-2 h-4 w-4 text-[#E8501A]" />
                      )}
                      Google
                    </Button>
                  )}
                  {enabledOAuth.github && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOAuthSignIn("github")}
                      disabled={loading || oauthLoading !== null}
                      className="w-full border-slate-200 hover:bg-slate-50"
                    >
                      {oauthLoading === "github" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Github className="mr-2 h-4 w-4 text-slate-800" />
                      )}
                      GitHub
                    </Button>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-slate-400">
                      Or continue with email
                    </span>
                  </div>
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@alolabs.net"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={loading}
                    className="pl-9"
                  />
                </div>
                {fieldErrors.email && (
                  <p className="text-xs text-red-600">{fieldErrors.email}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-[#E8501A] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={loading}
                    className="pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="text-xs text-red-600">{fieldErrors.password}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In to Portal
              </Button>
            </form>
          </>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 border-t border-slate-100 pt-4 text-center">
        <p className="text-sm text-slate-600">
          Need portal access?{" "}
          <Link
            href="/register"
            className="font-semibold text-[#E8501A] hover:underline"
          >
            Request an account
          </Link>
        </p>
        <Link
          href="/verify-email"
          className="text-xs text-slate-500 hover:text-[#E8501A] hover:underline"
        >
          Need to verify your email?
        </Link>
      </CardFooter>
    </Card>
  );
}

function LoginPageShell() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  return <LoginContent callbackUrl={callbackUrl} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginContent callbackUrl="/dashboard" />}>
      <LoginPageShell />
    </Suspense>
  );
}
