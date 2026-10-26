'use client';

import Header from '@/components/alolabs/Header';
import Footer from '@/components/alolabs/Footer';

export default function TermsOfServicePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Header />
      <main className="mx-auto max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Effective Date: October 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed text-slate-700">
          <h2 className="text-lg font-semibold text-slate-900">1. Acceptable Use</h2>
          <p>
            Accounts on ALO Labs Hosting Portal may be used solely for lawful web, API, database, and AI
            workloads. Unauthorized network scanning, malware distribution, credential abuse, and cross-tenant
            probing are strictly prohibited and result in immediate suspension.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">2. Account Security</h2>
          <p>
            You are responsible for safeguarding account credentials, SSH keys, webhook secrets, and API tokens,
            and for enabling multi-factor authentication (TOTP) on administrative accounts.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">3. Backups & Service Continuity</h2>
          <p>
            Automated and manual backups are provided as operational safeguards. Customers should verify backup
            restores periodically before destructive application or database changes.
          </p>

          <h2 className="text-lg font-semibold text-slate-900">4. Open-Source & Third-Party Software</h2>
          <p>
            Self-hosted workloads deployed through the portal remain subject to their respective upstream
            open-source or commercial licenses.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
