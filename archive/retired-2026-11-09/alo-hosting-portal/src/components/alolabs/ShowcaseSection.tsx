'use client'

import { ArrowRight } from 'lucide-react'

export default function ShowcaseSection() {
  return (
    <section className="w-full bg-[#F1F1F4] py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            Inspiration
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Made with ALO Labs
          </h2>
          <p className="mt-4 text-base leading-relaxed text-gray-600 sm:text-lg">
            Now it&apos;s your turn to succeed online, whether it&apos;s an ecommerce
            store, blog, portfolio, or business site.
          </p>
          <a
            href="/dashboard/websites/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
          >
            Get started
            <ArrowRight className="size-4" />
          </a>
        </div>

        {/* Showcase Card — Website Mockup Placeholder */}
        <div className="mt-12 overflow-hidden rounded-2xl bg-gradient-to-br from-[#E8501A] via-[#0A5CFF] to-[#3B82F6] aspect-[16/9] relative shadow-xl">
          {/* Browser chrome mock */}
          <div className="absolute top-0 left-0 right-0 h-10 bg-black/10 backdrop-blur-sm flex items-center px-4 gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-white/30" />
              <div className="h-2.5 w-2.5 rounded-full bg-white/25" />
              <div className="h-2.5 w-2.5 rounded-full bg-white/25" />
            </div>
            <div className="ml-4 h-5 flex-1 max-w-md rounded-md bg-white/15 flex items-center justify-center">
              <span className="text-[10px] text-white/60">alolabs.net</span>
            </div>
          </div>

          {/* Mock website content */}
          <div className="absolute inset-0 pt-10 p-6 sm:p-10 flex flex-col">
            {/* Nav mock */}
            <div className="flex items-center justify-between mb-6">
              <div className="h-4 w-20 rounded bg-white/30" />
              <div className="hidden sm:flex items-center gap-4">
                <div className="h-2.5 w-12 rounded bg-white/25" />
                <div className="h-2.5 w-12 rounded bg-white/25" />
                <div className="h-2.5 w-12 rounded bg-white/25" />
                <div className="h-6 w-16 rounded-lg bg-white/30" />
              </div>
            </div>

            {/* Hero area */}
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
              <div className="flex-1 space-y-3">
                <div className="h-3 w-24 rounded bg-white/20" />
                <div className="h-5 w-48 rounded bg-white/30" />
                <div className="h-5 w-36 rounded bg-white/25" />
                <div className="space-y-1.5 mt-2">
                  <div className="h-2 w-full rounded bg-white/15" />
                  <div className="h-2 w-4/5 rounded bg-white/15" />
                  <div className="h-2 w-3/5 rounded bg-white/15" />
                </div>
                <div className="flex gap-2 mt-3">
                  <div className="h-8 w-24 rounded-lg bg-white/30" />
                  <div className="h-8 w-24 rounded-lg bg-white/15" />
                </div>
              </div>
              {/* Image placeholder */}
              <div className="w-40 h-32 sm:w-56 sm:h-40 rounded-xl bg-white/15 flex-shrink-0 overflow-hidden">
                <div className="w-full h-full flex items-center justify-center">
                  <div className="grid grid-cols-2 gap-2 p-3">
                    <div className="h-10 w-10 rounded-lg bg-white/20" />
                    <div className="h-10 w-10 rounded-lg bg-white/20" />
                    <div className="h-10 w-10 rounded-lg bg-white/20" />
                    <div className="h-10 w-10 rounded-lg bg-white/20" />
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom mock cards */}
            <div className="mt-6 grid grid-cols-3 gap-3 max-w-lg mx-auto w-full">
              <div className="h-16 rounded-lg bg-white/10 p-2">
                <div className="h-3 w-8 rounded bg-white/25 mb-1" />
                <div className="h-1.5 w-12 rounded bg-white/15" />
              </div>
              <div className="h-16 rounded-lg bg-white/10 p-2">
                <div className="h-3 w-10 rounded bg-white/25 mb-1" />
                <div className="h-1.5 w-14 rounded bg-white/15" />
              </div>
              <div className="h-16 rounded-lg bg-white/10 p-2">
                <div className="h-3 w-6 rounded bg-white/25 mb-1" />
                <div className="h-1.5 w-10 rounded bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}