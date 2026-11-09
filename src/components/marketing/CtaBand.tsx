import { ArrowRight, MessageCircle } from "lucide-react";

export default function CtaBand({
  title = "Not sure which plan fits?",
  description = "Tell us what you are launching and we will recommend the smallest plan that will not need upgrading in three months. Real engineers answer, 24/7.",
  primaryHref = "/register",
  primaryLabel = "Get started",
  secondaryHref = "/support",
  secondaryLabel = "Talk to us",
}: {
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-[#0F172A] px-6 py-12 sm:px-12 sm:py-14">
        <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">{description}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={primaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
            >
              {primaryLabel}
              <ArrowRight className="size-4" />
            </a>
            <a
              href={secondaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              <MessageCircle className="size-4" />
              {secondaryLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
