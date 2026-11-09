import {
  ArrowRight,
  Clock,
  CreditCard,
  Gauge,
  Lock,
  RefreshCcw,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

const pillars = [
  {
    icon: ServerCog,
    title: "Infrastructure we run ourselves",
    description:
      "NVMe storage, LiteSpeed and 10 Gbps uplinks on hardware in twelve regions — with capacity dashboards visible to support, not just to us.",
  },
  {
    icon: Gauge,
    title: "Performance budgets, not buzzwords",
    description:
      "Every plan has a published CPU and memory allowance. No hidden throttling after you pass an unstated visitor count.",
  },
  {
    icon: ShieldCheck,
    title: "Security at the default layer",
    description:
      "Free SSL, DDoS filtering, managed WAF, SSH-key-first servers and malware scanning are on from the first minute, not sold as add-ons.",
  },
  {
    icon: Clock,
    title: "Support that answers in minutes",
    description:
      "24/7 chat and tickets staffed by systems engineers. Average first response under 10 minutes, with the fix in the same thread.",
  },
  {
    icon: RefreshCcw,
    title: "Migrations done for you",
    description:
      "Send your current host's details and we copy files, databases, mail and DNS, then verify redirects before you switch.",
  },
  {
    icon: CreditCard,
    title: "Honest pricing",
    description:
      "The renewal price is on every plan card. No surprise storage fees, no compulsory add-ons at checkout, cancel from the dashboard.",
  },
];

const stats = [
  { value: "99.9%", label: "Uptime guarantee" },
  { value: "12", label: "Regions" },
  { value: "10 min", label: "Median first reply" },
  { value: "30 days", label: "Money-back window" },
];

export default function WhySection({ compact = false }: { compact?: boolean }) {
  return (
    <section className="relative overflow-hidden bg-[#0F172A] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-0 size-[420px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #E8501A 0%, transparent 70%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 bottom-0 size-[380px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #0A5CFF 0%, transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            <Sparkles className="size-3" />
            Why ALO Labs
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Hosting that behaves like infrastructure, not a sales funnel
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Published limits, published renewal prices, and a support team that can actually change
            something on the server. That is the whole pitch.
          </p>
        </div>

        {!compact && (
          <dl className="mt-10 grid grid-cols-2 gap-4 border-y border-white/10 py-6 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <dt className="order-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  {stat.label}
                </dt>
                <dd className="order-1 text-3xl font-extrabold tracking-tight text-white">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map(({ icon: Icon, title, description }) => (
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
            href="/hosting"
            className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
          >
            Compare hosting products
            <ArrowRight className="size-4" />
          </a>
          <a
            href="/support"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white"
          >
            <Users className="size-4" />
            Read the support promise
          </a>
          <a
            href="/privacy"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white"
          >
            <Lock className="size-4" />
            How we handle your data
          </a>
        </div>
      </div>
    </section>
  );
}
