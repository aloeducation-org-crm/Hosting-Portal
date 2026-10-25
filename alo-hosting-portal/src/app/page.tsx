'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import Header from '@/components/alolabs/Header'
import HeroSection from '@/components/alolabs/HeroSection'
import TestimonialsSection from '@/components/alolabs/TestimonialsSection'
import BrandLogos from '@/components/alolabs/BrandLogos'
import BuildLaunchSection from '@/components/alolabs/BuildLaunchSection'
import PowerControlSection from '@/components/alolabs/PowerControlSection'
import StatsSection from '@/components/alolabs/StatsSection'
import AIToolsSection from '@/components/alolabs/AIToolsSection'
import EmailSection from '@/components/alolabs/EmailSection'
import ShowcaseSection from '@/components/alolabs/ShowcaseSection'
import PricingSection from '@/components/alolabs/PricingSection'
import Footer from '@/components/alolabs/Footer'
import CookieBanner from '@/components/alolabs/CookieBanner'
import AIChatWidget from '@/components/alolabs/AIChatWidget'

function InnerHome() {
  const checkSession = useAuthStore((s) => s.checkSession)

  useEffect(() => {
    checkSession()
  }, [checkSession])

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <TestimonialsSection />
        <BrandLogos />
        <BuildLaunchSection />
        <PowerControlSection />
        <StatsSection />
        <AIToolsSection />
        <EmailSection />
        <ShowcaseSection />
        <PricingSection />
      </main>
      <Footer />
      <CookieBanner />
      <AIChatWidget />
    </div>
  )
}

export default function Home() {
  return <InnerHome />
}