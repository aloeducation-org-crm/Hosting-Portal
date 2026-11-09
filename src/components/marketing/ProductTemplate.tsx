import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Globe2,
  MapPin,
  Sparkles,
  Zap,
} from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import CtaBand from "@/components/marketing/CtaBand";
import DomainSearch from "@/components/marketing/DomainSearch";
import FaqList from "@/components/marketing/FaqList";
import PlanCards from "@/components/marketing/PlanCards";
import ProductNav from "@/components/marketing/ProductNav";
import TrustStrip from "@/components/marketing/TrustStrip";
import {
  DATA_CENTERS,
  cheapestPlan,
  formatUsd,
  relatedProducts,
  type HostingProduct,
} from "@/lib/marketing/hosting-catalog";

const INFRA_SLUGS = new Set(["vps", "cloud", "dedicated", "shared", "wordpress"]);

/** Closing CTA per product — a CRM buyer wants an evaluation, not a "plan fit" chat. */
const PRODUCT_CTA: Record<
  string,
  {
    title: string;
    description: string;
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
  }
> = {
  crm: {
    title: "Try the CRM with your own data",
    description:
      "We provision a 7-day evaluation workspace, import a sample of your contacts and pipelines, and walk your team through it before you commit to a term.",
    primaryLabel: "Request an evaluation",
    primaryHref: "/support",
    secondaryLabel: "See CRM plans",
    secondaryHref: "/hosting/crm#plans",
  },
  domains: {
    title: "One search is usually all it takes",
    description:
      "Register the name now and point it at hosting later — or add hosting today and get the domain free for the first year. Transfers include an extra year.",
    primaryLabel: "Create an account",
    primaryHref: "/register",
    secondaryLabel: "Compare hosting plans",
    secondaryHref: "/pricing",
  },
  ssl: {
    title: "Every hosting plan already includes SSL",
    description:
      "If you only need TLS, wildcard and multi-domain certificates install on any host. If you are moving hosting too, certificates are free and renewed for you.",
    primaryLabel: "See hosting plans",
    primaryHref: "/hosting/shared",
    secondaryLabel: "Talk to support",
    secondaryHref: "/support",
  },
};

/** Plan-section intro, written per product so it never promises the wrong thing. */
const PLANS_INTRO: Record<string, string> = {
  domains:
    "Every registration includes WHOIS privacy, DNS management, DNSSEC and a 30-day money-back guarantee.",
  email:
    "Every mailbox includes spam and phishing filtering, 2FA, IMAP/SMTP access and a 30-day money-back guarantee.",
  ssl:
    "Every certificate includes installation, chain validation, expiry monitoring and a 30-day money-back guarantee.",
  vps:
    "Every server includes full root access, one IPv4 and a /64 IPv6 block, snapshots and 24/7 support. VPS orders carry a 7-day refund window.",
  dedicated:
    "Every server includes IPMI access, hardware RAID, DDoS filtering and a 4-hour hardware replacement SLA.",
  reseller:
    "Every plan includes WHM, white-label nameservers, per-client billing and free migrations for your client accounts.",
  crm:
    "Every workspace includes installation, managed updates, TLS, off-host backups and a full data export whenever you ask.",
};

