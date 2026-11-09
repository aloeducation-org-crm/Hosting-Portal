import type { Metadata } from "next";
import type { HostingProduct } from "@/lib/marketing/hosting-catalog";

/** Consistent metadata for every catalogue-driven page. */
export function productMetadata(product: HostingProduct): Metadata {
  return {
    title: `${product.seo.title} | ALO Labs`,
    description: product.seo.description,
    alternates: { canonical: product.href },
    openGraph: {
      title: product.seo.title,
      description: product.seo.description,
      url: `https://hosting.alolabs.net${product.href}`,
      siteName: "ALO Labs",
      type: "website",
    },
  };
}
