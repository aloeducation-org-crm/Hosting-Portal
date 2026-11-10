import { describe, expect, it } from "vitest";
import { SALES_CHANNELS, buildCampaignLink } from "@/lib/marketing/sales-channels";
import { isProtectedDashboardPath } from "@/proxy";

describe("sales channels", () => {
  it("protects the workspace and nested paths", () => {
    expect(isProtectedDashboardPath("/sales-channels")).toBe(true);
    expect(isProtectedDashboardPath("/sales-channels/settings")).toBe(true);
  });
  it("builds attribution for every channel without dropping existing URL data", () => {
    for (const channel of SALES_CHANNELS) {
      const url = new URL(buildCampaignLink("https://example.com/offer?product=one&utm_source=old#details", channel.id, " Launch & grow "));
      expect(url.searchParams.get("utm_source")).toBe(channel.id);
      expect(url.searchParams.get("utm_medium")).toBe(channel.medium);
      expect(url.searchParams.get("utm_campaign")).toBe("Launch & grow");
      expect(url.searchParams.get("product")).toBe("one");
      expect(url.hash).toBe("#details");
    }
  });
  it("rejects unsafe or malformed destinations", () => {
    for (const destination of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "/relative", "bad"]) {
      expect(() => buildCampaignLink(destination, "website", "launch")).toThrow();
    }
  });
  it("requires a known channel and bounded campaign", () => {
    for (const campaign of ["", "  ", "a".repeat(121)]) expect(() => buildCampaignLink("https://example.com", "email", campaign)).toThrow();
    expect(() => buildCampaignLink("https://example.com", "unknown", "launch")).toThrow();
  });
});