export default function ProductTemplate({
  product,
  children,
  searchQuery = "",
}: {
  product: HostingProduct;
  children?: ReactNode;
  /** Pre-fills the hero domain search (used by /domains?q= deep links). */
  searchQuery?: string;
}) {
  const cheapest = cheapestPlan(product);
  const from = cheapest ? cheapest.pricing.term24 : product.fromPrice;
  const related = relatedProducts(product.slug);
  const showSearch = product.slug === "domains";
  const showLocations = INFRA_SLUGS.has(product.slug);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">
        <ProductNav active={product.slug} />

        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 hidden size-[420px] rounded-full opacity-20 blur-3xl lg:block"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, #0A5CFF 0%, #E8501A 45%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pb-16">
            <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-xs text-[#475569]">
              <a href="/" className="hover:text-[#E8501A]">
                Home
              </a>
              <ChevronRight className="size-3" />
              <a href="/hosting" className="hover:text-[#E8501A]">
                Hosting
              </a>
              <ChevronRight className="size-3" />
              <span className="font-medium text-[#1E293B]">{product.name}</span>
            </nav>

            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                  <Sparkles className="size-3" />
                  {product.eyebrow}
                </span>
                <h1 className="mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-[#1E293B] sm:text-4xl lg:text-5xl">
                  {product.tagline}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-base">
                  {product.description}
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href="#plans"
                    className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C73D12]"
                  >
                    See plans{from !== null ? ` from ${formatUsd(from)}${product.priceUnit}` : ""}
                    <ArrowRight className="size-4" />
                  </a>
                  <a
                    href="/support"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
                  >
                    Talk to an engineer
                  </a>
                </div>

                {showSearch && (
                  <div id="domain-search" className="mt-8 max-w-xl scroll-mt-28">
                    <DomainSearch initialQuery={searchQuery} />
                  </div>
                )}

                <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
                  {product.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-center gap-1.5 text-sm text-[#475569]">
                      <Check className="size-4 shrink-0 text-green-600" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Highlights card */}
              <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Starting at
                    </p>
                    <p className="mt-1 text-3xl font-extrabold tracking-tight text-[#1E293B]">
                      {from === 0 ? "Free" : from === null ? "Quote" : formatUsd(from)}
                      <span className="text-sm font-medium text-[#475569]">{product.priceUnit}</span>
                    </p>
                  </div>
                  <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700">
                    30-day refund
                  </span>
                </div>

                <dl className="mt-5 space-y-3 border-t border-slate-100 pt-5">
                  {cheapest?.specs.map((spec) => (
                    <div key={spec.label} className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-[#475569]">{spec.label}</dt>
                      <dd className="text-xs font-semibold text-[#1E293B]">{spec.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[11px] text-[#475569]">
                  <Zap className="size-3.5 shrink-0 text-[#E8501A]" />
                  {["domains", "ssl", "email"].includes(product.slug)
                    ? "Set up in minutes, 24/7 support included."
                    : "Provisioned in under a minute, 24/7 support included."}
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <section className="border-y border-slate-100 bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <TrustStrip compact />
          </div>
        </section>

        {/* Extra product content (domain search, price table, etc.) */}
        {children}

        {/* Plans */}
        <section id="plans" className="scroll-mt-24 bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                {product.name} plans
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
                Choose your plan
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">
                {PLANS_INTRO[product.slug] ??
                  "Every plan includes free SSL, a control panel, 24/7 support and a 30-day money-back guarantee. Upgrade, downgrade or cancel from the dashboard."}
              </p>
            </div>

            <PlanCards
              product={{ slug: product.slug, name: product.name, priceUnit: product.priceUnit }}
              plans={product.plans}
              hideTermToggle={product.priceUnit === "/yr" || product.priceUnit === ""}
              className="mt-10"
            />
          </div>
        </section>

        {/* Feature grid */}
        <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
                Everything included with {product.shortName}
              </h2>
              <p className="mt-3 text-sm text-[#475569] sm:text-base">
                No feature gated behind a sales call. If it is listed here, it ships with the plan.
              </p>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {product.features.map((feature, index) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
                >
                  <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-sm font-bold text-[#E8501A]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-base font-bold text-[#1E293B]">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#475569]">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison table */}
        {product.table && (
          <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-6xl">
              <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
                Compare {product.shortName} plans
              </h2>
              <p className="mt-3 max-w-2xl text-sm text-[#475569]">
                Side-by-side limits, so you can pick without opening a support chat.
              </p>
              <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Feature
                      </th>
                      {product.table.columns.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="whitespace-nowrap px-4 py-3 text-sm font-bold text-[#1E293B]"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {product.table.rows.map((row) => (
                      <tr key={row.label} className="hover:bg-[#FFF7ED]/60">
                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-[#475569]">
                          {row.label}
                        </th>
                        {row.values.map((value, index) => (
                          <td
                            key={`${row.label}-${index}`}
                            className="whitespace-nowrap px-4 py-3 text-[#1E293B]"
                          >
                            {value === "✓" ? (
                              <Check className="size-4 text-green-600" aria-label="Included" />
                            ) : value === "—" ? (
                              <span className="text-slate-300" aria-label="Not included">
                                —
                              </span>
                            ) : (
                              value
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Data centres */}
        {showLocations && (
          <section className="border-y border-slate-100 bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0A5CFF] ring-1 ring-slate-200">
                    <Globe2 className="size-3" />
                    Global network
                  </span>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
                    Deploy close to your customers
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-[#475569]">
                    Pick a region at checkout. Region availability depends on the plan — the order form
                    only offers locations where your plan is provisioned today.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  10 Gbps backbone · DDoS filtering · anycast DNS
                </p>
              </div>
              <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {DATA_CENTERS.map((location) => (
                  <li
                    key={location.code}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      {location.flag}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#1E293B]">
                        {location.city}
                        <span className="ml-1.5 text-[10px] font-bold text-slate-400">
                          {location.code}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-[#475569]">{location.region}</p>
                    </div>
                    <MapPin className="ml-auto size-3.5 shrink-0 text-slate-300" />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
                {product.shortName} questions, answered
              </h2>
              <p className="mt-3 text-sm text-[#475569]">
                Still unsure? Our team answers pre-sales questions 24/7 — no sales script, real
                engineers.
              </p>
              <a
                href="/support"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#E8501A] hover:underline"
              >
                Ask a question <ArrowRight className="size-4" />
              </a>
            </div>
            <FaqList faqs={product.faqs} />
          </div>
        </section>

        {/* Related products */}
        <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <h2 className="text-xl font-bold tracking-tight text-[#1E293B] sm:text-2xl">
              Works well with {product.shortName}
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {related.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.slug}
                    href={item.href}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-[#E8501A] hover:shadow-md"
                  >
                    <span className="flex size-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A]">
                      <Icon className="size-5" />
                    </span>
                    <h3 className="mt-3 text-sm font-bold text-[#1E293B]">{item.name}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#475569]">{item.eyebrow}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#E8501A]">
                      Explore
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </section>

        <CtaBand {...(PRODUCT_CTA[product.slug] ?? {})} />
      </main>
      <Footer />
    </div>
  );
}
