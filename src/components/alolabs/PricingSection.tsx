"use client";

import { useCallback } from "react";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import PlanCards from "@/components/marketing/PlanCards";
import { getProduct } from "@/lib/marketing/hosting-catalog";

const sharedHosting = getProduct("shared");

/**
 * Homepage pricing block. Prices, specs and features come from the shared
 * catalogue, so the homepage can never drift from /hosting/shared or /pricing.
 */
export default function PricingSection() {
  const handleAskALOlabs = useCallback(() => {
    window.dispatchEvent(new CustomEvent("alolabs:open"));
  }, []);

  if (!sharedHosting) return null;

  return (
    <section id="pricing" className="w-full scroll-mt-24 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
            Plans and pricing
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl lg:text-5xl">
            Web hosting from $2.99/mo
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#475569] sm:text-base">
            Pick a term, see the real renewal price, switch or cancel from the dashboard. Every plan
            includes free SSL, a free domain for the first year and 24/7 support.
          </p>
        </div>

        <PlanCards
          product={{
            slug: sharedHosting.slug,
            name: sharedHosting.name,
            priceUnit: sharedHosting.priceUnit,
          }}
          plans={sharedHosting.plans}
          className="mt-10"
        />

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
          <a
            href="/pricing"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline"
          >
            Compare every hosting product
            <ArrowRight className="size-3.5" />
          </a>
          <span className="hidden text-slate-300 sm:block">|</span>
          <a
            href="/hosting/shared"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#475569] hover:text-[#1E293B]"
          >
            <CheckCircle2 className="size-3.5 text-green-600" />
            Full feature list and limits
          </a>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-[#475569]">
            Not sure which plan to choose?{" "}
            <button
              type="button"
              onClick={handleAskALOlabs}
              className="inline-flex items-center gap-1 font-semibold text-[#E8501A] hover:underline"
            >
              <Sparkles className="size-3.5" />
              Ask ALOlabs
              <ArrowRight className="size-3.5" />
            </button>
          </p>
        </div>
      </div>
    </section>
  );
}
