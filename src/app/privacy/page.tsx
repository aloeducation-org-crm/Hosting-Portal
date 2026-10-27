'use client';

import Header from '@/components/alolabs/Header';
import Footer from '@/components/alolabs/Footer';

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Header />
      <main className="mx-auto max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Effective Date: October 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed text-slate-700">
          <h2 className="text-lg font-semibold text-slate-900">1. Data We Process</h2>
          <p>
            ALO Labs Hosting Portal processes account credentials (hashed using industry-standard algorithms),
            hosted domain and deployment metadata, audit logs, and billing records solely to operate, secure,
            and support your hosting infrastructure.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">2. Security & Tenant Isolation</h2>
          <p>
            Hosted websites, environment variables, backups, SSL certificates, and self-hosted AI agent
            containers are logically isolated per account. Secrets stored by the platform are encrypted at
            rest using AES-256-GCM and redacted from application logs.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">3. Optional AI Integrations</h2>
          <p>
            Prompts submitted to AI assistants are processed either by your self-hosted inference runtime or
            by explicitly configured OpenAI-compatible providers. No telemetry or customer secrets are shared
            with third parties unless an external provider is enabled by the administrator.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">4. Cookies & Sessions</h2>
          <p>
            We use strictly necessary authentication and CSRF-protection cookies to maintain signed-in sessions.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
