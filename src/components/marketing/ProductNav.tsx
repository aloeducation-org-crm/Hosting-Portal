import { HOSTING_PRODUCTS } from "@/lib/marketing/hosting-catalog";

/** Horizontal product switcher shown on every product page. */
export default function ProductNav({ active }: { active?: string }) {
  return (
    <nav aria-label="Hosting products" className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0">
            <a
              href="/hosting"
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active === "hub"
                  ? "bg-[#E8501A] text-white"
                  : "text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]"
              }`}
            >
              All products
            </a>
          </li>
          {HOSTING_PRODUCTS.map((product) => (
            <li key={product.slug} className="shrink-0">
              <a
                href={product.href}
                aria-current={active === product.slug ? "page" : undefined}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active === product.slug
                    ? "bg-[#E8501A] text-white"
                    : "text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]"
                }`}
              >
                {product.shortName}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
