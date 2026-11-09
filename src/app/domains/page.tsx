import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductTemplate from "@/components/marketing/ProductTemplate";
import TldPricingTable from "@/components/marketing/TldPricingTable";
import { getProduct } from "@/lib/marketing/hosting-catalog";
import { productMetadata } from "@/lib/marketing/metadata";

const product = getProduct("domains");

export const metadata: Metadata = product
  ? productMetadata(product)
  : { title: "Domain names | ALO Labs" };

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  if (!product) notFound();

  const params = await searchParams;
  const searchQuery = typeof params.q === "string" ? params.q : "";

  return (
    <ProductTemplate product={product} searchQuery={searchQuery}>
      <section className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
            Domain price list
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-[#475569]">
            Registration, renewal and transfer prices for the most requested extensions — all in USD
            per year, with the renewal price shown before you buy.
          </p>
          <div className="mt-8">
            <TldPricingTable />
          </div>
        </div>
      </section>
    </ProductTemplate>
  );
}
