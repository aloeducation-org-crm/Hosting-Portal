import { ArrowRight } from "lucide-react";
import FaqList from "@/components/marketing/FaqList";
import type { ProductFaq } from "@/lib/marketing/hosting-catalog";

export const HOSTING_FAQS: ProductFaq[] = [
  {
    question: "Which hosting product should I start with?",
    answer:
      "If you are launching a normal website or blog, start with Web Hosting. A WordPress site with heavy plugins belongs on Managed WordPress. Applications, APIs and anything you administer over SSH need a VPS or managed Cloud plan. Agencies reselling hosting should look at the reseller plans.",
  },
  {
    question: "Can I move my existing website to ALO Labs?",
    answer:
      "Yes, and we do it for you. Open a migration request from the dashboard with your current host's details. We copy files, databases and email, then verify redirects and TLS before DNS is switched. Migrations are free on every hosting plan.",
  },
  {
    question: "Do prices really lock in for the whole term?",
    answer:
      "Yes. The price you pay at checkout holds for the term you selected. When the term ends the plan renews at the standard rate shown on the plan card — you will see that number before you buy, and we email you 30 days before renewal.",
  },
  {
    question: "Is a free domain included?",
    answer:
      "Web Hosting and WordPress plans include a free domain registration for the first year when you choose an annual or 24-month term. Renewal of that domain is at the standard list price on /domains.",
  },
  {
    question: "What if I outgrow my plan?",
    answer:
      "You can upgrade from the dashboard at any time and only pay the prorated difference. Moving from shared hosting to VPS or cloud is handled by our team as a migration, so your files, databases and email come along.",
  },
  {
    question: "How does the money-back guarantee work?",
    answer:
      "Shared, WordPress and cloud plans carry a 30-day money-back guarantee on hosting fees; VPS carries 7 days. Request it from the dashboard or by ticket and we refund the hosting portion — domain registrations, SSL purchases and add-ons are not refundable once issued.",
  },
  {
    question: "Do you offer invoices and business documentation?",
    answer:
      "Yes. Every payment produces a PDF invoice with your company details, VAT/tax ID if provided, and a payment reference. Invoices are available in the billing area and can be emailed automatically.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Data lives in the region you selected at checkout, with encrypted off-host backups inside the same legal jurisdiction. Our privacy policy lists the sub-processors involved.",
  },
];

export default function FaqSection({
  faqs = HOSTING_FAQS,
  heading = "Hosting questions, answered plainly",
  id = "faq",
}: {
  faqs?: ProductFaq[];
  heading?: string;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 bg-slate-50 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
            FAQ
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
            {heading}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#475569]">
            If something is still unclear, ask before you buy. Support answers pre-sales questions 24/7
            and will tell you when a plan is the wrong fit.
          </p>
          <a
            href="/support"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
          >
            Contact support
            <ArrowRight className="size-4" />
          </a>
        </div>
        <FaqList faqs={faqs} />
      </div>
    </section>
  );
}
