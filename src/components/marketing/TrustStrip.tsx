import { BadgeCheck, Headphones, RefreshCcw, ShieldCheck } from "lucide-react";

const items = [
  { icon: ShieldCheck, title: "99.9% uptime", description: "Backed by service credits" },
  { icon: Headphones, title: "24/7 support", description: "Real engineers, under 10 min" },
  { icon: RefreshCcw, title: "30-day refund", description: "On hosting fees, no forms" },
  { icon: BadgeCheck, title: "Free SSL", description: "Issued and renewed for you" },
];

export default function TrustStrip({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "grid grid-cols-2 gap-4 sm:grid-cols-4"
          : "grid grid-cols-2 gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-4"
      }
    >
      {items.map(({ icon: Icon, title, description }) => (
        <div key={title} className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#E8501A]">
            <Icon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#1E293B]">{title}</p>
            <p className="text-xs text-[#475569]">{description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
