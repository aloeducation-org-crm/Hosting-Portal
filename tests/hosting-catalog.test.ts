/**
 * The storefront catalogue is the single source of truth for prices shown on the
 * homepage, /pricing and every product page. These tests protect the promises
 * that matter to a buyer:
 *
 *   - no duplicated slugs or routes (a duplicate would silently hide a product);
 *   - term pricing never gets *more* expensive as the term gets longer;
 *   - the maths used on the plan cards is correct to the cent;
 *   - every page has SEO copy and real FAQ answers, not placeholders;
 *   - the homepage/pricing surfaces can always resolve their product slugs.
 */
import { describe, expect, it } from "vitest";
import {
  FEATURED_SLUGS,
  HOSTING_PRODUCTS,
  PRICING_GROUPS,
  TERM_MONTHS,
  TLD_PRICES,
  formatUsd,
  getProduct,
  priceForTerm,
  relatedProducts,
  savingsPercent,
  termTotal,
  tldPrice,
  type HostingProduct,
} from "@/lib/marketing/hosting-catalog";

const allPlans = HOSTING_PRODUCTS.flatMap((product) =>
  product.plans.map((plan) => ({ product, plan })),
);

describe("hosting catalogue integrity", () => {
  it("exposes at least the ten advertised products", () => {
    expect(HOSTING_PRODUCTS.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique slugs, hrefs and plan ids", () => {
    const slugs = HOSTING_PRODUCTS.map((product) => product.slug);
    const hrefs = HOSTING_PRODUCTS.map((product) => product.href);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const product of HOSTING_PRODUCTS) {
      const ids = product.plans.map((plan) => plan.id);
      expect(new Set(ids).size, `${product.slug} has duplicate plan ids`).toBe(ids.length);
    }
  });

  it("routes product pages under /hosting except the standalone domain pages", () => {
    const standalone = new Set(["domains", "email", "ssl"]);
    for (const product of HOSTING_PRODUCTS) {
      if (standalone.has(product.slug)) {
        expect(product.href).toBe(`/${product.slug}`);
      } else {
        expect(product.href).toBe(`/hosting/${product.slug}`);
      }
    }
  });

  it("never charges more per month for a longer term", () => {
    for (const { product, plan } of allPlans) {
      const { term24, term12, term1 } = plan.pricing;
      expect(term24, `${product.slug}/${plan.id}`).toBeLessThanOrEqual(term12);
      expect(term12, `${product.slug}/${plan.id}`).toBeLessThanOrEqual(term1);
      expect(term24).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps renewal prices at or above the promotional rate", () => {
    for (const { product, plan } of allPlans) {
      if (plan.pricing.term24 === 0) continue;
      expect(plan.renewal, `${product.slug}/${plan.id}`).toBeGreaterThanOrEqual(plan.pricing.term24);
    }
  });

  it("gives every plan a spec list, features and a tagline", () => {
    for (const { product, plan } of allPlans) {
      expect(plan.specs.length, `${product.slug}/${plan.id}`).toBeGreaterThanOrEqual(2);
      expect(plan.features.length, `${product.slug}/${plan.id}`).toBeGreaterThanOrEqual(3);
      expect(plan.tagline.length).toBeGreaterThan(0);
      for (const feature of plan.features) expect(feature.trim().length).toBeGreaterThan(3);
    }
  });

  it("publishes SEO copy, features and FAQs for every product", () => {
    for (const product of HOSTING_PRODUCTS) {
      expect(product.seo.title.length).toBeGreaterThan(10);
      expect(product.seo.description.length).toBeGreaterThan(50);
      expect(product.features.length).toBeGreaterThanOrEqual(4);
      expect(product.faqs.length).toBeGreaterThanOrEqual(3);
      expect(product.highlights.length).toBeGreaterThanOrEqual(3);

      for (const faq of product.faqs) {
        expect(faq.question.trim().length).toBeGreaterThan(10);
        expect(faq.answer.trim().length).toBeGreaterThan(40);
        expect(faq.answer).not.toMatch(/lorem ipsum|todo|tbd/i);
      }
    }
  });

  it("advertises a from-price that matches the cheapest plan", () => {
    for (const product of HOSTING_PRODUCTS) {
      if (product.fromPrice === null) continue;
      // Domains are sold per extension, so the advertised "from" price is the
      // cheapest entry on the published price list, not the cheapest package.
      const cheapest =
        product.slug === "domains"
          ? Math.min(...TLD_PRICES.map((entry) => entry.register))
          : Math.min(...product.plans.map((plan) => plan.pricing.term24));
      expect(product.fromPrice, `${product.slug} fromPrice`).toBe(cheapest);
    }
  });
});

describe("pricing maths shown on plan cards", () => {
  const starter = getProduct("shared")?.plans.find((plan) => plan.id === "starter");
  if (!starter) throw new Error("shared/starter plan is required by the storefront");

  it("multiplies the monthly rate by the term length", () => {
    expect(TERM_MONTHS.term24).toBe(24);
    expect(termTotal(starter, "term24")).toBe(71.76); // 2.99 × 24
    expect(termTotal(starter, "term12")).toBe(47.88); // 3.99 × 12
    expect(termTotal(starter, "term1")).toBe(11.99);
  });

  it("reports the discount against the monthly price", () => {
    expect(savingsPercent(starter, "term24")).toBe(75);
    expect(savingsPercent(starter, "term12")).toBe(66);
    expect(savingsPercent(starter, "term1")).toBe(0);
  });

  it("formats USD with two decimals", () => {
    expect(formatUsd(2.99)).toBe("$2.99");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1299)).toBe("$1,299.00");
  });

  it("returns the term price without mutating the plan", () => {
    const before = { ...starter.pricing };
    expect(priceForTerm(starter, "term12")).toBe(3.99);
    expect(starter.pricing).toEqual(before);
  });
});

describe("domain price list", () => {
  it("has unique extensions and sane prices", () => {
    const tlds = TLD_PRICES.map((entry) => entry.tld);
    expect(new Set(tlds).size).toBe(tlds.length);
    for (const entry of TLD_PRICES) {
      expect(entry.register).toBeGreaterThan(0);
      expect(entry.renewal).toBeGreaterThanOrEqual(0);
      expect(entry.transfer).toBeGreaterThan(0);
    }
  });

  it("normalises lookups with or without the leading dot", () => {
    expect(tldPrice("com")?.register).toBe(12.99);
    expect(tldPrice(".COM")?.register).toBe(12.99);
    expect(tldPrice(".unknown-tld")).toBeUndefined();
  });
});

describe("catalogue consumers", () => {
  it("resolves every slug used by the homepage and /pricing", () => {
    for (const slug of FEATURED_SLUGS) {
      expect(getProduct(slug), `featured slug ${slug}`).toBeDefined();
    }
    for (const group of PRICING_GROUPS) {
      expect(getProduct(group.slug), `pricing group ${group.slug}`).toBeDefined();
    }
  });

  it("never recommends the product you are already looking at", () => {
    for (const product of HOSTING_PRODUCTS) {
      const related: HostingProduct[] = relatedProducts(product.slug);
      expect(related.length).toBeGreaterThan(0);
      expect(related.some((item) => item.slug === product.slug)).toBe(false);
    }
  });

  it("keeps the shared hosting plan prices the homepage advertises", () => {
    const shared = getProduct("shared");
    expect(shared?.plans.map((plan) => plan.pricing.term24)).toEqual([2.99, 3.99, 7.99]);
    expect(shared?.plans.filter((plan) => plan.popular).length).toBe(1);
  });
});
