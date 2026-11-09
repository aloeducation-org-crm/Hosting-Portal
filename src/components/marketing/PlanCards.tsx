"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import {
  TERMS,
  TERM_MONTHS,
  formatUsd,
  priceForTerm,
  savingsPercent,
  termTotal,
  type HostingPlan,
  type HostingProduct,
  type Term,
} from "@/lib/marketing/hosting-catalog";

interface PlanCardsProps {
  product: Pick<HostingProduct, "slug" | "name" | "priceUnit">;
  plans: HostingPlan[];
  /** Defaults to the 24-month promotional term. */
  initialTerm?: Term;
  /** Hide the term switcher for products sold at a fixed annual price. */
  hideTermToggle?: boolean;
  className?: string;
}

/** Human label for a product's price unit ("/mo", "/yr", "/mailbox/mo"). */
function unitLabel(priceUnit: string): string {
  if (priceUnit === "/mo") return "month";
  if (priceUnit === "/yr") return "year";
  if (priceUnit === "/mailbox/mo") return "mailbox per month";
  return priceUnit.replace(/^\//, "") || "month";
}

/** True when every plan costs the same on all three terms. */
function isFixedPrice(plans: HostingPlan[]): boolean {
  return plans.every(
    (plan) =>
      plan.pricing.term1 === plan.pricing.term12 && plan.pricing.term12 === plan.pricing.term24,
  );
}

export default function PlanCards({
  product,
  plans,
  initialTerm = "term24",
  hideTermToggle = false,
  className,
}: PlanCardsProps) {
  const fixed = useMemo(() => hideTermToggle || isFixedPrice(plans), [hideTermToggle, plans]);
  const [term, setTerm] = useState<Term>(initialTerm);

  const activeTerm = fixed ? "term12" : term;
  const months = TERM_MONTHS[activeTerm];
  const bestSaving = Math.max(0, ...plans.map((plan) => savingsPercent(plan, "term24")));

  return (
    <div className={className}>
      {!fixed && (
        <div className="mb-8 flex flex-col items-center gap-3">
          <div
            role="radiogroup"
            aria-label="Billing term"
            className="inline-flex flex-wrap justify-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm"
          >
            {TERMS.map((option) => {
              const active = option.id === term;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTerm(option.id)}
                  className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-5 ${
                    active
                      ? "bg-[#E8501A] text-white shadow-sm"
                      : "text-[#1E293B] hover:bg-[#FFF7ED]"
                  }`}
                >
                  {option.label}
                  {option.id === "term24" && bestSaving > 0 && (
                    <span
                      className={`ml-2 hidden rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase sm:inline ${
                        active ? "bg-white/20 text-white" : "bg-green-100 text-green-700"
                      }`}
                    >
                      Save up to {bestSaving}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[#475569]">
            Prices in USD per {unitLabel(product.priceUnit)}. You can change the term or cancel at
            any time from the dashboard.
          </p>
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${
          plans.length >= 4 ? "xl:grid-cols-4" : plans.length === 2 ? "xl:grid-cols-2 xl:max-w-4xl xl:mx-auto" : "xl:grid-cols-3"
        }`}
      >
        {plans.map((plan) => {
          const monthly = priceForTerm(plan, activeTerm);
          const total = termTotal(plan, activeTerm);
          const save = savingsPercent(plan, activeTerm);
          const ctaHref =
            plan.ctaHref ??
            `/register?plan=${encodeURIComponent(plan.id)}&product=${encodeURIComponent(product.slug)}&term=${months}`;

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl bg-white p-6 transition-all ${
                plan.popular
                  ? "border-2 border-[#E8501A] shadow-xl shadow-[#E8501A]/10 md:-translate-y-1"
                  : "border border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#E8501A] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-3" />
                  Most popular
                </span>
              )}

              <div>
                <h3 className="text-lg font-bold text-[#1E293B]">{plan.name}</h3>
                <p className="mt-0.5 text-xs text-[#475569]">{plan.tagline}</p>
              </div>

              <div className="mt-5">
                <div className="flex items-end gap-1.5">
                  <span className="text-4xl font-extrabold leading-none tracking-tight text-[#1E293B]">
                    {monthly === 0 ? "Free" : formatUsd(monthly)}
                  </span>
                  {monthly > 0 && (
                    <span className="pb-0.5 text-sm text-[#475569]">{product.priceUnit}</span>
                  )}
                </div>
                {monthly > 0 && save > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-400 line-through">
                      {formatUsd(plan.pricing.term1)}
                    </span>
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
                      Save {save}%
                    </span>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-[#475569]">
                  {monthly === 0
                    ? "Included with every hosting plan"
                    : product.priceUnit === "/yr"
                      ? `Billed ${formatUsd(total)} annually`
                      : months === 1
                        ? `Billed ${formatUsd(total)} monthly`
                        : `Billed ${formatUsd(total)} every ${months} months`}
                  {plan.renewal > monthly && monthly > 0
                    ? ` · renews at ${formatUsd(plan.renewal)}${product.priceUnit}`
                    : ""}
                </p>
              </div>

              <a
                href={ctaHref}
                className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                  plan.popular
                    ? "bg-[#E8501A] text-white hover:bg-[#C73D12]"
                    : "border-2 border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white"
                }`}
              >
                {plan.ctaLabel ?? "Choose plan"}
                <ArrowRight className="size-4" />
              </a>

              {plan.specs.length > 0 && (
                <dl className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3">
                  {plan.specs.map((spec) => (
                    <div key={spec.label}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {spec.label}
                      </dt>
                      <dd className="text-xs font-semibold text-[#1E293B]">{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      className={`mt-0.5 size-4 shrink-0 ${
                        plan.popular ? "text-[#E8501A]" : "text-green-500"
                      }`}
                    />
                    <span className="text-sm leading-snug text-[#475569]">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-[#475569]">
        Prices exclude applicable taxes. Promotional prices apply to the first term; renewal is at the
        standard rate shown on each card. See{" "}
        <a href="/terms" className="font-medium text-[#E8501A] hover:underline">
          terms of service
        </a>
        .
      </p>
    </div>
  );
}
