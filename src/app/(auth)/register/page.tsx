"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  User,
  Mail,
  Lock,
  Building2,
  Eye,
  EyeOff,
  Github,
  Chrome,
  CheckCircle2,
} from "lucide-react";

const registerSchema = z
  .object({
    name: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Enter a valid email address"),
    companyName: z.string().optional(),
    role: z.enum(["CLIENT", "RESELLER"]),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirmPassword: z.string(),
    agreed: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Terms of Service" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

function getPasswordStrength(pwd: string): number {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return score;
}

export default function RegisterPage() {
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState<"CLIENT" | "RESELLER">("CLIENT");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const pwdStrength = getPasswordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const parsed = registerSchema.safeParse({
      name: name.trim(),
      email: email.trim(),
      companyName: companyName.trim() || undefined,
      role,
      password,
      confirmPassword,
      agreed,
    });

    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const nextErrors: Record<string, string> = {};
      for (const [k, v] of Object.entries(flat)) {
        if (v && v[0]) nextErrors[k] = v[0];
      }
      setFieldErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      const result = await signup(
        parsed.data.name,
        parsed.data.email,
        parsed.data.password,
        {
          role: parsed.data.role,
          companyName: parsed.data.companyName,
        }
      );

      const query = new URLSearchParams({
        email: parsed.data.email,
        ...(result.verificationToken ? { token: result.verificationToken } : {}),
      });
      router.push(`/verify-email?${query.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-slate-200 shadow-xl shadow-slate-200/50">
      <CardHeader className="space-y-1 text-center pb-3">
        <div className="flex justify-center mb-2 lg:hidden">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E8501A]">
            <Zap className="h-6 w-6 text-white" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900">
          Create your ALO Labs account
        </CardTitle>
        <CardDescription className="text-slate-500">
          Start with our $0 free tier — no credit card required
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* OAuth Signup */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
            disabled={loading}
            className="w-full border-slate-200"
          >
            <Chrome className="mr-2 h-4 w-4 text-[#E8501A]" />
            Google
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => signIn("github", { callbackUrl: "/onboarding" })}
            disabled={loading}
            className="w-full border-slate-200"
          >
            <Github className="mr-2 h-4 w-4" />
            GitHub
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-slate-400">
              Or register with email
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          {/* Role selector */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setRole("CLIENT")}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                role === "CLIENT"
                  ? "border-[#E8501A] bg-[#FFF7ED]/70 ring-1 ring-[#E8501A]"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-bold text-slate-900">
                  Client Account
                </span>
                {role === "CLIENT" && (
                  <CheckCircle2 className="h-4 w-4 text-[#E8501A]" />
                )}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5">
                Deploy sites, databases &amp; AI apps
              </span>
            </button>

            <button
              type="button"
              onClick={() => setRole("RESELLER")}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                role === "RESELLER"
                  ? "border-[#E8501A] bg-[#FFF7ED]/70 ring-1 ring-[#E8501A]"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-bold text-slate-900">
                  Reseller Partner
                </span>
                {role === "RESELLER" && (
                  <CheckCircle2 className="h-4 w-4 text-[#E8501A]" />
                )}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5">
                Manage clients &amp; earn commissions
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="name">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="name"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  className="pl-9"
                />
              </div>
              {fieldErrors.name && (
                <p className="text-xs text-red-600">{fieldErrors.name}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="companyName">Organization (Optional)</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="companyName"
                  placeholder="Acme Cloud"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={loading}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                id="email"
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="pl-9"
              />
            </div>
            {fieldErrors.email && (
              <p className="text-xs text-red-600">{fieldErrors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="8+ chars, 1 upper, 1 num"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="pl-9 pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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

            <div className="space-y-1">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="pl-9"
                />
              </div>
              {fieldErrors.confirmPassword && (
                <p className="text-xs text-red-600">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>

          {password.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1 flex-1 rounded-full ${
                      idx < pwdStrength
                        ? pwdStrength <= 2
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                        : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <Checkbox
                checked={agreed}
                onCheckedChange={(checked) => setAgreed(checked === true)}
              />
              <span>
                I agree to the ALO Labs Terms of Service and Acceptable Use
                Policy
              </span>
            </label>
            {fieldErrors.agreed && (
              <p className="text-xs text-red-600">{fieldErrors.agreed}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Account &amp; Continue
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 border-t border-slate-100 pt-4 text-center">
        <p className="text-sm text-slate-600">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-[#E8501A] hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
