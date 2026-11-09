import { ChevronDown } from "lucide-react";
import type { ProductFaq } from "@/lib/marketing/hosting-catalog";
import { cn } from "@/lib/utils";

export default function FaqList({
  faqs,
  className,
}: {
  faqs: ProductFaq[];
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white", className)}>
      {faqs.map((faq) => (
        <details key={faq.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-[#1E293B] transition-colors hover:bg-[#FFF7ED] sm:text-base [&::-webkit-details-marker]:hidden">
            {faq.question}
            <ChevronDown className="size-4 shrink-0 text-[#E8501A] transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-5 pb-5 text-sm leading-relaxed text-[#475569]">{faq.answer}</div>
        </details>
      ))}
    </div>
  );
}
