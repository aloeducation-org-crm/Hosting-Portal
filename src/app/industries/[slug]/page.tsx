import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ListChecks,
  Workflow,
  BarChart3,
  Plug,
  Settings2,
  LifeBuoy,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  getPublishedIndustry,
  listServicesForIndustry,
  normalizeChallenges,
  normalizeFaqs,
  normalizeFeatureGroups,
  normalizeModules,
  normalizeStrings,
} from "@/lib/factory/catalog";
import { INDUSTRY_ICONS, DEFAULT_INDUSTRY_ICON } from "@/components/factory/industry-icons";
import EnquiryForm from "@/components/factory/EnquiryForm";

const INTEGRATION_HINTS = /whatsapp|email|payment|integrat|api|webhook/i;

const IMPLEMENTATION_STEPS = [
  "Discovery — understand the operation, users and constraints.",
  "Requirements — confirm the module list and workflows.",
  "Proposal & Scope of Work — a versioned document of included and excluded work.",
  "Approval — you approve the exact scope version before delivery starts.",
  "Configuration & development — modules configured, integrations connected.",
  "Testing & acceptance — test evidence against the agreed criteria.",
  "Deployment — release through the approved deployment workflow.",
  "Training — administrator and user sessions.",
  "Handover — checklist, documentation and support terms.",
];

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const industry = await getPublishedIndustry(db, slug);
  if (!industry || industry.status !== "published") {
    return { title: "Industry not found" };
  }
  const summary = industry.summary.slice(0, 158);
  return {
    title: `${industry.name} Software System — Industry Solutions`,
    description: summary,
    alternates: { canonical: `/industries/${industry.slug}` },
    openGraph: { title: industry.name, description: summary },
  };
}

