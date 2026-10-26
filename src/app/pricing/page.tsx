'use client';

import Header from '@/components/alolabs/Header';
import PricingSection from '@/components/alolabs/PricingSection';
import Footer from '@/components/alolabs/Footer';

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 pt-8">
        <PricingSection />
      </main>
      <Footer />
    </div>
  );
}
