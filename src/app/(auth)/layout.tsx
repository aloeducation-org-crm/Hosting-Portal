import React from "react";
import Link from "next/link";
import { Zap, ShieldCheck, Globe, Cpu } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-12 bg-[#F8FAFC]">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:col-span-5 flex-col justify-between bg-[#0F172A] text-white p-10 relative overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-[#E8501A]/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8501A] shadow-lg shadow-[#E8501A]/30">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-white">
                ALO Labs
              </span>
              <span className="block text-xs text-slate-400">
                Cloud Hosting &amp; AI Platform
              </span>
            </div>
          </Link>
        </div>

        <div className="relative z-10 space-y-6 my-auto py-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-orange-300">
            <Cpu className="h-3.5 w-3.5" />
            Next.js 16 + LiteLLM AI + Cloudflare Edge
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Deploy production web apps, databases, and AI sites in seconds.
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Built for developers, agencies, and resellers. Zero-config SSL,
            automated daily backups, PostgreSQL/MySQL provisioning, and
            AI-assisted deployments on Ubuntu edge infrastructure.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <ShieldCheck className="h-5 w-5 text-[#E8501A] mb-2" />
              <div className="text-sm font-semibold">Enterprise Security</div>
              <div className="text-xs text-slate-400 mt-0.5">
                AES-256 secrets, RBAC, MFA &amp; Cloudflare DDoS protection
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <Globe className="h-5 w-5 text-emerald-400 mb-2" />
              <div className="text-sm font-semibold">Instant Global Edge</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Custom domains, automatic SSL &amp; Git push-to-deploy
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-t border-white/10 pt-6">
          <span>&copy; {new Date().getFullYear()} ALO Labs Hosting Portal</span>
          <span>hosting.alolabs.net</span>
        </div>
      </div>

      {/* Right form container */}
      <div className="lg:col-span-7 flex flex-col justify-center items-center p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
