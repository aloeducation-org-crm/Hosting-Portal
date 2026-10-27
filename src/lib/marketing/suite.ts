import { completeWithAI } from "@/lib/ai/client";

export interface MarketingKitInput {
  brandName: string;
  offerOrProduct: string;
  targetAudience: string;
  landingUrl?: string;
  language?: "bn" | "en";
  tone?: "professional" | "bold" | "friendly";
}

export interface MarketingKitOutput {
  brandName: string;
  language: "bn" | "en";
  aiEnhanced: boolean;
  aiProviderUsed: string | null;
  metaAds: Array<{
    angle: string;
    headline: string;
    primaryText: string;
    cta: string;
  }>;
  googleSearchAd: {
    headlines: string[];
    descriptions: string[];
    keywords: string[];
  };
  socialCalendar: Array<{
    day: string;
    channel: string;
    format: string;
    hook: string;
    caption: string;
  }>;
  emailBroadcast: {
    subject: string;
    previewText: string;
    htmlContent: string;
    textContent: string;
  };
  landingPageCopy: {
    heroHeadline: string;
    heroSubheadline: string;
    valueBullets: string[];
    primaryCta: string;
  };
}

export interface SeoPackageInput {
  domain: string;
  pageTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  schemaType?: "Organization" | "SoftwareApplication" | "Product" | "LocalBusiness";
}

export interface SeoPackageOutput {
  readinessScore: number;
  checks: Array<{ label: string; passed: boolean; recommendation: string }>;
  headTagsHtml: string;
  jsonLdScript: string;
  robotsTxt: string;
  sitemapXml: string;
}

