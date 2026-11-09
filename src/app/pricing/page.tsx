import type { Metadata } from "next";
import {
  BadgeCheck,
  Clock,
  CreditCard,
  Globe2,
  Headphones,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import CtaBand from "@/components/marketing/CtaBand";
import FaqSection from "@/components/marketing/FaqSection";
import PricingTabs from "@/components/marketing/PricingTabs";
import WhySection from "@/components/marketing/WhySection";
import { HOSTING_PRODUCTS } from "@/lib/marketing/hosting-catalog";

export const metadata: Metadata = {
  title: "Pricing — Hosting, VPS, Cloud, Email & Domains | ALO Labs",
  description:
    "Every ALO Labs plan and price in one place: web hosting from $2.99/mo, managed WordPress, KVM VPS, cloud, dedicated servers and business email. Renewal prices shown up front.",
  alternates: { canonical: "/pricing" },
};

const included = [
  { icon: ShieldCheck, title: "Free SSL", description: "Issued and renewed automatically on every site." },
  { icon: RefreshCcw, title: "30-day refund", description: "Cancel within 30 days and get the hosting fee back." },
  { icon: Headphones, title: "24/7 support", description: "Engineers on chat and tickets around the clock." },
  { icon: Globe2, title: "Free migration", description: "We move your site, mail and DNS for you." },
  { icon: CreditCard, title: "No hidden fees", description: "Renewal price printed on every plan card." },
  { icon: Clock, title: "Upgrade any time", description: "Prorated upgrades without a new contract." },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] to-white">
          <div className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                <Sparkles className="size-3" />
                Transparent pricing
              </span>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1E293B] sm:text-5xl">
                Every plan, every price, in one place
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-lg">
                Switch billing terms to see exactly what you pay today and what it renews at. No
                checkout surprises, no compulsory add-ons, no quote walls.
              </p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <section className="px-4 pb-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <PricingTabs />
          </div>
        </section>

        {/* What every plan includes */}
        <section className="border-y border-slate-100 bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
                Included with every plan
              </h2>
              <p className="mt-3 text-sm text-[#475569]">
                These are not add-ons. If it is on this list, it is already in the price above.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {included.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A]">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[#1E293B]">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#475569]">{description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-bold text-[#1E293B]">Compare product starting prices</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <caption className="sr-only">
                    Starting price of each ALO Labs hosting product on a 24-month term
                  </caption>
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-semibold">
                        Product
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">
                        Starting at
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">
                        Best for
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {HOSTING_PRODUCTS.map((product) => (
                      <tr key={product.slug} className="transition-colors hover:bg-[#FFF7ED]/60">
                        <th scope="row" className="whitespace-nowrap px-5 py-3 font-semibold text-[#1E293B]">
                          {product.name}
                        </th>
                        <td className="whitespace-nowrap px-5 py-3 font-bold text-[#E8501A]">
                          {product.fromPrice === null
                            ? "Quote"
                            : product.fromPrice === 0
                              ? "Free"
                              : `$${product.fromPrice.toFixed(2)}${product.priceUnit}`}
                        </td>
                        <td className="px-5 py-3 text-[#475569]">{product.eyebrow}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <a
                            href={product.href}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#E8501A] hover:underline"
                          >
                            <BadgeCheck className="size-3.5" />
                            Details
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <WhySection compact />
        <FaqSection />
        <CtaBand
          title="Ready when you are"
          description="Create an account, pick a term and deploy in under a minute. If the plan turns out to be the wrong fit, support will move you — and the 30-day refund window still applies."
          primaryLabel="Get started"
          secondaryLabel="Ask a pre-sales question"
        />
      </main>
      <Footer />
    </div>
  );
}
