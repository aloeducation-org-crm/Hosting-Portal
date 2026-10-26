'use client'

import { Check, ArrowRight, Play, Bot, Sparkles, Wand2 } from 'lucide-react'

export default function AIToolsSection() {
  return (
    <section className="w-full bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            AI tools
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Human-led, AI-powered
          </h2>
          <p className="mt-4 text-base leading-relaxed text-gray-600 sm:text-lg">
            ALO Labs&apos;s AI experience helps you seamlessly grow online, while keeping
            you firmly in control of your online success.
          </p>
          <a
            href="/dashboard/agents"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
          >
            Get started
            <ArrowRight className="size-4" />
          </a>
        </div>

        {/* Video / Image Placeholder */}
        <div className="mt-12 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#E8501A] via-[#0A5CFF] to-[#3B82F6] aspect-video max-w-4xl mx-auto">
          {/* Mock UI elements inside the placeholder */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative">
              {/* Faint grid pattern */}
              <div className="absolute -inset-20 opacity-10">
                <div className="grid grid-cols-8 gap-4">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div key={i} className="h-8 w-full rounded bg-white/30" />
                  ))}
                </div>
              </div>
              {/* Play button */}
              <button
                className="relative z-10 flex size-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30 sm:size-20"
                aria-label="Play video"
              >
                <Play className="size-6 fill-white text-white sm:size-8" />
              </button>
            </div>
          </div>
          {/* Decorative circles */}
          <div className="absolute -right-12 -top-12 size-48 rounded-full bg-white/5" />
          <div className="absolute -bottom-16 -left-16 size-64 rounded-full bg-white/5" />
        </div>

        {/* Feature Cards */}
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Card 1 - ALOlabs */}
          <div className="group rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-lg">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#E8501A]/10">
              <Bot className="size-6 text-[#E8501A]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              Your AI agent, ALOlabs
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Meet ALOlabs, your personal AI assistant that helps you manage your
              online presence effortlessly. From answering questions to guiding
              you through every step of building and growing your website.
            </p>
          </div>

          {/* Card 2 - Backstage AI */}
          <div className="group rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-lg">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#E8501A]/10">
              <Sparkles className="size-6 text-[#E8501A]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              Backstage AI
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Built-in AI that automates tasks behind the scenes and boosts your
              online visibility. From SEO optimization to content suggestions,
              Backstage AI handles the heavy lifting so you can focus on what
              matters.
            </p>
          </div>

          {/* Card 3 - AI Tools */}
          <div className="group rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-lg">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#E8501A]/10">
              <Wand2 className="size-6 text-[#E8501A]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              AI tools
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Create stunning visuals with our AI logo maker, AI image generator,
              and more. Design professional graphics, generate unique branding
              assets, and enhance your website — all powered by artificial
              intelligence.
            </p>
          </div>
        </div>

        {/* Start with ALOlabs */}
        <div className="mt-16 mx-auto max-w-2xl text-center">
          <h3 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Start with ALOlabs
          </h3>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Get instant help via chat or WhatsApp. ALOlabs is available 24/7 to
            answer your questions, troubleshoot issues, and help you make the
            most of ALO Labs products and services.
          </p>
        </div>
      </div>
    </section>
  )
}