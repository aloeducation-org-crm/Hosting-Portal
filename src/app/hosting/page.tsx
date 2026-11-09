import type { Metadata } from "next";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import CtaBand from "@/components/marketing/CtaBand";
import DomainSearch from "@/components/marketing/DomainSearch";
import FaqSection from "@/components/marketing/FaqSection";
import LocationsSection from "@/components/marketing/LocationsSection";
import ProductsSection from "@/components/marketing/ProductsSection";
import TrustStrip from "@/components/marketing/TrustStrip";
import WhySection from "@/components/marketing/WhySection";
import { HOSTING_PRODUCTS } from "@/lib/marketing/hosting-catalog";

export const metadata: Metadata = {
  title: "Hosting, Domains & Email — All ALO Labs Products | ALO Labs",
  description:
    "Compare every ALO Labs hosting product: shared and WordPress hosting, VPS, managed cloud, dedicated servers, reseller hosting, CRM hosting, domains, business email and SSL.",
  alternates: { canonical: "/hosting" },
};

const useCases = [
  {
    scenario: "A personal site, portfolio or blog",
    recommendation: "Web Hosting — Starter",
    detail: "1 website, 100 GB NVMe, free domain for a year, $2.99/mo on a 24-month term.",
    href: "/hosting/shared",
  },
  {
    scenario: "A business site that must not go down",
    recommendation: "Web Hosting — Premium",
    detail: "100 sites, daily backups, unlimited mailboxes and 2× CPU, from $3.99/mo.",
    href: "/hosting/shared",
  },
  {
    scenario: "A WordPress or WooCommerce store",
    recommendation: "Managed WordPress — WP Business",
    detail: "Redis object cache, staging, tested plugin updates, from $4.99/mo.",
    href: "/hosting/wordpress",
  },
  {
    scenario: "A custom app, API or bot you administer",
    recommendation: "VPS — KVM 2",
    detail: "2 dedicated vCPUs, 8 GB RAM, 100 GB NVMe and root access, from $8.99/mo.",
    href: "/hosting/vps",
  },
  {
    scenario: "Traffic that spikes and someone else patching the OS",
    recommendation: "Cloud — Cloud Scale",
    detail: "Managed PHP/MySQL/Redis with autoscaling and staging, from $24.99/mo.",
    href: "/hosting/cloud",
  },
  {
    scenario: "Compliance, heavy databases or virtualisation",
    recommendation: "Dedicated — DS-2",
    detail: "16c/32t bare metal, 64 GB ECC, NVMe RAID 1 and IPMI, from $99.99/mo.",
    href: "/hosting/dedicated",
  },
  {
    scenario: "Hosting clients under your own brand",
    recommendation: "Reseller — Reseller 50",
    detail: "50 white-label cPanel accounts, your nameservers, per-client billing, from $24.99/mo.",
    href: "/hosting/reseller",
  },
  {
    scenario: "A CRM that a sales team depends on",
    recommendation: "CRM Hosting — CRM Growth",
    detail: "SuiteCRM, EspoCRM, Vtiger or Odoo deployed, patched and backed up, from $24.99/mo.",
    href: "/hosting/crm",
  },
];

export default function HostingHubPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 -top-24 hidden size-[520px] rounded-full opacity-20 blur-3xl lg:block"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, #0A5CFF 0%, #E8501A 45%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                <Sparkles className="size-3" />
                Hosting catalogue
              </span>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1E293B] sm:text-5xl">
                Hosting, domains and email from{" "}
                <span className="text-[#E8501A]">one account</span>
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-lg">
                Start with what you need today. Add VPS, a dedicated server, CRM hosting or business
                email later — same dashboard, same invoice, no migrations.
              </p>
              <div className="mx-auto mt-7 max-w-xl">
                <DomainSearch />
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/pricing"
                  className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
                >
                  Compare plans
                  <ArrowRight className="size-4" />
                </a>
                <a
                  href="/support"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
                >
                  Ask which plan fits
                </a>
              </div>
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {["Free SSL everywhere", "30-day money-back", "Free migration", "24/7 support"].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-1.5 text-xs text-[#475569]">
                      <Check className="size-3.5 text-green-600" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-100 bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <TrustStrip compact />
          </div>
        </section>

        <ProductsSection
          slugs={HOSTING_PRODUCTS.map((product) => product.slug)}
          heading="Every product, published prices"
          subheading="No quote walls. Each card links to a full page with plan limits, regional availability and the exact renewal price."
          showAllLink={false}
          className="bg-white"
        />

        {/* Use-case table */}
        <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
                Find the plan by what you are building
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">
                Recommendations we would give a friend — usually the smallest plan that will not need
                replacing in three months.
              </p>
            </div>
            <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        What you are building
                      </th>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Recommended
                      </th>
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Why
                      </th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {useCases.map((row) => (
                      <tr key={row.scenario} className="transition-colors hover:bg-[#FFF7ED]/60">
                        <th scope="row" className="px-5 py-3 font-medium text-[#1E293B]">
                          {row.scenario}
                        </th>
                        <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#E8501A]">
                          {row.recommendation}
                        </td>
                        <td className="px-5 py-3 text-[#475569]">{row.detail}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <a
                            href={row.href}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#E8501A] hover:underline"
                          >
                            See plans <ArrowRight className="size-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 text-xs text-[#475569]">
              Prices shown are the 24-month term rate for new customers. Move the term switcher on each
              plan page to see 12-month and monthly pricing.
            </p>
          </div>
        </section>

        <WhySection />
        <LocationsSection />
        <FaqSection />
        <CtaBand
          title="Still comparing?"
          description="Send us your current stack and traffic numbers. We will tell you which plan fits, which one is overkill, and what the migration would involve — before you pay anything."
          primaryLabel="Create an account"
          secondaryLabel="Talk to an engineer"
        />
      </main>
      <Footer />
    </div>
  );
}
