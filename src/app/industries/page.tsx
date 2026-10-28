import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { listPublishedIndustries, normalizeModules } from "@/lib/factory/catalog";
import { INDUSTRY_ICONS, DEFAULT_INDUSTRY_ICON } from "@/components/factory/industry-icons";
// Registry-driven: admin status/content changes must appear without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Industry Solutions — 20 Industry Software Systems",
  description:
    "Explore the 20 industry software system families we build and maintain: education, healthcare, real estate, retail, logistics, hospitality, finance, legal, agencies and more.",
  alternates: { canonical: "/industries" },
};

export default async function IndustriesDirectoryPage() {
  const industries = await listPublishedIndustries(db);

  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">
            <Layers className="h-3.5 w-3.5" /> Industry System Registry
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight text-[#1E293B] sm:text-5xl">
            Software systems built for {industries.length} industries
          </h1>
          <p className="mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
            Each family is its own product system — its own modules, workflows, reports and acceptance criteria —
            built once and configured per client. Explore an industry to see the actual feature catalogue,
            implementation process and enquiry form.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/services"
              className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C73D12]"
            >
              Explore services <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#industry-grid"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-[#1E293B] hover:border-[#E8501A] hover:text-[#E8501A]"
            >
              Browse industries
            </a>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section id="industry-grid" className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((ind) => {
            const Icon = INDUSTRY_ICONS[ind.icon] ?? DEFAULT_INDUSTRY_ICON;
            const moduleCount = normalizeModules(ind.modules).length;
            return (
              <Link
                key={ind.slug}
                href={`/industries/${ind.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div
                  className="flex h-24 items-center justify-between px-5"
                  style={{ background: `linear-gradient(135deg, ${ind.accentFrom}, ${ind.accentTo})` }}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                    <Icon className="h-6 w-6 text-white" aria-hidden />
                  </span>
                  <span className="text-xs font-medium text-white/80">{moduleCount} modules</span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="text-lg font-bold text-[#1E293B] group-hover:text-[#E8501A]">{ind.name}</h2>
                  <p className="mt-1.5 line-clamp-3 flex-1 text-sm leading-relaxed text-[#475569]">{ind.summary}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A]">
                    Explore system <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {industries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-16 text-center text-slate-400">
            Industry catalog is being prepared. Check back soon.
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#1E293B]">Not sure which industry system fits?</h2>
            <p className="mt-1 text-sm text-[#475569]">
              Describe your operation and we will map it to the right modules and services.
            </p>
          </div>
          <a
            href="/services"
            className="inline-flex items-center gap-2 rounded-full bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0f172a]"
          >
            View service catalog <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
    </main>
  );
}
