'use client'

import { useState, useCallback } from 'react'
import { Check, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import AuthModal from '@/components/alolabs/AuthModal'

interface Plan {
  id: string
  name: string
  price: string
  originalPrice: string
  savePercent: number
  billing: string
  features: string[]
  popular: boolean
}

const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$2.99',
    originalPrice: '$11.99',
    savePercent: 75,
    billing: 'Billed every 12 months',
    features: [
      '1 Website',
      '100 GB SSD Storage',
      'Free Domain',
      'Free SSL',
      'Managed WordPress',
      'Weekly Backups',
      'Unlimited Email Accounts',
      '24/7 Support',
      '1x Processing Power & Memory',
      'Free CDN',
    ],
    popular: false,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$3.99',
    originalPrice: '$14.99',
    savePercent: 73,
    billing: 'Billed every 12 months',
    features: [
      '~100 Websites',
      '200 GB SSD Storage',
      'Free Domain',
      'Free SSL',
      'Unlimited Bandwidth',
      'Managed WordPress',
      'Daily Backups',
      'Unlimited Email Accounts',
      '24/7 Priority Support',
      '2x Processing Power & Memory',
      'Free CDN',
      'Dedicated IP',
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: '$7.99',
    originalPrice: '$29.99',
    savePercent: 73,
    billing: 'Billed every 12 months',
    features: [
      '~100 Websites',
      '200 GB SSD Storage',
      'Free Domain',
      'Free SSL',
      'Unlimited Bandwidth',
      'Managed WordPress',
      'Daily Backups',
      'Unlimited Email Accounts',
      '24/7 Priority Support',
      '4x Processing Power & Memory',
      'Free CDN',
      'Dedicated IP',
      'InterShield Security',
      'Automatic Malware Scanner',
    ],
    popular: false,
  },
]

export default function PricingSection() {
  const { user, token, isAuthenticated, checkSession } = useAuthStore()
  const [authOpen, setAuthOpen] = useState(false)
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null)

  const handleChoosePlan = useCallback(
    async (plan: Plan) => {
      if (!isAuthenticated) {
        setAuthOpen(true)
        return
      }

      if (!user || !token) return

      setSubscribingPlan(plan.id)
      try {
        const res = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            userId: user.id,
            plan: plan.id,
            token,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Subscription failed')
        }

        toast.success(`Subscribed to ${plan.name} plan!`)

        // Refetch session to update user plan in store
        await checkSession()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Something went wrong'
        )
      } finally {
        setSubscribingPlan(null)
      }
    },
    [isAuthenticated, user, token, checkSession]
  )

  const handleAskNova = useCallback(() => {
    // Dispatch a custom event that AIChatWidget listens for
    const event = new CustomEvent('nova:open')
    window.dispatchEvent(event)
  }, [])

  return (
    <section className="w-full bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            Plans and pricing
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Get summer sale prices while they last
          </h2>
          <p className="mt-4 text-base leading-relaxed text-gray-600">
            Lock in our lowest prices of the year. All plans include everything
            you need to build and grow your online presence.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3 items-start">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl bg-white p-6 transition-shadow hover:shadow-xl ${
                plan.popular
                  ? 'alo-pricing-popular border-2 border-[#E8501A] shadow-lg z-10'
                  : 'border border-gray-200 shadow-sm'
              }`}
            >
              {/* Plan Name */}
              <h3 className="text-lg font-semibold text-gray-900">
                {plan.name}
              </h3>

              {/* Price */}
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-gray-900">
                  {plan.price}
                </span>
                <span className="text-sm text-gray-400">/mo</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-gray-400 line-through">
                  {plan.originalPrice}/mo
                </span>
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                  Save {plan.savePercent}%
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{plan.billing}</p>

              {/* CTA Button */}
              <button
                type="button"
                onClick={() => handleChoosePlan(plan)}
                disabled={subscribingPlan === plan.id}
                className={`mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  plan.popular
                    ? 'bg-[#E8501A] text-white hover:bg-[#C73D12]'
                    : 'border-2 border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white'
                }`}
              >
                {subscribingPlan === plan.id ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    Choose plan
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>

              {/* Features */}
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check
                      className={`mt-0.5 size-4 shrink-0 ${
                        plan.popular ? 'text-[#E8501A]' : 'text-green-500'
                      }`}
                    />
                    <span className="text-sm text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Links */}
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#E8501A] transition-colors hover:text-[#C73D12]"
          >
            View all features
            <ArrowRight className="size-3.5" />
          </a>
          <span className="hidden sm:block text-gray-300">|</span>
          <a
            href="/dashboard"
            className="text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            Fair Usage Policy
          </a>
        </div>

        {/* Ask Nova */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600">
            Not sure which plan to choose?{' '}
            <button
              type="button"
              onClick={handleAskNova}
              className="inline-flex items-center gap-1 font-semibold text-[#E8501A] transition-colors hover:text-[#C73D12]"
            >
              Ask Nova
              <ArrowRight className="size-3.5" />
            </button>
          </p>
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab="signup" />
    </section>
  )
}