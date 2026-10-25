'use client'

import { useState } from 'react'
import { ArrowRight, Zap, Server, Globe, Users } from 'lucide-react'

type TabKey = 'automate' | 'performance' | 'growth' | 'agencies'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'automate', label: 'Automate the busywork' },
  { key: 'performance', label: 'Performance you can rely on' },
  { key: 'growth', label: 'Hosting that grows with you' },
  { key: 'agencies', label: 'Hosting for agencies' },
]

const tabContent: Record<
  TabKey,
  {
    icon: React.ReactNode
    heading: string
    description: string
    features: string[]
  }
> = {
  automate: {
    icon: <Zap className="w-5 h-5" />,
    heading: 'Automate workflows with AI — no code needed',
    description:
      'Host and run n8n workflows directly on ALO Labs. Build powerful automations that connect your tools, process data, and trigger actions — all without writing a single line of code. From lead capture pipelines to content distribution, automate the repetitive work that eats up your day.',
    features: [
      'One-click n8n instance deployment',
      'Pre-built templates for 200+ integrations',
      'AI-powered workflow suggestions',
      'Scheduled execution & real-time webhooks',
    ],
  },
  performance: {
    icon: <Server className="w-5 h-5" />,
    heading: 'Dedicated resources for demanding workloads',
    description:
      'Get the raw power of a virtual private server with the simplicity of managed hosting. ALO Labs VPS hosting gives you dedicated CPU, RAM, and storage — so your high-traffic sites and resource-heavy apps always run smoothly, even during traffic spikes.',
    features: [
      'Dedicated vCPU cores & NVMe SSD storage',
      'Full root access with choice of OS',
      '99.9% uptime SLA guaranteed',
      'Automatic backups & one-click restore',
    ],
  },
  growth: {
    icon: <Globe className="w-5 h-5" />,
    heading: 'Scale resources as your traffic grows',
    description:
      'Start small and scale effortlessly with ALO Labs cloud hosting. Automatically adjust CPU, memory, and bandwidth to match your traffic — no migrations, no downtime. Whether you are launching today or going viral tomorrow, your infrastructure keeps up.',
    features: [
      'Auto-scaling CPU & RAM',
      'Global CDN with 30+ edge locations',
      'Pay only for the resources you use',
      'Managed load balancing included',
    ],
  },
  agencies: {
    icon: <Users className="w-5 h-5" />,
    heading: 'White-label hosting built for agencies',
    description:
      'Manage all your client sites from a single dashboard with ALO Labs agency hosting. Offer branded hosting under your own name, streamline client onboarding with bulk tools, and enjoy priority support so you can focus on delivering great results.',
    features: [
      'Fully white-label client portal',
      'Bulk site provisioning & management',
      'Dedicated account manager & priority support',
      'Agency-only discounts on all plans',
    ],
  },
}

export default function PowerControlSection() {
  const [activeTab, setActiveTab] = useState<TabKey>('automate')
  const content = tabContent[activeTab]

  return (
    <section className="bg-white py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Section Heading */}
        <div className="flex items-center gap-3 mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            More power &amp; control
          </h2>
          <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-[#E8501A] to-[#0A5CFF]" />
        </div>

        {/* Tab Navigation */}
        <nav
          className="flex overflow-x-auto border-b border-gray-200 mb-10 scrollbar-none"
          aria-label="Feature tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative whitespace-nowrap px-4 sm:px-6 py-3 text-sm sm:text-base font-medium transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? 'text-[#E8501A]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              aria-selected={activeTab === tab.key}
              role="tab"
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#E8501A] rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div role="tabpanel" aria-label={content.heading} className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-10 hover:shadow-lg transition-shadow duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            {/* Left — Text Content */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                  {content.icon}
                </span>
              </div>

              <h4 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
                {content.heading}
              </h4>

              <p className="text-gray-500 leading-relaxed mb-6 text-sm sm:text-base">
                {content.description}
              </p>

              <a
                href="/dashboard"
                className="inline-flex items-center gap-2 text-[#E8501A] font-semibold text-sm hover:underline transition-colors"
              >
                Learn more
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            {/* Right — Feature List */}
            <ul className="space-y-4 pt-1">
              {content.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[#E8501A]/10 flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-[#E8501A]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                  <span className="text-gray-700 text-sm sm:text-base">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}