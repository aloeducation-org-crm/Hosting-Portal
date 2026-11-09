import Header from "@/components/alolabs/Header";
import HeroSection from "@/components/alolabs/HeroSection";
import HomeSessionCheck from "@/components/alolabs/HomeSessionCheck";
import PricingSection from "@/components/alolabs/PricingSection";
import BuildLaunchSection from "@/components/alolabs/BuildLaunchSection";
import PowerControlSection from "@/components/alolabs/PowerControlSection";
import AIToolsSection from "@/components/alolabs/AIToolsSection";
import EmailSection from "@/components/alolabs/EmailSection";
import ShowcaseSection from "@/components/alolabs/ShowcaseSection";
import TestimonialsSection from "@/components/alolabs/TestimonialsSection";
import BrandLogos from "@/components/alolabs/BrandLogos";
import Footer from "@/components/alolabs/Footer";
import CookieBanner from "@/components/alolabs/CookieBanner";
import AIChatWidget from "@/components/alolabs/AIChatWidget";
import CtaBand from "@/components/marketing/CtaBand";
import FaqSection from "@/components/marketing/FaqSection";
import LocationsSection from "@/components/marketing/LocationsSection";
import ProductsSection from "@/components/marketing/ProductsSection";
import TrustStrip from "@/components/marketing/TrustStrip";
import WhySection from "@/components/marketing/WhySection";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <HomeSessionCheck />
      <Header />
      <main className="flex-1">
        <HeroSection />

        <section className="border-y border-slate-100 bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <TrustStrip compact />
          </div>
        </section>

        <ProductsSection />
        <PricingSection />
        <WhySection />
        <BuildLaunchSection />
        <PowerControlSection />
        <LocationsSection />
        <AIToolsSection />
        <EmailSection />
        <TestimonialsSection />
        <BrandLogos />
        <ShowcaseSection />
        <FaqSection />
        <CtaBand
          title="Your domain is one search away"
          description="Start with hosting or just a domain — you can add email, VPS or CRM hosting later without moving anything. Every plan carries a 30-day money-back guarantee."
          primaryLabel="Create your account"
          secondaryHref="/pricing"
          secondaryLabel="Compare plans"
        />
      </main>
      <Footer />
      <CookieBanner />
      <AIChatWidget />
    </div>
  );
}