export default async function IndustryLandingPage({ params }: Params) {
  const { slug } = await params;
  const industry = await getPublishedIndustry(db, slug);
  if (!industry || industry.status !== "published") notFound();

  const Icon = INDUSTRY_ICONS[industry.icon] ?? DEFAULT_INDUSTRY_ICON;
  const modules = normalizeModules(industry.modules) as Array<{
    key: string;
    name: string;
    description: string;
    mandatory: boolean;
  }>;
  const featureGroups = normalizeFeatureGroups(industry.features);
  const challenges = normalizeChallenges(industry.challenges);
  const workflow = normalizeStrings(industry.workflow);
  const faqs = normalizeFaqs(industry.faqs);
  const reports = normalizeStrings(industry.reports);
  const mappings = await listServicesForIndustry(db, industry.slug);

  const mandatory = modules.filter((m) => m.mandatory);
  const optional = modules.filter((m) => !m.mandatory);
  const integrationDependent = modules.filter((m) => INTEGRATION_HINTS.test(m.name + " " + m.description));

  const relationStyle: Record<string, string> = {
    core: "bg-indigo-100 text-indigo-700 border-indigo-200",
    recommended: "bg-sky-100 text-sky-700 border-sky-200",
    optional: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <main className="min-h-screen bg-white">
      {/* A — Industry hero (distinct per-industry gradient + icon artwork) */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: `linear-gradient(135deg, ${industry.accentFrom} 0%, ${industry.accentTo} 100%)` }}
        aria-label={`${industry.name} overview`}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 80% 70%, white 1px, transparent 1.5px)",
            backgroundSize: "36px 36px",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Icon className="h-9 w-9 text-white" aria-hidden />
          </div>
          <h1 className="mt-6 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-5xl">{industry.name}</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/90 sm:text-lg">{industry.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#enquire"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#1E293B] shadow-lg hover:bg-white/90"
            >
              Discuss Your Project <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-full border border-white/50 px-6 py-3 text-sm font-bold text-white hover:bg-white/10"
            >
              Explore Features
            </a>
          </div>
          <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/70">Modules</dt>
              <dd className="text-2xl font-bold">{modules.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/70">Standard</dt>
              <dd className="text-2xl font-bold">{mandatory.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/70">Optional add-ons</dt>
              <dd className="text-2xl font-bold">{optional.length}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* B — Challenges */}
      {challenges.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold text-[#1E293B]">Operational challenges this system addresses</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {challenges.map((c, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E8501A]/10 text-xs font-bold text-[#E8501A]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-[#1E293B]">{c.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#475569]">{c.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* C + D — Solution overview & feature catalogue */}
      <section id="features" className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold text-[#1E293B]">Solution overview & feature catalogue</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#475569]">{industry.summary}</p>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {/* Module lists with labels */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#475569]">
                <ListChecks className="h-4 w-4 text-[#E8501A]" /> Standard modules (in the core system)
              </h3>
              <ul className="mt-3 space-y-2.5">
                {mandatory.map((m) => (
                  <li key={m.key} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <span className="font-medium text-[#1E293B]">{m.name}</span>
                      <span className="block text-xs text-[#475569]">{m.description}</span>
                    </div>
                  </li>
                ))}
              </ul>

              <h3 className="mt-6 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#475569]">
                <Settings2 className="h-4 w-4 text-[#475569]" /> Optional add-ons (selected per scope)
              </h3>
              <ul className="mt-3 space-y-2.5">
                {optional.map((m) => (
                  <li key={m.key} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
                    <div>
                      <span className="font-medium text-[#1E293B]">{m.name}</span>
                      <span className="block text-xs text-[#475569]">{m.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Grouped feature catalogue */}
            <div className="space-y-4">
              {featureGroups.map((g, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h3 className="font-bold text-[#1E293B]">{g.group}</h3>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {g.items.map((item, j) => (
                      <li
                        key={j}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#475569]"
                      >
                        {String(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
                <strong className="font-semibold">Honest labels:</strong> features marked as optional are not
                included unless your approved scope selects them;
                {integrationDependent.length > 0 && (
                  <> features noted as integration-dependent require connected, authorised credentials;</>
                )}{" "}
                everything else shown as a standard module ships with the core system. Anything still under
                development is never advertised here as ready to buy.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* E — Workflow */}
      {workflow.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-[#1E293B]">
            <Workflow className="h-6 w-6 text-[#E8501A]" /> How the system supports real work
          </h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workflow.map((step, i) => (
              <li key={i} className="relative rounded-2xl border border-slate-200 bg-white p-5">
                <span
                  className="text-3xl font-extrabold"
                  style={{ color: industry.accentFrom }}
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-1 text-sm leading-relaxed text-[#475569]">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* F — Integrations */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-[#1E293B]">
            <Plug className="h-6 w-6 text-[#E8501A]" /> Integrations & prerequisites
          </h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[#475569]">
                Integration-dependent capabilities
              </h3>
              {integrationDependent.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {integrationDependent.map((m) => (
                    <li key={m.key} className="flex items-start gap-2 text-sm text-[#475569]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E8501A]" aria-hidden />
                      <span>
                        <strong className="text-[#1E293B]">{m.name}</strong> — needs the relevant provider
                        account, API credentials and approvals; connection status is always shown honestly in
                        the platform&apos;s Integration Registry.
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#475569]">
                  This family works mostly standalone. Optional external connections (analytics, payments,
                  messaging) are configured per client.
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[#475569]">
                What you provide (typical prerequisites)
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-[#475569]">
                <li>— A named process owner on your side for review and acceptance.</li>
                <li>— Existing data exports (if migration is in scope).</li>
                <li>— Brand assets and content for any public pages.</li>
                <li>— Provider accounts/credentials for any external service you want connected.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* G — Reports */}
      {reports.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-[#1E293B]">
            <BarChart3 className="h-6 w-6 text-[#E8501A]" /> Reports & scoreboards
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {reports.map((r, i) => (
              <span
                key={i}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-[#1E293B]"
              >
                {r}
              </span>
            ))}
          </div>
          <p className="mt-4 max-w-3xl text-xs text-[#475569]">
            Reports are computed from your actual records — no fabricated numbers, no guaranteed outcomes.
          </p>
        </section>
      )}

      {/* Mapped services */}
      {mappings.length > 0 && (
        <section className="border-y border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-bold text-[#1E293B]">Recommended services for {industry.name}</h2>
            <p className="mt-1 text-sm text-[#475569]">
              Registry defaults — your engagement still selects exactly what your approved scope includes.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mappings.map((m) => (
                <a
                  key={m.service.slug}
                  href="/services"
                  className="group rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-[#E8501A]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-[#1E293B] group-hover:text-[#E8501A]">{m.service.name}</h3>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${relationStyle[m.relation] ?? relationStyle.optional}`}
                    >
                      {m.relation}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">{m.service.summary}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* H — Implementation process */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold text-[#1E293B]">Implementation process</h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {IMPLEMENTATION_STEPS.map((step, i) => (
            <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <span className="text-xs font-bold text-[#E8501A]">STEP {i + 1}</span>
              <p className="mt-1 leading-relaxed text-[#475569]">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* I — Support */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <LifeBuoy className="mt-0.5 h-6 w-6 shrink-0 text-[#E8501A]" />
            <div>
              <h2 className="font-bold text-[#1E293B]">Support & maintenance</h2>
              <p className="mt-1 max-w-xl text-sm text-[#475569]">
                Ongoing maintenance, incident response and updates are available as an entitlement with agreed
                response targets — see Maintenance &amp; Technical Support in the service catalog.
              </p>
            </div>
          </div>
          <a
            href="/services"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#E8501A] px-5 py-2.5 text-sm font-semibold text-[#E8501A] hover:bg-[#E8501A] hover:text-white"
          >
            View support services <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* J + K — FAQs and enquiry */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-[#1E293B]">
              <HelpCircle className="h-6 w-6 text-[#E8501A]" /> FAQ
            </h2>
            <div className="mt-5 space-y-4">
              {faqs.map((f, i) => (
                <details key={i} className="group rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer font-semibold text-[#1E293B] outline-none">{f.q}</summary>
                  <p className="mt-2 text-sm leading-relaxed text-[#475569]">{f.a}</p>
                </details>
              ))}
              {faqs.length === 0 && (
                <p className="text-sm text-[#475569]">Have a question not covered here? Ask us below.</p>
              )}
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-[#475569]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                We describe capabilities factually: no guaranteed rankings, outcomes or delivery results — those
                depend on your data, market and connected providers.
              </span>
            </div>
          </div>

          <EnquiryForm
            industry={industry.slug}
            source="industry-landing"
            services={mappings.map((m) => ({ slug: m.service.slug, name: m.service.name }))}
          />
        </div>
      </section>
    </main>
  );
}
