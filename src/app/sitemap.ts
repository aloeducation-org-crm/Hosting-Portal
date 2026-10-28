import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { listPublishedIndustries, type IndustryRow } from "@/lib/factory/catalog";
// Registry-driven: admin status/content changes must appear without a rebuild.
export const dynamic = "force-dynamic";

const BASE_URL = "https://hosting.alolabs.net";

/**
 * Sitemap generated from the live registries: static public pages plus every
 * published industry landing page and service entry.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const industries = await listPublishedIndustries(db).catch(() => [] as IndustryRow[]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/industries`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/services`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...staticEntries,
    ...industries.map((ind) => ({
      url: `${BASE_URL}/industries/${ind.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