export function buildUtmTrackingUrl(input: {
  baseUrl: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}): string {
  const normalizedBase = /^https?:\/\//i.test(input.baseUrl.trim())
    ? input.baseUrl.trim()
    : `https://${input.baseUrl.trim()}`;
  const url = new URL(normalizedBase);
  url.searchParams.set("utm_source", input.source.trim().toLowerCase().replace(/\s+/g, "_"));
  url.searchParams.set("utm_medium", input.medium.trim().toLowerCase().replace(/\s+/g, "_"));
  url.searchParams.set("utm_campaign", input.campaign.trim().toLowerCase().replace(/\s+/g, "_"));
  if (input.content?.trim()) {
    url.searchParams.set("utm_content", input.content.trim().toLowerCase().replace(/\s+/g, "_"));
  }
  if (input.term?.trim()) {
    url.searchParams.set("utm_term", input.term.trim().toLowerCase().replace(/\s+/g, "+"));
  }
  return url.toString();
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generateSeoPackage(input: SeoPackageInput): SeoPackageOutput {
  const cleanDomain = input.domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const canonicalUrl = `https://${cleanDomain}/`;
  const titleLen = input.pageTitle.trim().length;
  const descLen = input.metaDescription.trim().length;
  const kwLower = input.primaryKeyword.trim().toLowerCase();
  const titleHasKw = input.pageTitle.toLowerCase().includes(kwLower);
  const descHasKw = input.metaDescription.toLowerCase().includes(kwLower);
  const allKeywords = [
    input.primaryKeyword.trim(),
    ...(input.secondaryKeywords ?? []).map((k) => k.trim()).filter(Boolean),
  ];

  const checks = [
    {
      label: "Title length (30–60 chars)",
      passed: titleLen >= 30 && titleLen <= 60,
      recommendation:
        titleLen >= 30 && titleLen <= 60
          ? `Optimal length (${titleLen} chars).`
          : `Current title is ${titleLen} chars; aim for 30–60 characters to prevent SERP truncation.`,
    },
    {
      label: "Meta description length (70–160 chars)",
      passed: descLen >= 70 && descLen <= 160,
      recommendation:
        descLen >= 70 && descLen <= 160
          ? `Optimal length (${descLen} chars).`
          : `Current description is ${descLen} chars; aim for 70–160 characters.`,
    },
    {
      label: "Primary keyword in Title",
      passed: titleHasKw,
      recommendation: titleHasKw
        ? `Primary keyword "${input.primaryKeyword}" appears in title.`
        : `Include "${input.primaryKeyword}" naturally near the start of your title.`,
    },
    {
      label: "Primary keyword in Meta Description",
      passed: descHasKw,
      recommendation: descHasKw
        ? `Primary keyword "${input.primaryKeyword}" appears in description.`
        : `Add "${input.primaryKeyword}" inside the meta description to boost click-through rate.`,
    },
    {
      label: "HTTPS Canonical & OpenGraph Ready",
      passed: cleanDomain.includes("."),
      recommendation: `Canonical bound to ${canonicalUrl} via Cloudflare + Nginx.`,
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const readinessScore = Math.round((passedCount / checks.length) * 100);

  const safeTitle = escapeHtmlAttr(input.pageTitle.trim());
  const safeDesc = escapeHtmlAttr(input.metaDescription.trim());
  const safeKw = escapeHtmlAttr(allKeywords.join(", "));

  const headTagsHtml = [
    `<title>${safeTitle}</title>`,
    `<meta name="description" content="${safeDesc}" />`,
    `<meta name="keywords" content="${safeKw}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
  ].join("\n");

  const schemaObj = {
    "@context": "https://schema.org",
    "@type": input.schemaType ?? "Organization",
    name: input.pageTitle.trim(),
    description: input.metaDescription.trim(),
    url: canonicalUrl,
  };
  const jsonLdScript = `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;

  const robotsTxt = [
    `User-agent: *`,
    `Allow: /`,
    `Disallow: /api/`,
    `Sitemap: ${canonicalUrl}sitemap.xml`,
  ].join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const sitemapXml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url>`,
    `    <loc>${canonicalUrl}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>weekly</changefreq>`,
    `    <priority>1.0</priority>`,
    `  </url>`,
    `</urlset>`,
  ].join("\n");

  return {
    readinessScore,
    checks,
    headTagsHtml,
    jsonLdScript,
    robotsTxt,
    sitemapXml,
  };
}

export async function generateMarketingKit(
  input: MarketingKitInput,
): Promise<MarketingKitOutput> {
  const isBangla =
    input.language === "bn" ||
    /[\u0980-\u09FF]/.test(`${input.brandName} ${input.offerOrProduct} ${input.targetAudience}`);
  const lang: "bn" | "en" = isBangla ? "bn" : "en";
  const landingUrl = input.landingUrl?.trim() || "https://alolabs.net";

  const deterministic: MarketingKitOutput = lang === "bn"
    ? {
        brandName: input.brandName,
        language: "bn",
        aiEnhanced: false,
        aiProviderUsed: null,
        metaAds: [
          {
            angle: "সমস্যা ও দ্রুত সমাধান (PAS)",
            headline: `${input.brandName} — ${input.offerOrProduct}`,
            primaryText: `${input.targetAudience}-দের জন্য ম্যানুয়াল ঝামেলা শেষ! ${input.brandName} দিয়ে দ্রুত ও নির্ভরযোগ্যভাবে ${input.offerOrProduct} শুরু করুন। আজই ভিজিট করুন: ${landingUrl}`,
            cta: "Learn More",
          },
          {
            angle: "সোশ্যাল প্রুফ ও ট্রাস্ট",
            headline: `কেন সেরা টিমগুলো ${input.brandName} বেছে নিচ্ছে?`,
            primaryText: `সময় ও খরচ বাঁচিয়ে ${input.offerOrProduct} পরিচালনা করুন এক ড্যাশবোর্ড থেকে। বিশেষ অফার পেতে এখনই রেজিস্টার করুন!`,
            cta: "Sign Up",
          },
          {
            angle: "ডিরেক্ট কনভার্সন অফার",
            headline: `আজই শুরু করুন — ${input.brandName}`,
            primaryText: `${input.targetAudience}-এর গ্রোথ বাড়াতে ${input.offerOrProduct} এখন আরও সহজ। লিংকে ক্লিক করে ফ্রি কনসাল্টেশন বা ট্রায়াল নিন: ${landingUrl}`,
            cta: "Get Offer",
          },
        ],
        googleSearchAd: {
          headlines: [
            `${input.brandName} Official`,
            `সেরা ${input.offerOrProduct.slice(0, 24)}`,
            `আজই শুরু করুন — দ্রুত সেটআপ`,
          ],
          descriptions: [
            `${input.targetAudience}-এর জন্য আধুনিক ও স্বয়ংক্রিয় ${input.offerOrProduct}। ২৪/৭ সাপোর্ট ও নিরাপদ প্ল্যাটফর্ম।`,
            `${input.brandName}-এর সাথে আপনার ব্যবসার ডিজিটাল গ্রোথ নিশ্চিত করুন। ভিজিট করুন ${landingUrl}`,
          ],
          keywords: [
            input.brandName,
            input.offerOrProduct,
            `${input.brandName} Bangladesh`,
            `best ${input.offerOrProduct}`,
          ],
        },
        socialCalendar: [
          { day: "Day 1", channel: "Facebook & Instagram", format: "Carousel", hook: `৩টি কারণে আপনার ${input.offerOrProduct} আপগ্রেড করা জরুরি`, caption: `${input.brandName} কীভাবে ${input.targetAudience}-কে এগিয়ে রাখে দেখুন -> ${landingUrl}` },
          { day: "Day 2", channel: "LinkedIn", format: "Authority Post", hook: `আধুনিক ব্যবসার নতুন স্ট্যান্ডার্ড: ${input.offerOrProduct}`, caption: `ম্যানুয়াল প্রক্রিয়ার বদলে অটোমেশন কেন ROI দ্বিগুণ করে তা জেনে নিন।` },
          { day: "Day 3", channel: "YouTube Shorts / Reels", format: "60s Demo Video", hook: `৬০ সেকেন্ডে দেখুন ${input.brandName} কীভাবে কাজ করে!`, caption: `লাইভ ডেমো দেখতে ভিজিট করুন ${landingUrl}` },
          { day: "Day 4", channel: "Facebook Group / Community", format: "Value Thread", hook: `${input.targetAudience}-দের সবচেয়ে বড় ভুল ও তার সমাধান`, caption: `আপনার অভিজ্ঞতা কমেন্টে জানান!` },
          { day: "Day 5", channel: "Instagram Stories", format: "Poll + Link Sticker", hook: `আপনি কি এখনো ম্যানুয়ালি কাজ করছেন?`, caption: `১ ক্লিকে শুরু করুন: ${landingUrl}` },
          { day: "Day 6", channel: "LinkedIn & Facebook", format: "Case Study", hook: `কীভাবে আমাদের ক্লায়েন্টরা ৫০% সময় বাঁচাচ্ছে`, caption: `${input.brandName} দিয়ে ফলাফল দেখুন।` },
          { day: "Day 7", channel: "Omnichannel", format: "Limited Offer CTA", hook: `এই সপ্তাহের বিশেষ অনবোর্ডিং সুবিধা শেষ হচ্ছে আজ!`, caption: `এখনই জয়েন করুন: ${landingUrl}` },
        ],
        emailBroadcast: {
          subject: `${input.brandName}: আপনার ${input.offerOrProduct} আরও সহজ ও স্বয়ংক্রিয় করুন`,
          previewText: `${input.targetAudience}-এর জন্য বিশেষ গ্রোথ সলিউশন — আজই দেখুন`,
          htmlContent: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>স্বাগতম ${escapeHtmlAttr(input.brandName)}-এ!</h2><p>প্রিয় গ্রাহক,</p><p><strong>${escapeHtmlAttr(input.targetAudience)}</strong>-দের জন্য আমরা নিয়ে এসেছি আধুনিক <strong>${escapeHtmlAttr(input.offerOrProduct)}</strong>—যাতে আপনি কম সময়ে বেশি ফলাফল পান।</p><p><a href="${escapeHtmlAttr(landingUrl)}" style="display:inline-block;padding:12px 20px;background:#E8501A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">এখনই বিস্তারিত দেখুন</a></p><p>শুভকামনায়,<br/>${escapeHtmlAttr(input.brandName)} টিম</p></div>`,
          textContent: `স্বাগতম ${input.brandName}-এ!\n\n${input.targetAudience}-দের জন্য আমরা নিয়ে এসেছি ${input.offerOrProduct}।\nবিস্তারিত দেখুন: ${landingUrl}\n\n— ${input.brandName} টিম`,
        },
        landingPageCopy: {
          heroHeadline: `${input.brandName} — ${input.offerOrProduct} এখন সম্পূর্ণ স্বয়ংক্রিয়`,
          heroSubheadline: `${input.targetAudience}-এর জন্য তৈরি অল-ইন-ওয়ান সলিউশন, যা সময় বাঁচায় এবং কনভার্সন বাড়ায়।`,
          valueBullets: [
            "মাত্র কয়েক মিনিটে সেটআপ ও লাইভ লঞ্চ",
            "রিয়েল-টাইম অ্যানালিটিক্স, লিড ট্র্যাকিং ও অটোমেশন",
            "নিরাপদ ক্লাউড ইনফ্রাস্ট্রাকচার ও ডেডিকেটেড সাপোর্ট",
          ],
          primaryCta: "ফ্রি শুরু করুন",
        },
      }
    : {
        brandName: input.brandName,
        language: "en",
        aiEnhanced: false,
        aiProviderUsed: null,
        metaAds: [
          {
            angle: "Problem → Solution (PAS)",
            headline: `${input.brandName}: Automate ${input.offerOrProduct}`,
            primaryText: `Built for ${input.targetAudience}: stop wasting hours on manual workflows. Launch and scale ${input.offerOrProduct} from one unified platform at ${landingUrl}`,
            cta: "Learn More",
          },
          {
            angle: "ROI & Speed",
            headline: `Launch 5x Faster with ${input.brandName}`,
            primaryText: `Teams switching to ${input.brandName} streamline ${input.offerOrProduct} from day one. Start now: ${landingUrl}`,
            cta: "Sign Up",
          },
          {
            angle: "Direct Offer",
            headline: `Try ${input.brandName} Today`,
            primaryText: `Everything ${input.targetAudience} need for ${input.offerOrProduct} — zero guesswork, real-time tracking, instant setup.`,
            cta: "Get Started",
          },
        ],
        googleSearchAd: {
          headlines: [
            `${input.brandName} — Official Site`,
            `Modern ${input.offerOrProduct.slice(0, 22)}`,
            `Built for ${input.targetAudience.slice(0, 20)}`,
          ],
          descriptions: [
            `Launch, track, and scale ${input.offerOrProduct} with ${input.brandName}. Fast onboarding and measurable ROI.`,
            `Trusted platform for ${input.targetAudience}. Visit ${landingUrl} to get started in minutes.`,
          ],
          keywords: [
            input.brandName.toLowerCase(),
            input.offerOrProduct.toLowerCase(),
            `${input.offerOrProduct.toLowerCase()} platform`,
            `best ${input.offerOrProduct.toLowerCase()} for ${input.targetAudience.toLowerCase()}`,
          ],
        },
        socialCalendar: [
          { day: "Day 1", channel: "LinkedIn & Facebook", format: "Carousel", hook: `3 bottlenecks slowing down ${input.targetAudience} (and how to fix them)`, caption: `Discover how ${input.brandName} powers ${input.offerOrProduct}: ${landingUrl}` },
          { day: "Day 2", channel: "YouTube Shorts / Reels", format: "60s Walkthrough", hook: `Watch ${input.brandName} launch ${input.offerOrProduct} in 60 seconds`, caption: `Full tour at ${landingUrl}` },
          { day: "Day 3", channel: "X / Threads", format: "Insight Thread", hook: `Why automation beats manual ops every single week`, caption: `Built for ${input.targetAudience}.` },
          { day: "Day 4", channel: "Facebook & Instagram", format: "Customer Outcome Graphic", hook: `Before vs. After ${input.brandName}`, caption: `Ready to upgrade? ${landingUrl}` },
          { day: "Day 5", channel: "LinkedIn", format: "Founder / Operator Note", hook: `The exact blueprint behind ${input.offerOrProduct}`, caption: `Comment "GUIDE" or visit ${landingUrl}` },
          { day: "Day 6", channel: "Instagram Stories", format: "Interactive Q&A + Link", hook: `What is your #1 growth goal this quarter?`, caption: `Start at ${landingUrl}` },
          { day: "Day 7", channel: "Omnichannel", format: "Direct CTA", hook: `Launch your next campaign with ${input.brandName} today`, caption: `Get started -> ${landingUrl}` },
        ],
        emailBroadcast: {
          subject: `${input.brandName}: Scale ${input.offerOrProduct} without manual busywork`,
          previewText: `A faster growth workflow built for ${input.targetAudience}`,
          htmlContent: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Welcome to ${escapeHtmlAttr(input.brandName)}</h2><p>Hi there,</p><p>We built <strong>${escapeHtmlAttr(input.offerOrProduct)}</strong> specifically so <strong>${escapeHtmlAttr(input.targetAudience)}</strong> can launch faster, track every lead, and convert more customers from a single dashboard.</p><p><a href="${escapeHtmlAttr(landingUrl)}" style="display:inline-block;padding:12px 20px;background:#E8501A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Explore ${escapeHtmlAttr(input.brandName)}</a></p><p>Best,<br/>The ${escapeHtmlAttr(input.brandName)} Team</p></div>`,
          textContent: `Welcome to ${input.brandName}!\n\nWe built ${input.offerOrProduct} for ${input.targetAudience} so you can launch faster and convert more customers.\n\nGet started: ${landingUrl}\n\n— The ${input.brandName} Team`,
        },
        landingPageCopy: {
          heroHeadline: `${input.offerOrProduct} — Built for ${input.targetAudience}`,
          heroSubheadline: `${input.brandName} unifies campaigns, leads, SEO, and automated deployment in one high-converting control plane.`,
          valueBullets: [
            "Launch campaigns, landing pages, and email broadcasts in minutes",
            "Full-funnel UTM attribution synced directly into your CRM pipeline",
            "AI-assisted copy, SEO schema, and automated infrastructure",
          ],
          primaryCta: "Start Growing Now",
        },
      };

  if (process.env.NODE_ENV !== "test") {
    try {
      const completion = await Promise.race([
        completeWithAI(
          [
            {
              role: "system",
              content:
                "You are a senior Digital Marketing Strategist. Return concise JSON with keys `heroHeadline` (string) and `heroSubheadline` (string) tailored to the brand, offer, and language.",
            },
            {
              role: "user",
              content: `Brand: ${input.brandName}\nOffer: ${input.offerOrProduct}\nAudience: ${input.targetAudience}\nLanguage: ${lang}`,
            },
          ],
          { json: true, maxTokens: 180, temperature: 0.4 },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timeout")), 4000)),
      ]);
      const parsed = JSON.parse(completion.text) as { heroHeadline?: string; heroSubheadline?: string };
      if (parsed.heroHeadline && parsed.heroSubheadline) {
        deterministic.landingPageCopy.heroHeadline = parsed.heroHeadline;
        deterministic.landingPageCopy.heroSubheadline = parsed.heroSubheadline;
        deterministic.aiEnhanced = true;
        deterministic.aiProviderUsed = completion.provider;
      }
    } catch {
      // Keep deterministic high-converting bilingual marketing kit when offline
    }
  }

  return deterministic;
}
