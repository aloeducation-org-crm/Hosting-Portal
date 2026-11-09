import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductTemplate from "@/components/marketing/ProductTemplate";
import { getProduct } from "@/lib/marketing/hosting-catalog";
import { productMetadata } from "@/lib/marketing/metadata";

const product = getProduct("wordpress");

export const metadata: Metadata = product
  ? productMetadata(product)
  : { title: "Hosting | ALO Labs" };

export default function Page() {
  if (!product) notFound();

  return (
    <ProductTemplate product={product}>
    </ProductTemplate>
  );
}
