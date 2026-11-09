"use client";

import {
  ArrowRight,
  Check,
  Globe2,
  Mail,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import DomainSearch from "@/components/marketing/DomainSearch";
import { formatUsd, TLD_PRICES } from "@/lib/marketing/hosting-catalog";

const tldChips = ["\u002Ecom", "\u002Enet", "\u002Eorg", "\u002Eio", "\u002Edev", "\u002Estore"]
  .map((tld) => TLD_PRICES.find((entry) => entry.tld === tld))
  .filter((entry): entry is (typeof TLD_PRICES)[number] => Boolean(entry));

const trustPoints = [
  "Free SSL on every plan",
  "Free domain for 1 year",
  "30-day money-back guarantee",
  "24/7 engineer support",
];

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-[#FFFBF7] to-white">
      {/* Decorative background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at top, #000 20%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at top, #000 20%, transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-0 hidden size-[520px] rounded-full opacity-25 blur-3xl lg:block"
        style={{
          background: "radial-gradient(circle at 40% 40%, #0A5CFF 0%, #E8501A 45%, transparent 75%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-6 lg:px-8 lg:pb-20 lg:pt-14">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Copy + search */}
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#E8501A] shadow-sm ring-1 ring-[#E8501A]/15">
              <Sparkles className="size-3" />
              Summer sale · up to 75% off your first term
            </span>

            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-[#1E293B] sm:text-5xl lg:text-[3.6rem]">
              Hosting that gets out of
              <br className="hidden sm:block" /> the way of your <span className="text-[#E8501A]">launch</span>
            </h1>

            <p className="mt-5 max-w-xl text-sm leading-relaxed text-[#475569] sm:text-lg">
              Web hosting, VPS, domains, business email and CRM hosting from one account — with the
              renewal price printed on every plan. Free SSL, free migration and a real engineer on chat
              at 2am.
            </p>

            <div className="mt-7 max-w-xl">
              <DomainSearch />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                From
              </span>
              {tldChips.map((chip) => (
                <a
                  key={chip.tld}
                  href="/domains"
                  className="inline-flex items-baseline gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#1E293B] ring-1 ring-slate-200 transition-colors hover:ring-[#E8501A]"
                >
                  <span className="font-bold">{chip.tld}</span>
                  <span className="text-slate-400">{formatUsd(chip.register)}/yr</span>
                </a>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C73D12]"
              >
                See plans and pricing
                <ArrowRight className="size-4" />
              </a>
              <a
                href="/hosting"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
              >
                Browse products
              </a>
            </div>

            <ul className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {trustPoints.map((point) => (
                <li key={point} className="flex items-center gap-2 text-xs text-[#475569] sm:text-sm">
                  <Check className="size-4 shrink-0 text-green-600" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Dashboard preview */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-[#E8501A]/20 via-[#0A5CFF]/10 to-transparent blur-xl" />
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-[#E8501A] text-white">
                    <Globe2 className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-[#1E293B]">yourbrand.com</p>
                    <p className="text-[10px] text-[#475569]">Premium plan · Singapore</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Live
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 p-4">
                {[
                  { label: "Uptime", value: "99.99%", icon: TrendingUp },
                  { label: "Response", value: "184 ms", icon: Zap },
                  { label: "SSL", value: "Active", icon: ShieldCheck },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                    <Icon className="size-3.5 text-[#E8501A]" />
                    <p className="mt-1.5 text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="text-sm font-bold text-[#1E293B]">{value}</p>
                  </div>
                ))}
              </div>

              <div className="px-4 pb-4">
                <div className="flex items-end justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Requests · last 24h
                  </p>
                  <p className="text-[10px] font-semibold text-green-600">+18%</p>
                </div>
                <div className="mt-2 flex h-16 items-end gap-1" aria-hidden="true">
                  {[38, 52, 44, 61, 55, 72, 66, 84, 71, 92, 80, 64, 74, 58].map((height, index) => (
                    <div
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-[#E8501A]/30 to-[#E8501A]"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>

              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {[
                  { icon: Mail, label: "Business email", value: "5 mailboxes" },
                  { icon: ShieldCheck, label: "Backups", value: "Daily · verified" },
                  { icon: Sparkles, label: "Next invoice", value: "$3.99 / mo" },
                ].map(({ icon: Icon, label, value }) => (
                  <li key={label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-[#475569]">
                      <Icon className="size-3.5 text-slate-400" />
                      {label}
                    </span>
                    <span className="text-xs font-semibold text-[#1E293B]">{value}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-[#475569]">
              <ShieldCheck className="size-3.5 text-green-600" />
              Live status from the same dashboard you get after checkout
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
