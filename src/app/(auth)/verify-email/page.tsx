"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  MailCheck,
  Loader2,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  KeyRound,
} from "lucide-react";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const initialToken = searchParams.get("token") || "";

  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState(initialToken);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialToken) return;
    let active = true;
    (async () => {
      if (active) await verifyTokenCode(initialToken);
    })();
    return () => {
      active = false;
    };
  }, [initialToken]);

  async function verifyTokenCode(codeToVerify: string) {
    if (!codeToVerify.trim()) {
      setError("Please enter your verification token");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          token: codeToVerify.trim(),
          email: email.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.message || "Invalid or expired verification token");
        return;
      }
      setVerified(true);
      setMessage(body.message || "Your email has been verified!");
    } catch {
      setError("Failed to verify email. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email.trim()) {
      setError("Please enter your email address to resend the verification link");
      return;
    }
    setResending(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resend",
          email: email.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.message || "Could not resend verification email");
        return;
      }
      if (body.data?.alreadyVerified) {
        setVerified(true);
        setMessage("Your email address is already verified.");
      } else {
        if (body.data?.verificationToken) {
          setToken(body.data.verificationToken);
        }
        setMessage(
          "A new verification email has been dispatched via SMTP. Check your inbox or use the token below."
        );
      }
    } catch {
      setError("Failed to resend verification email.");
    } finally {
      setResending(false);
    }
  }

  return (
    <Card className="border-slate-200 shadow-xl shadow-slate-200/50">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF7ED] text-[#E8501A]">
          {verified ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          ) : (
            <MailCheck className="h-6 w-6" />
          )}
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900">
          {verified ? "Email Verified!" : "Verify your email address"}
        </CardTitle>
        <CardDescription className="text-slate-500">
          {verified
            ? "Your ALO Labs Hosting account is verified and ready."
            : "We sent a verification token via SMTP. Paste your token or click Verify below."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {message && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {verified ? (
          <div className="space-y-3 pt-2">
            <Button
              onClick={() => router.push("/onboarding")}
              className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
            >
              Continue to Onboarding Wizard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="w-full"
            >
              Go directly to Dashboard
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyTokenCode(token);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="verify-email">Email Address</Label>
              <Input
                id="verify-email"
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="verify-token">Verification Token</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="verify-token"
                  placeholder="Paste verification token from email"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-9 font-mono text-xs"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify Email Now
            </Button>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResend}
                disabled={resending}
                className="text-xs text-slate-600 hover:text-[#E8501A]"
              >
                {resending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Resend SMTP Verification
              </Button>

              <Link
                href="/onboarding"
                className="text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Skip for now &rarr;
              </Link>
            </div>
          </form>
        )}
      </CardContent>

      <CardFooter className="justify-center border-t border-slate-100 pt-4">
        <Link
          href="/login"
          className="text-xs font-medium text-slate-500 hover:text-[#E8501A]"
        >
          &larr; Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
