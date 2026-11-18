"use client";

import React, { useState } from "react";
import Link from "next/link";
import { z } from "zod";
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
import { Loader2, Mail, Zap, ShieldAlert, CheckCircle2, ArrowLeft } from "lucide-react";

const formSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldError(undefined);

    const parsed = formSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.email?.[0]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: parsed.data.email }),
      });
      // The endpoint intentionally returns the same response whether or not the
      // account exists. Only transport-level failures are surfaced.
      if (!res.ok && res.status >= 500) {
        setError("Something went wrong on our side. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-slate-200 shadow-xl shadow-slate-200/50">
      <CardHeader className="space-y-1 text-center pb-4">
        <div className="flex justify-center mb-2 lg:hidden">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E8501A]">
            <Zap className="h-6 w-6 text-white" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900">
          Reset your password
        </CardTitle>
        <CardDescription className="text-slate-500">
          Enter the email for your account to request a reset link
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {sent ? (
          <Alert className="py-3 border-emerald-200 bg-emerald-50 text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription>
              If an account exists for <strong>{email.trim()}</strong>, the reset
              request has been received. If delivery is configured, the link will
              arrive by email and expire in 30 minutes. Check your spam folder.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {error && (
              <Alert variant="destructive" className="py-2.5">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@alolabs.net"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={loading}
                    className="pl-9"
                  />
                </div>
                {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send reset link
              </Button>
            </form>
          </>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 border-t border-slate-100 pt-4 text-center">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
