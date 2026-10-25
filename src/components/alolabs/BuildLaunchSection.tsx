'use client'

import { ArrowRight } from 'lucide-react'

export default function BuildLaunchSection() {
  return (
    <section className="bg-white py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Label */}
        <span className="inline-block px-3 py-1 rounded-full bg-[#E8501A]/10 text-[#E8501A] text-sm font-medium mb-4">
          Build and launch
        </span>

        {/* Heading */}
        <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-gray-900 leading-tight mb-12 max-w-3xl">
          From idea to online, quicker and slicker
        </h2>

        {/* Two Feature Blocks */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Block 1 — ALO Builder */}
          <div className="group relative bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 hover:shadow-lg hover:border-gray-300 transition-all duration-300 overflow-hidden">
            {/* Tab Badge */}
            <span className="inline-block px-3 py-1 rounded-full bg-[#E8501A]/10 text-[#E8501A] text-xs font-semibold uppercase tracking-wide mb-5">
              ALO Builder
            </span>

            {/* Content + Decorative side */}
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="flex-1 min-w-0">
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
                  Create your website or web app today
                </h3>
                <p className="text-gray-500 leading-relaxed mb-6 text-sm sm:text-base">
                  Describe your vision and let AI build a stunning, fully
                  functional website in minutes. No coding required — just
                  prompt, preview, and publish. ALO Builder handles the design,
                  layout, and even optimizes for performance out of the box.
                </p>
                <a
                  href="/dashboard/websites/new"
                  className="inline-flex items-center gap-2 text-[#E8501A] font-semibold text-sm hover:underline transition-colors"
                >
                  Create with ALO Builder
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </a>
              </div>

              {/* Decorative Gradient Placeholder */}
              <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                <div className="w-36 h-44 rounded-2xl bg-gradient-to-br from-[#E8501A] via-[#0A5CFF] to-[#93C5FD] opacity-90 shadow-lg" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Block 2 — Quick-start WordPress */}
          <div className="group relative bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 hover:shadow-lg hover:border-gray-300 transition-all duration-300 overflow-hidden">
            {/* Tab Badge */}
            <span className="inline-block px-3 py-1 rounded-full bg-[#E8501A]/10 text-[#E8501A] text-xs font-semibold uppercase tracking-wide mb-5">
              Quick-start WordPress
            </span>

            {/* Content + Decorative side */}
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="flex-1 min-w-0">
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
                  WordPress without the complexity
                </h3>
                <p className="text-gray-500 leading-relaxed mb-6 text-sm sm:text-base">
                  Get a fully managed WordPress site up and running with a
                  single click. Pre-configured for speed and security with
                  automatic updates, free SSL, and a curated library of
                  premium themes and plugins included.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="/dashboard/websites/new"
                    className="inline-flex items-center gap-2 text-[#E8501A] font-semibold text-sm hover:underline transition-colors"
                  >
                    Build a WordPress site
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </a>
                  <a
                    href="/dashboard"
                    className="inline-flex items-center gap-2 text-[#E8501A] font-semibold text-sm hover:underline transition-colors"
                  >
                    Migrate to ALO Labs
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </a>
                </div>
              </div>

              {/* Decorative Gradient Placeholder */}
              <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                <div className="w-36 h-44 rounded-2xl bg-gradient-to-br from-[#0A5CFF] via-[#3B82F6] to-[#93C5FD] opacity-90 shadow-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}