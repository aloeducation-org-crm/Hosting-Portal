import { ArrowRight, Check } from "lucide-react";
import {
  FEATURED_SLUGS,
  formatUsd,
  getProduct,
  type HostingProduct,
} from "@/lib/marketing/hosting-catalog";

function ProductCard({ product }: { product: HostingProduct }) {
  const Icon = product.icon;
  const priceLabel =
    product.fromPrice === null
      ? "Custom quote"
      : product.fromPrice === 0
        ? "Free with hosting"
        : `From ${formatUsd(product.fromPrice)}${product.priceUnit}`;

  return (
    <a
      href={product.href}
      className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[#E8501A] hover:shadow-xl hover:shadow-[#E8501A]/10"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A] transition-colors group-hover:bg-[#E8501A] group-hover:text-white">
          <Icon className="size-5" />
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          {product.eyebrow}
        </span>
      </div>

      <h3 className="mt-4 text-lg font-bold text-[#1E293B]">{product.name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#475569]">{product.tagline}</p>

      <ul className="mt-4 space-y-1.5">
        {product.highlights.slice(0, 3).map((highlight) => (
          <li key={highlight} className="flex items-start gap-1.5 text-xs text-[#475569]">
            <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
            {highlight}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <div>
          <p className="text-base font-extrabold text-[#1E293B]">{priceLabel}</p>
          <p className="text-[11px] text-slate-400">30-day money-back guarantee</p>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#E8501A]">
          View
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </a>
  );
}

export default function ProductsSection({
  slugs = [...FEATURED_SLUGS],
  heading = "Everything you need to get online",
  subheading = "One account covers hosting, domains, business email, CRM and TLS. Buy the piece you need today and add the rest without migrating anything.",
  showAllLink = true,
  className = "bg-slate-50",
}: {
  slugs?: string[];
  heading?: string;
  subheading?: string;
  showAllLink?: boolean;
  className?: string;
}) {
  const products = slugs
    .map((slug) => getProduct(slug))
    .filter((product): product is HostingProduct => Boolean(product));

  return (
    <section className={`px-4 py-16 sm:px-6 lg:px-8 lg:py-20 ${className}`}>
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full bg-[#E8501A]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
              Products
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1E293B] sm:text-4xl">
              {heading}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#475569] sm:text-base">{subheading}</p>
          </div>
          {showAllLink && (
            <a
              href="/hosting"
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
            >
              All hosting products
              <ArrowRight className="size-4" />
            </a>
          )}
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
