import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock, RefreshCcw, ShieldCheck } from "lucide-react";
import ProductTemplate from "@/components/marketing/ProductTemplate";
import { getProduct } from "@/lib/marketing/hosting-catalog";
import { productMetadata } from "@/lib/marketing/metadata";

const product = getProduct("ssl");

export const metadata: Metadata = product
  ? productMetadata(product)
  : { title: "SSL certificates | ALO Labs" };

const steps = [
  {
    icon: Lock,
    title: "Issued on your hostname",
    description:
      "Pick a hostname and validation method. Free DV certificates are live in minutes; wildcard and multi-domain certificates follow the same flow.",
  },
  {
    icon: ShieldCheck,
    title: "Installed and verified",
    description:
      "We install the certificate, complete the chain, test the TLS handshake and turn on the HTTPS redirect for you.",
  },
  {
    icon: RefreshCcw,
    title: "Renewed before it expires",
    description:
      "Free certificates renew automatically 30 days before expiry. Paid certificates raise a reminder and can be reissued at no cost.",
  },
];

export default function SslPage() {
  if (!product) notFound();

  return (
    <ProductTemplate product={product}>
      <section className="bg-white px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 py-8 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A]">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-3 text-sm font-bold text-[#1E293B]">{title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </ProductTemplate>
  );
}
