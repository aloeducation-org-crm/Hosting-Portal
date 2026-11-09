import { ArrowRight, Gauge, Globe2, Network, ShieldCheck } from "lucide-react";
import { DATA_CENTERS } from "@/lib/marketing/hosting-catalog";

const networkFacts = [
  { icon: Gauge, label: "10 Gbps", description: "Uplinks to every rack" },
  { icon: ShieldCheck, label: "DDoS filtered", description: "Always-on, no add-on fee" },
  { icon: Globe2, label: "Anycast DNS", description: "Answers from the nearest edge" },
  { icon: Network, label: "Private VLANs", description: "Isolated per account" },
];

export default function LocationsSection() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div>
            <span className="inline-block rounded-full bg-[#0A5CFF]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0A5CFF]">
              Global network
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
              Pick the region, we do the routing
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">
              Shared hosting is served from the nearest available region automatically. VPS, cloud and
              dedicated customers choose a location at checkout — and can add more later.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-4">
              {networkFacts.map(({ icon: Icon, label, description }) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4">
                  <Icon className="size-4 text-[#E8501A]" />
                  <dt className="mt-2 text-sm font-bold text-[#1E293B]">{label}</dt>
                  <dd className="text-xs text-[#475569]">{description}</dd>
                </div>
              ))}
            </dl>

            <a
              href="/hosting/vps"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#E8501A] hover:underline"
            >
              See regions for VPS plans
              <ArrowRight className="size-4" />
            </a>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DATA_CENTERS.map((location) => (
              <li
                key={location.code}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3 transition-colors hover:border-[#E8501A] hover:bg-white"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {location.flag}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#1E293B]">
                    {location.city}
                    <span className="ml-1.5 text-[10px] font-bold text-slate-400">{location.code}</span>
                  </p>
                  <p className="truncate text-[11px] text-[#475569]">{location.region}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
