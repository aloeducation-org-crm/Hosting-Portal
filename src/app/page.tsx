import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  DatabaseBackup,
  Fingerprint,
  Globe2,
  Mail,
  ShieldCheck,
  Activity,
  Server,
} from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import HomeSessionCheck from "@/components/alolabs/HomeSessionCheck";
import CookieBanner from "@/components/alolabs/CookieBanner";
import ProjectCard from "@/components/showcase/ProjectCard";
import { PROJECTS } from "@/lib/marketing/projects";

export const metadata: Metadata = {
  title: "ALO Labs — Projects we build, host and run",
  description:
    "The projects ALO Labs builds and operates: the hosting control plane, industry software systems, our CRM and internal AI automations — all on infrastructure we run ourselves.",
  alternates: { canonical: "/" },
};

const capabilities = [
  {
    icon: Globe2,
    title: "Domains & DNS",
    description: "Registrations, transfers, anycast DNS and DNSSEC for the domains our projects use.",
  },
  {
    icon: ShieldCheck,
    title: "TLS lifecycle",
    description: "Certificates issued on provisioning, renewed automatically and monitored before expiry.",
  },
  {
    icon: Mail,
    title: "Business mail",
    description: "Mailboxes on our own domains with SPF, DKIM and DMARC configured and verified.",
  },
  {
    icon: DatabaseBackup,
    title: "Backups & restore",
    description: "Scheduled, off-host backups with a restore path that is tested rather than assumed.",
  },
  {
    icon: Activity,
    title: "Monitoring",
    description: "Health checks, certificate and disk alerts, and incident history kept in one place.",
  },
  {
    icon: Fingerprint,
    title: "Access control",
    description: "Role-based permissions and MFA on every operator account, with an audit trail.",
  },
];

const operating = [
  {
    icon: Server,
    title: "We run the servers",
    description:
      "Sites, mail and DNS terminate on hosts we operate. There is no reseller layer between a change in the panel and the machine it lands on.",
  },
  {
    icon: ShieldCheck,
    title: "Security is the default, not an add-on",
    description:
      "TLS everywhere, SSH-key access, rate limiting, CSRF protection on every mutation and secrets kept out of the database.",
  },
  {
    icon: Activity,
    title: "Failures stay visible",
    description:
      "Health checks, alert rules, backups and audit logs are part of the portal, so problems surface before someone reports them.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <HomeSessionCheck />
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse at top, #000 20%, transparent 70%)",
              WebkitMaskImage: "radial-gradient(ellipse at top, #000 20%, transparent 70%)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 hidden size-[460px] rounded-full opacity-20 blur-3xl lg:block"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, #0A5CFF 0%, #E8501A 45%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 lg:px-8 lg:pb-20 lg:pt-16">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#E8501A] shadow-sm ring-1 ring-[#E8501A]/15">
                <span className="size-1.5 rounded-full bg-green-500" aria-hidden="true" />
                Projects in production
              </span>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.06] tracking-tight text-[#1E293B] sm:text-5xl lg:text-[3.4rem]">
                We build, host and run
                <br className="hidden sm:block" /> our own <span className="text-[#E8501A]">systems</span>
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-lg">
                This portal is the control plane behind everything we operate: our applications, client
                systems, domains, mail and certificates. Below is what is live right now — no plans, no
                storefront, just the projects and the platform they sit on.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href="#projects"
                  className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C73D12]"
                >
                  See the projects
                  <ArrowRight className="size-4" />
                </a>
                <a
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
                >
                  Team sign-in
                </a>
              </div>
              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
                {[
                  "On infrastructure we operate",
                  "TLS on every endpoint",
                  "Scheduled backups",
                  "Monitored around the clock",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-1.5 text-xs text-[#475569] sm:text-sm">
                    <Check className="size-4 shrink-0 text-green-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Projects */}
        <section id="projects" className="scroll-mt-24 bg-slate-50 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                  Our projects
                </span>
                <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
                  What is live today
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">
                  Each project below runs on this platform. Public projects have a link; internal ones
                  are behind team sign-in.
                </p>
              </div>
              <a
                href="/projects"
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
              >
                All projects
                <ArrowRight className="size-4" />
              </a>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-2">
              {PROJECTS.map((project) => (
                <ProjectCard key={project.slug} project={project} />
              ))}
            </div>
          </div>
        </section>

        {/* Platform capabilities */}
        <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <span className="inline-block rounded-full bg-[#0A5CFF]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0A5CFF]">
                Inside the portal
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
                The boring parts, handled
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">
                Domains, certificates, mail, backups and access live in the same place the projects do —
                so a renewal, a restore or a permissions change is one task, not five.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A]">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-[#1E293B]">{title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How we run it */}
        <section className="relative overflow-hidden bg-[#0F172A] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-32 top-0 size-[420px] rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(circle, #E8501A 0%, transparent 70%)" }}
          />
          <div className="relative mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                How we run it
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                One team, one platform, no reseller layer
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
                We keep the stack small enough to understand end to end. That is why a support request
                gets an answer from someone who can change the machine, not open a ticket with a vendor.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {operating.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/10"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-[#E8501A]/15 text-[#FF8A5B]">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-white">{title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{description}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href="/projects"
                className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
              >
                Browse the projects
                <ArrowRight className="size-4" />
              </a>
              <a
                href="/services"
                className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white"
              >
                What we build for clients
              </a>
              <a
                href="/support"
                className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white"
              >
                Contact support
              </a>
            </div>
          </div>
        </section>

        {/* Access CTA */}
        <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-gradient-to-br from-[#FFF7ED] to-white px-6 py-10 text-center sm:px-10">
            <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
              Need access, or something moved?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[#475569]">
              Accounts, domains and site transfers are handled by the team that runs the platform. Create
              an account to request access, or contact support if you already work with us.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a
                href="/register"
                className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
              >
                Create an account
                <ArrowRight className="size-4" />
              </a>
              <a
                href="/support"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
              >
                Contact support
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}
