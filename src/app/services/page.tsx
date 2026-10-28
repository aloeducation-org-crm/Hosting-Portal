import type { Metadata } from "next";
import { ArrowRight, Package, BadgeDollarSign, ListChecks } from "lucide-react";
import { db } from "@/lib/db";
import { listPublishedServices, normalizeDeliverables, normalizeStrings, SERVICE_CATEGORY_LABELS } from "@/lib/factory/catalog";
import EnquiryForm from "@/components/factory/EnquiryForm";
// Registry-driven: admin status/content changes must appear without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services — Software, Marketing, SEO, Email, WhatsApp & More",
  description:
    "The full service catalog: software development, digital marketing, SEO, email marketing, WhatsApp Business, social media and analytics services — with honest deliverables and quotation-based pricing.",
  alternates: { canonical: "/services" },
};

const CATEGORY_ORDER = [
  "software",
  "marketing",
  "seo",
  "email",
  "whatsapp",
  "social",
  "analytics",
] as const;

export default async function ServicesPage() {
  const services = await listPublishedServices(db);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: SERVICE_CATEGORY_LABELS[cat],
    items: services.filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            <Package className="h-3.5 w-3.5" /> Service Catalog
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight text-[#1E293B] sm:text-5xl">
            What we build and run for clients
          </h1>
          <p className="mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
            {services.length} services across software, marketing and communications — each with explicit
            deliverables, prerequisites and exclusions. Pricing is prepared per engagement as a quotation; we
            never publish numbers we have not agreed with you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#request-quote"
              className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C73D12]"
            >
              Request a quotation <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/industries"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-[#1E293B] hover:border-[#E8501A] hover:text-[#E8501A]"
            >
              Browse by industry
            </a>
          </div>
        </div>
      </section>

      {/* Catalog grouped by category */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="space-y-14">
          {grouped.map((group) => (
            <div key={group.category} id={group.category}>
              <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-[#1E293B] sm:text-2xl">{group.label}</h2>
                <span className="text-xs font-medium text-slate-400">{group.items.length} services</span>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((svc) => {
                  const deliverables = normalizeDeliverables(svc.deliverables);
                  const prerequisites = normalizeStrings(svc.prerequisites);
                  const exclusions = normalizeStrings(svc.exclusions);
                  return (
                    <article
                      key={svc.slug}
                      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-[#1E293B]">{svc.name}</h3>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                          <BadgeDollarSign className="h-3 w-3" /> quotation
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">{svc.summary}</p>

                      <div className="mt-3 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#475569]">
                          <ListChecks className="h-3.5 w-3.5 text-[#E8501A]" /> Deliverables
                        </div>
                        <ul className="mt-1.5 space-y-1">
                          {deliverables.slice(0, 4).map((d, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-[#475569]">
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#E8501A]" aria-hidden />
                              {d.name}
                            </li>
                          ))}
                          {deliverables.length > 4 && (
                            <li className="pl-3 text-xs text-slate-400">+{deliverables.length - 4} more</li>
                          )}
                        </ul>
                      </div>

                      {prerequisites.length > 0 && (
                        <p className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-[#475569]">
                          <strong className="text-[#1E293B]">Needs:</strong> {prerequisites.join(" · ")}
                        </p>
                      )}
                      {exclusions.length > 0 && (
                        <p className="mt-1 text-[11px] text-[#475569]">
                          <strong className="text-[#1E293B]">Not included:</strong> {exclusions.join(" · ")}
                        </p>
                      )}

                      <a
                        href="#request-quote"
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline"
                      >
                        Request a quote <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          {grouped.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-16 text-center text-slate-400">
              The service catalog is being prepared. Check back soon.
            </div>
          )}
        </div>
      </section>

      {/* Enquiry */}
      <section id="request-quote" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold text-[#1E293B]">Request a quotation</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[#475569]">
            Tell us which services you are considering. We respond with a scoped proposal and quotation — no
            obligation, no invented prices.
          </p>
          <div className="mt-8">
            <EnquiryForm source="service-page" />
          </div>
        </div>
      </section>
    </main>
  );
}
