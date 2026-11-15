import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, Headphones, Mail, ShieldAlert } from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import EnquiryForm from "@/components/factory/EnquiryForm";

export const metadata: Metadata = {
  title: "Contact & Support | ALO Labs",
  description:
    "Reach the ALO Labs engineering and operations team for project enquiries, managed hosting support, system incidents, or abuse reports.",
  alternates: { canonical: "/contact" },
};

const channels = [
  {
    icon: Headphones,
    title: "Engineering & project enquiries",
    description:
      "Scoping a system, migrating a workload, or discussing custom automation? Use the form on this page and your message goes directly into our intake queue.",
  },
  {
    icon: Activity,
    title: "Existing tenant operations",
    description:
      "Signed-in operators can open support tickets, inspect live service telemetry, and review deployment logs from the control plane.",
    href: "/dashboard",
    cta: "Open dashboard",
  },
  {
    icon: ShieldAlert,
    title: "Security & abuse reports",
    description:
      "Report phishing, unauthorised traffic, or certificate/DNS issues affecting an ALO-operated domain using the form with full reproduction details.",
  },
];

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-white">
          <div className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                <Mail className="size-3" />
                Contact &amp; support
              </span>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1E293B] sm:text-5xl">
                Talk directly to the team running the platform
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-lg">
                Every enquiry submitted here is recorded in our durable intake store and routed to our engineering and
                operations team. No chatbot wall, no third-party call centre.
              </p>
            </div>
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-5">
              {channels.map(({ icon: Icon, title, description, href, cta }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 p-6"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A]">
                    <Icon className="size-4" />
                  </span>
                  <h2 className="mt-3 text-base font-bold text-[#1E293B]">{title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">{description}</p>
                  {href && cta && (
                    <Link
                      href={href}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline"
                    >
                      {cta} <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <div className="lg:col-span-7">
              <EnquiryForm source="contact-page" id="contact-form" />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
