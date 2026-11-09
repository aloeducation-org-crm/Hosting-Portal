"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import PlanCards from "@/components/marketing/PlanCards";
import {
  PRICING_GROUPS,
  getProduct,
  type HostingProduct,
} from "@/lib/marketing/hosting-catalog";

export default function PricingTabs() {
  const [active, setActive] = useState<string>(PRICING_GROUPS[0].slug);
  const product = getProduct(active);

  if (!product) return null;

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Hosting products">
        {PRICING_GROUPS.map((group) => {
          const selected = group.slug === active;
          return (
            <button
              key={group.slug}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(group.slug)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-5 ${
                selected
                  ? "bg-[#1E293B] text-white shadow-sm"
                  : "border border-slate-200 bg-white text-[#475569] hover:border-[#E8501A] hover:text-[#E8501A]"
              }`}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      <ProductPanel product={product} />
    </div>
  );
}

function ProductPanel({ product }: { product: HostingProduct }) {
  return (
    <div className="mt-10">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
          {product.name}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#475569]">{product.tagline}</p>
      </div>

      <PlanCards
        key={product.slug}
        product={{ slug: product.slug, name: product.name, priceUnit: product.priceUnit }}
        plans={product.plans}
        hideTermToggle={product.priceUnit === "/yr" || product.priceUnit === ""}
        className="mt-8"
      />

      <div className="mt-6 flex justify-center">
        <a
          href={product.href}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
        >
          Full {product.shortName} details
          <ArrowRight className="size-4" />
        </a>
      </div>
    </div>
  );
}
