'use client'

import { Check, ArrowRight, Mail } from 'lucide-react'

export default function EmailSection() {
  return (
    <section className="w-full bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            Smarter email
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Email your audience with confidence
          </h2>
        </div>

        {/* Two Subsections */}
        <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-2">
          {/* Subsection 1 — Business Email */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="size-5 text-[#E8501A]" />
              <span className="text-sm font-medium text-[#E8501A]">Business</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">
              Build trust with a professional business email
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Create a custom email address that matches your domain name. Look
              professional from day one and build credibility with every email
              you send.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Build trust with a branded business email',
                'Seamless email access across all apps and devices',
                'Private, protected, and always online',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#E8501A]/10">
                    <Check className="size-3 text-[#E8501A]" />
                  </div>
                  <span className="text-sm text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
            <a
              href="/dashboard/email"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
            >
              Set up business email
              <ArrowRight className="size-4" />
            </a>

            {/* Decorative gradient placeholder */}
            <div className="mt-8 overflow-hidden rounded-xl bg-gradient-to-br from-[#E8501A]/80 to-[#3B82F6] aspect-[16/9] relative">
              {/* Mock email UI elements */}
              <div className="absolute inset-0 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-white/30" />
                  <div className="h-3 w-3 rounded-full bg-white/20" />
                  <div className="h-3 w-3 rounded-full bg-white/20" />
                </div>
                <div className="mt-2 space-y-2 flex-1">
                  <div className="h-2.5 w-3/4 rounded bg-white/25" />
                  <div className="h-2.5 w-1/2 rounded bg-white/20" />
                  <div className="h-2.5 w-5/6 rounded bg-white/15" />
                  <div className="h-2.5 w-2/3 rounded bg-white/15" />
                  <div className="h-2.5 w-4/5 rounded bg-white/10" />
                </div>
              </div>
            </div>
          </div>

          {/* Subsection 2 — Email Marketing */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="size-5 text-[#E8501A]" />
              <span className="text-sm font-medium text-[#E8501A]">Marketing</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">
              Grow your business with AI-powered email marketing
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Schedule emails, automate campaigns, and reach your audience at the
              right time. Reach by ALO Labs makes it easy to create, send, and
              track professional email marketing campaigns.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Design and write emails with AI',
                'Your logo and colors, auto-applied',
                'No coding required',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#E8501A]/10">
                    <Check className="size-3 text-[#E8501A]" />
                  </div>
                  <span className="text-sm text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
            <a
              href="/dashboard/email"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
            >
              Start email marketing with Reach
              <ArrowRight className="size-4" />
            </a>

            {/* Decorative gradient placeholder */}
            <div className="mt-8 overflow-hidden rounded-xl bg-gradient-to-br from-[#0A5CFF]/80 to-[#60A5FA] aspect-[16/9] relative">
              {/* Mock email campaign UI elements */}
              <div className="absolute inset-0 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-white/30" />
                  <div className="h-3 w-3 rounded-full bg-white/20" />
                  <div className="h-3 w-3 rounded-full bg-white/20" />
                </div>
                <div className="mt-2 flex-1 flex flex-col gap-3">
                  <div className="h-16 rounded-lg bg-white/20 p-2">
                    <div className="h-2 w-1/2 rounded bg-white/40 mb-1.5" />
                    <div className="h-1.5 w-3/4 rounded bg-white/25 mb-1" />
                    <div className="h-1.5 w-2/3 rounded bg-white/25" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-2.5 w-20 rounded-full bg-white/25" />
                    <div className="h-2.5 w-16 rounded-full bg-white/20" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-auto">
                    <div className="h-12 rounded-lg bg-white/15" />
                    <div className="h-12 rounded-lg bg-white/15" />
                    <div className="h-12 rounded-lg bg-white/15" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}