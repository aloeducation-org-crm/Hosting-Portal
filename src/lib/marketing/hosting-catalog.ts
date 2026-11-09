/**
 * Public hosting catalogue — the single source of truth for the marketing site.
 *
 * Product pages (`/hosting/*`, `/domains`, `/email`, `/ssl`), the homepage
 * product picker, the pricing page tabs, the mega-menu and the sitemap all read
 * from this file, so a price or feature never has to be edited in two places.
 *
 * Prices are USD list prices for new customers on the published term. Term
 * pricing is expressed explicitly (`term24` / `term12` / `term1`) rather than
 * derived from a discount rate so the numbers rendered on the page are exactly
 * the numbers in this file.
 */
import {
  Building2,
  Cloud,
  Globe,
  Globe2,
  LayoutGrid,
  Mail,
  PenTool,
  Server,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type Term = "term24" | "term12" | "term1";

export interface PlanSpec {
  label: string;
  value: string;
}

export interface HostingPlan {
  id: string;
  name: string;
  tagline: string;
  /** Monthly-equivalent price per term, in USD. */
  pricing: Record<Term, number>;
  /** Renewal monthly-equivalent price once the initial term ends. */
  renewal: number;
  specs: PlanSpec[];
  features: string[];
  popular?: boolean;
  /** Overrides the default "Choose plan" behaviour. */
  ctaHref?: string;
  ctaLabel?: string;
}

export interface ProductFeature {
  title: string;
  description: string;
}

export interface ProductFaq {
  question: string;
  answer: string;
}

export interface ComparisonTable {
  columns: string[];
  rows: { label: string; values: string[] }[];
}

export interface HostingProduct {
  /** URL segment. `hosting` products live under /hosting/<slug>. */
  slug: string;
  href: string;
  name: string;
  shortName: string;
  eyebrow: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** Monthly "from" price for the cheapest plan, null when quote-only. */
  fromPrice: number | null;
  priceUnit: string;
  highlights: string[];
  plans: HostingPlan[];
  features: ProductFeature[];
  table?: ComparisonTable;
  faqs: ProductFaq[];
  seo: { title: string; description: string };
}

export const TERMS: { id: Term; months: number; label: string; note: string }[] = [
  { id: "term24", months: 24, label: "24 months", note: "Biggest saving" },
  { id: "term12", months: 12, label: "12 months", note: "Most popular" },
  { id: "term1", months: 1, label: "1 month", note: "No long commitment" },
];

export const TERM_MONTHS: Record<Term, number> = { term24: 24, term12: 12, term1: 1 };

/** USD price formatter used by every storefront surface. */
export function formatUsd(amount: number, fractionDigits = 2): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/** Monthly price shown for a plan on a given billing term. */
export function priceForTerm(plan: HostingPlan, term: Term): number {
  return plan.pricing[term];
}

/** Total charged up front for a term, rounded to cents. */
export function termTotal(plan: HostingPlan, term: Term): number {
  return Math.round(plan.pricing[term] * TERM_MONTHS[term] * 100) / 100;
}

/** Percentage saved against the 1-month price, floored to a whole number. */
export function savingsPercent(plan: HostingPlan, term: Term): number {
  const full = plan.pricing.term1;
  if (!full || term === "term1") return 0;
  return Math.floor(((full - plan.pricing[term]) / full) * 100);
}

export function cheapestPlan(product: HostingProduct): HostingPlan | undefined {
  return [...product.plans].sort((a, b) => a.pricing.term24 - b.pricing.term24)[0];
}

export interface TldPrice {
  tld: string;
  register: number;
  renewal: number;
  transfer: number;
  popular?: boolean;
}

/** Domain list prices, USD per year. */
export const TLD_PRICES: TldPrice[] = [
  { tld: ".com", register: 12.99, renewal: 15.99, transfer: 12.99, popular: true },
  { tld: ".net", register: 14.99, renewal: 17.99, transfer: 14.99 },
  { tld: ".org", register: 13.99, renewal: 16.99, transfer: 13.99 },
  { tld: ".io", register: 39.99, renewal: 44.99, transfer: 39.99 },
  { tld: ".dev", register: 15.99, renewal: 18.99, transfer: 15.99 },
  { tld: ".app", register: 16.99, renewal: 19.99, transfer: 16.99 },
  { tld: ".co", register: 29.99, renewal: 34.99, transfer: 29.99 },
  { tld: ".store", register: 4.99, renewal: 21.99, transfer: 12.99, popular: true },
  { tld: ".xyz", register: 2.99, renewal: 14.99, transfer: 10.99 },
  { tld: ".info", register: 4.99, renewal: 19.99, transfer: 14.99 },
  { tld: ".biz", register: 6.99, renewal: 18.99, transfer: 13.99 },
  { tld: ".ai", register: 79.99, renewal: 84.99, transfer: 79.99 },
  { tld: ".cloud", register: 8.99, renewal: 24.99, transfer: 18.99 },
  { tld: ".site", register: 3.99, renewal: 17.99, transfer: 12.99 },
];

export function tldPrice(tld: string): TldPrice | undefined {
  const normalized = tld.startsWith(".") ? tld.toLowerCase() : `.${tld.toLowerCase()}`;
  return TLD_PRICES.find((entry) => entry.tld === normalized);
}

/** Where our network is reachable from. Availability is per product, not a promise for every plan. */
export const DATA_CENTERS = [
  { city: "Dhaka", code: "DAC", region: "Bangladesh", flag: "🇧🇩" },
  { city: "Singapore", code: "SIN", region: "Singapore", flag: "🇸🇬" },
  { city: "Mumbai", code: "BOM", region: "India", flag: "🇮🇳" },
  { city: "Frankfurt", code: "FRA", region: "Germany", flag: "🇩🇪" },
  { city: "London", code: "LON", region: "United Kingdom", flag: "🇬🇧" },
  { city: "Amsterdam", code: "AMS", region: "Netherlands", flag: "🇳🇱" },
  { city: "New York", code: "NYC", region: "United States", flag: "🇺🇸" },
  { city: "Ashburn", code: "IAD", region: "United States", flag: "🇺🇸" },
  { city: "Dallas", code: "DAL", region: "United States", flag: "🇺🇸" },
  { city: "São Paulo", code: "GRU", region: "Brazil", flag: "🇧🇷" },
  { city: "Sydney", code: "SYD", region: "Australia", flag: "🇦🇺" },
  { city: "Tokyo", code: "NRT", region: "Japan", flag: "🇯🇵" },
] as const;

/* -------------------------------------------------------------------------- */
/*  Shared hosting                                                            */
/* -------------------------------------------------------------------------- */

const shared: HostingProduct = {
  slug: "shared",
  href: "/hosting/shared",
  name: "Web Hosting",
  shortName: "Web Hosting",
  eyebrow: "Shared hosting",
  tagline: "Fast, secure shared hosting with a free domain for the first year.",
  description:
    "Everything you need to put a website online: NVMe storage, LiteSpeed caching, free SSL, business email and a control panel you do not need a manual for.",
  icon: Globe2,
  fromPrice: 2.99,
  priceUnit: "/mo",
  highlights: [
    "Free domain for 1 year",
    "Free SSL certificate",
    "NVMe storage + LiteSpeed",
    "24/7 expert support",
  ],
  plans: [
    {
      id: "starter",
      name: "Starter",
      tagline: "One website, getting started",
      pricing: { term24: 2.99, term12: 3.99, term1: 11.99 },
      renewal: 11.99,
      specs: [
        { label: "Websites", value: "1" },
        { label: "Storage", value: "100 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Email accounts", value: "10" },
      ],
      features: [
        "1 website",
        "100 GB NVMe storage",
        "Free domain for 1 year",
        "Free SSL + free CDN",
        "Managed WordPress",
        "Weekly backups",
        "10 business email accounts",
        "24/7 support",
      ],
    },
    {
      id: "premium",
      name: "Premium",
      tagline: "Grow a real business site",
      pricing: { term24: 3.99, term12: 5.99, term1: 14.99 },
      renewal: 14.99,
      popular: true,
      specs: [
        { label: "Websites", value: "100" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Email accounts", value: "Unlimited" },
      ],
      features: [
        "Up to 100 websites",
        "200 GB NVMe storage",
        "Free domain for 1 year",
        "Free SSL + free CDN",
        "Daily backups",
        "Unlimited business email",
        "2× CPU and memory",
        "Priority 24/7 support",
      ],
    },
    {
      id: "business",
      name: "Business",
      tagline: "Performance and security at scale",
      pricing: { term24: 7.99, term12: 10.99, term1: 29.99 },
      renewal: 29.99,
      specs: [
        { label: "Websites", value: "100" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Dedicated IP", value: "Included" },
      ],
      features: [
        "Up to 100 websites",
        "200 GB NVMe storage",
        "Free domain for 1 year",
        "4× CPU and memory",
        "Daily backups + 30-day retention",
        "Dedicated IP address",
        "Malware scanner + WAF",
        "Priority 24/7 support",
      ],
    },
  ],
  features: [
    {
      title: "LiteSpeed + NVMe",
      description:
        "Every plan runs on NVMe disks behind LiteSpeed with server-level caching, so pages render in milliseconds instead of seconds.",
    },
    {
      title: "Free SSL, issued and renewed for you",
      description:
        "Let's Encrypt certificates are issued on provisioning, renewed automatically and monitored — you get a warning before anything expires.",
    },
    {
      title: "One-click WordPress, staging and migrations",
      description:
        "Install WordPress, WooCommerce or 100+ apps in a click. We migrate an existing site for free, with DNS cutover handled by our team.",
    },
    {
      title: "Backups you can actually restore",
      description:
        "Weekly backups on Starter, daily on Premium and Business, with one-click restore from the control panel and 30-day retention.",
    },
    {
      title: "Enterprise-grade network",
      description:
        "10 Gbps uplinks, DDoS filtering and a 99.9% uptime guarantee backed by an in-app credit request, not a buried clause.",
    },
    {
      title: "Support that answers in minutes",
      description:
        "24/7 chat and tickets staffed by systems engineers — average first response under 10 minutes, no scripted tier-one loop.",
    },
  ],
  table: {
    columns: ["Starter", "Premium", "Business"],
    rows: [
      { label: "Websites", values: ["1", "100", "100"] },
      { label: "NVMe storage", values: ["100 GB", "200 GB", "200 GB"] },
      { label: "Monthly visits", values: ["~25,000", "~100,000", "~200,000"] },
      { label: "Email accounts", values: ["10", "Unlimited", "Unlimited"] },
      { label: "Backups", values: ["Weekly", "Daily", "Daily, 30-day"] },
      { label: "Dedicated IP", values: ["—", "—", "Included"] },
      { label: "Free domain", values: ["1 year", "1 year", "1 year"] },
      { label: "Support", values: ["24/7", "24/7 priority", "24/7 priority"] },
    ],
  },
  faqs: [
    {
      question: "Do I need technical skills to use shared hosting here?",
      answer:
        "No. You get a file manager, one-click installers, an email manager and a website builder. If you would rather not touch anything, our team installs WordPress or migrates your current site for free.",
    },
    {
      question: "Is the free domain really free?",
      answer:
        "Yes for the first year on every annual or 24-month shared plan. From year two the domain renews at the standard list price shown on /domains, and you can turn auto-renew off at any time.",
    },
    {
      question: "What happens when my term ends?",
      answer:
        "Your plan renews at the standard monthly rate shown on each card, or you can move to a longer term at the promotional price again before renewal. We email you 30 days before any renewal.",
    },
    {
      question: "Can I move an existing website here?",
      answer:
        "Yes. Open a migration request from the dashboard with your current host's details and we copy files, databases and email, then help you switch DNS without downtime.",
    },
    {
      question: "Is there a money-back guarantee?",
      answer:
        "Shared, WordPress and cloud plans include a 30-day money-back guarantee on the hosting fee. Domain registrations, SSL purchases and add-ons are not refundable once issued.",
    },
  ],
  seo: {
    title: "Web Hosting — Free Domain, Free SSL, NVMe From $2.99/mo",
    description:
      "Fast shared web hosting with NVMe storage, LiteSpeed caching, free domain for a year, free SSL, business email and 24/7 support. 30-day money-back guarantee.",
  },
};

/* -------------------------------------------------------------------------- */
/*  WordPress hosting                                                         */
/* -------------------------------------------------------------------------- */

const wordpress: HostingProduct = {
  slug: "wordpress",
  href: "/hosting/wordpress",
  name: "WordPress Hosting",
  shortName: "WordPress",
  eyebrow: "Managed WordPress",
  tagline: "Managed WordPress that stays fast, patched and backed up without you.",
  description:
    "Purpose-built WordPress hosting with a managed core, object caching, staging environments and a security layer that blocks plugin vulnerabilities before they are exploited.",
  icon: PenTool,
  fromPrice: 2.99,
  priceUnit: "/mo",
  highlights: [
    "Managed core + plugin updates",
    "Staging environment",
    "Object caching + CDN",
    "Free migration by our team",
  ],
  plans: [
    {
      id: "wp-starter",
      name: "WP Starter",
      tagline: "One WordPress site",
      pricing: { term24: 2.99, term12: 4.99, term1: 9.99 },
      renewal: 9.99,
      specs: [
        { label: "Websites", value: "1" },
        { label: "Storage", value: "50 GB NVMe" },
        { label: "Visits", value: "~25,000/mo" },
        { label: "Staging", value: "1 environment" },
      ],
      features: [
        "1 WordPress website",
        "50 GB NVMe storage",
        "Managed core + theme updates",
        "Free SSL and CDN",
        "Weekly backups",
        "WP-CLI and SSH access",
        "24/7 support",
      ],
    },
    {
      id: "wp-business",
      name: "WP Business",
      tagline: "Growing content or store",
      pricing: { term24: 4.99, term12: 7.99, term1: 14.99 },
      renewal: 14.99,
      popular: true,
      specs: [
        { label: "Websites", value: "3" },
        { label: "Storage", value: "100 GB NVMe" },
        { label: "Visits", value: "~100,000/mo" },
        { label: "Staging", value: "3 environments" },
      ],
      features: [
        "3 WordPress websites",
        "100 GB NVMe storage",
        "Object caching (Redis)",
        "Daily backups, 30-day retention",
        "3 staging environments",
        "WooCommerce ready",
        "Priority 24/7 support",
      ],
    },
    {
      id: "wp-pro",
      name: "WP Pro",
      tagline: "Agencies and high traffic",
      pricing: { term24: 9.99, term12: 14.99, term1: 29.99 },
      renewal: 29.99,
      specs: [
        { label: "Websites", value: "10" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Visits", value: "~300,000/mo" },
        { label: "Staging", value: "Unlimited" },
      ],
      features: [
        "10 WordPress websites",
        "200 GB NVMe storage",
        "Dedicated CPU and memory",
        "Automatic plugin vulnerability patching",
        "Unlimited staging environments",
        "White-label client reports",
        "Priority 24/7 support",
      ],
    },
  ],
  features: [
    {
      title: "Managed updates, tested first",
      description:
        "Core, theme and plugin updates run in staging first, with a visual regression check and automatic rollback if a page stops rendering.",
    },
    {
      title: "Built-in caching stack",
      description:
        "LiteSpeed page cache, Redis object cache and a global CDN are enabled by default — no plugin shopping, no conflicting cache layers.",
    },
    {
      title: "Login hardening and WAF",
      description:
        "XML-RPC is off by default, login attempts are rate-limited, and a managed WAF blocks known plugin exploits before they reach PHP.",
    },
    {
      title: "Staging to production in one click",
      description:
        "Clone a site, test a redesign or a WooCommerce upgrade, then push the database and files back to production when it is verified.",
    },
    {
      title: "Free expert migration",
      description:
        "Send us your WordPress admin and hosting details. We migrate files, database, email and DNS, then check every permalink after cutover.",
    },
    {
      title: "PHP versions and WP-CLI",
      description:
        "Pick PHP 8.1–8.4 per site, run WP-CLI over SSH, and schedule cron jobs without a plugin. Everything is versioned in the dashboard.",
    },
  ],
  table: {
    columns: ["WP Starter", "WP Business", "WP Pro"],
    rows: [
      { label: "WordPress sites", values: ["1", "3", "10"] },
      { label: "NVMe storage", values: ["50 GB", "100 GB", "200 GB"] },
      { label: "Monthly visits", values: ["~25k", "~100k", "~300k"] },
      { label: "Object cache", values: ["—", "Redis", "Redis"] },
      { label: "Staging", values: ["1", "3", "Unlimited"] },
      { label: "Backups", values: ["Weekly", "Daily", "Daily + on demand"] },
      { label: "Plugin auto-patching", values: ["—", "—", "Included"] },
    ],
  },
  faqs: [
    {
      question: "Can I use my existing WordPress site?",
      answer:
        "Yes. Request a free migration from the dashboard and we copy the files, database and media, then verify permalinks, redirects and email before DNS is switched.",
    },
    {
      question: "Does this include WooCommerce?",
      answer:
        "Yes. WooCommerce runs on every WordPress plan, with Redis object caching and a staging environment for testing plugin and theme updates before they reach customers.",
    },
    {
      question: "Do you support custom plugins and themes?",
      answer:
        "Absolutely — you have SFTP, SSH and WP-CLI access. Managed updates are opt-in per plugin, so anything you maintain yourself is never changed without your approval.",
    },
    {
      question: "What happens if a plugin update breaks my site?",
      answer:
        "Managed updates run in a staging clone first. If the staged site fails its health check the update is rolled back automatically and you get a ticket explaining what happened.",
    },
  ],
  seo: {
    title: "Managed WordPress Hosting — Staging, Redis, Free Migration",
    description:
      "Managed WordPress hosting with tested core and plugin updates, Redis object cache, staging environments, a managed WAF and free expert migration.",
  },
};

/* -------------------------------------------------------------------------- */
/*  VPS hosting                                                               */
/* -------------------------------------------------------------------------- */

const vps: HostingProduct = {
  slug: "vps",
  href: "/hosting/vps",
  name: "VPS Hosting",
  shortName: "VPS",
  eyebrow: "KVM virtual servers",
  tagline: "Root access, dedicated vCPUs and NVMe disks — provisioned in under a minute.",
  description:
    "Full KVM virtualisation on AMD EPYC hosts with NVMe storage and a 10 Gbps network. Pick an OS or a one-click app, resize later with two clicks.",
  icon: Zap,
  fromPrice: 4.99,
  priceUnit: "/mo",
  highlights: [
    "Full root access",
    "NVMe storage + 10 Gbps",
    "Snapshot and restore",
    "Choose from 12 regions",
  ],
  plans: [
    {
      id: "kvm-1",
      name: "KVM 1",
      tagline: "Small services and bots",
      pricing: { term24: 4.99, term12: 5.99, term1: 7.99 },
      renewal: 7.99,
      specs: [
        { label: "vCPU", value: "1 dedicated" },
        { label: "Memory", value: "4 GB" },
        { label: "Storage", value: "50 GB NVMe" },
        { label: "Transfer", value: "4 TB" },
      ],
      features: [
        "1 dedicated vCPU",
        "4 GB DDR5 memory",
        "50 GB NVMe storage",
        "4 TB monthly transfer",
        "Full root access over SSH",
        "1 IPv4 + /64 IPv6",
        "Weekly snapshots",
      ],
    },
    {
      id: "kvm-2",
      name: "KVM 2",
      tagline: "Production apps and stores",
      pricing: { term24: 8.99, term12: 10.99, term1: 13.99 },
      renewal: 13.99,
      popular: true,
      specs: [
        { label: "vCPU", value: "2 dedicated" },
        { label: "Memory", value: "8 GB" },
        { label: "Storage", value: "100 GB NVMe" },
        { label: "Transfer", value: "8 TB" },
      ],
      features: [
        "2 dedicated vCPUs",
        "8 GB DDR5 memory",
        "100 GB NVMe storage",
        "8 TB monthly transfer",
        "Full root access over SSH",
        "Daily automatic snapshots",
        "Free control-panel installs",
      ],
    },
    {
      id: "kvm-4",
      name: "KVM 4",
      tagline: "Databases and multi-app hosts",
      pricing: { term24: 15.99, term12: 18.99, term1: 24.99 },
      renewal: 24.99,
      specs: [
        { label: "vCPU", value: "4 dedicated" },
        { label: "Memory", value: "16 GB" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Transfer", value: "16 TB" },
      ],
      features: [
        "4 dedicated vCPUs",
        "16 GB DDR5 memory",
        "200 GB NVMe storage",
        "16 TB monthly transfer",
        "Private networking",
        "Daily automatic snapshots",
        "Priority support",
      ],
    },
    {
      id: "kvm-8",
      name: "KVM 8",
      tagline: "Heavy workloads and clusters",
      pricing: { term24: 29.99, term12: 34.99, term1: 44.99 },
      renewal: 44.99,
      specs: [
        { label: "vCPU", value: "8 dedicated" },
        { label: "Memory", value: "32 GB" },
        { label: "Storage", value: "400 GB NVMe" },
        { label: "Transfer", value: "32 TB" },
      ],
      features: [
        "8 dedicated vCPUs",
        "32 GB DDR5 memory",
        "400 GB NVMe storage",
        "32 TB monthly transfer",
        "Private networking",
        "Hourly snapshots available",
        "Priority support",
      ],
    },
  ],
  features: [
    {
      title: "Provisioned in under 60 seconds",
      description:
        "Choose Ubuntu, Debian, AlmaLinux, Rocky, Windows or a one-click Docker, n8n, Ollama or panel image. Your server is reachable before your coffee lands.",
    },
    {
      title: "Dedicated vCPUs, not oversold shares",
      description:
        "Every plan gets pinned AMD EPYC cores and DDR5 memory. Resize up or down at any time and only pay the difference for the remainder of the term.",
    },
    {
      title: "Snapshots and off-host backups",
      description:
        "Take a snapshot before every change, restore in seconds, and add off-host backups if a copy of the whole volume needs to live somewhere else.",
    },
    {
      title: "Security defaults that hold up",
      description:
        "SSH key auth by default, a managed firewall, DDoS filtering and private networking between your servers — no add-on upsell for the basics.",
    },
    {
      title: "API, CLI and Terraform",
      description:
        "Automate builds with the ALO API, our CLI or the Terraform provider. The same endpoints power the dashboard, so nothing is GUI-only.",
    },
    {
      title: "No surprise egress bills",
      description:
        "Each plan includes a generous monthly transfer allowance, and extra bandwidth is billed at a published rate you can see before you deploy.",
    },
  ],
  table: {
    columns: ["KVM 1", "KVM 2", "KVM 4", "KVM 8"],
    rows: [
      { label: "vCPU (dedicated)", values: ["1", "2", "4", "8"] },
      { label: "Memory", values: ["4 GB", "8 GB", "16 GB", "32 GB"] },
      { label: "NVMe storage", values: ["50 GB", "100 GB", "200 GB", "400 GB"] },
      { label: "Transfer", values: ["4 TB", "8 TB", "16 TB", "32 TB"] },
      { label: "IPv4 / IPv6", values: ["1 / /64", "1 / /64", "1 / /64", "1 / /64"] },
      { label: "Snapshots", values: ["Weekly", "Daily", "Daily", "Hourly option"] },
      { label: "Root access", values: ["✓", "✓", "✓", "✓"] },
    ],
  },
  faqs: [
    {
      question: "Is this a managed or unmanaged server?",
      answer:
        "VPS plans are unmanaged: you get root access and full control. If you want the operating system, panel and updates handled for you, choose a managed cloud plan or ask support about our management add-on.",
    },
    {
      question: "Can I upgrade my plan later?",
      answer:
        "Yes. Resize from the dashboard whenever you need more CPU, memory or disk. The VM reboots into the new size and you are billed the prorated difference for the rest of the term.",
    },
    {
      question: "Which operating systems can I install?",
      answer:
        "Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9, Rocky 9, Fedora, Windows Server 2022, plus one-click images for Docker, n8n, Ollama, WordPress, cPanel and Plesk.",
    },
    {
      question: "Do you offer IPv6 and private networking?",
      answer:
        "Every VPS includes a /64 IPv6 block and a private network interface. Servers in the same region can talk over private IPs without touching the public internet.",
    },
    {
      question: "What is the refund policy on VPS?",
      answer:
        "New VPS orders can be cancelled within 7 days for a full refund of the hosting fee, provided the account has not breached the acceptable-use policy.",
    },
  ],
  seo: {
    title: "VPS Hosting — KVM, Dedicated vCPUs, NVMe From $4.99/mo",
    description:
      "KVM VPS hosting with dedicated AMD EPYC vCPUs, NVMe storage, 10 Gbps networking, snapshots, root access and 12 deploy regions.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Cloud hosting                                                             */
/* -------------------------------------------------------------------------- */

const cloud: HostingProduct = {
  slug: "cloud",
  href: "/hosting/cloud",
  name: "Cloud Hosting",
  shortName: "Cloud",
  eyebrow: "Managed cloud",
  tagline: "Managed cloud hosting that scales with traffic — and someone else patches the stack.",
  description:
    "Isolated cloud resources with managed PHP, MySQL and Redis, autoscaling on traffic spikes, and a dashboard that shows exactly what each site consumes.",
  icon: Cloud,
  fromPrice: 9.99,
  priceUnit: "/mo",
  highlights: [
    "Isolated CPU and RAM",
    "Autoscaling on traffic",
    "Managed PHP, MySQL, Redis",
    "Staging + free migration",
  ],
  plans: [
    {
      id: "cloud-start",
      name: "Cloud Start",
      tagline: "First production workload",
      pricing: { term24: 9.99, term12: 11.99, term1: 16.99 },
      renewal: 16.99,
      specs: [
        { label: "vCPU", value: "2" },
        { label: "Memory", value: "4 GB" },
        { label: "Storage", value: "80 GB NVMe" },
        { label: "Sites", value: "10" },
      ],
      features: [
        "2 vCPU, 4 GB memory",
        "80 GB NVMe storage",
        "10 websites",
        "Managed PHP 8.1–8.4",
        "Managed MySQL + Redis",
        "Daily backups",
        "24/7 support",
      ],
    },
    {
      id: "cloud-scale",
      name: "Cloud Scale",
      tagline: "Traffic that comes in waves",
      pricing: { term24: 24.99, term12: 28.99, term1: 39.99 },
      renewal: 39.99,
      popular: true,
      specs: [
        { label: "vCPU", value: "4" },
        { label: "Memory", value: "8 GB" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Sites", value: "50" },
      ],
      features: [
        "4 vCPU, 8 GB memory",
        "200 GB NVMe storage",
        "50 websites",
        "Autoscaling worker pool",
        "Object cache + CDN",
        "Daily backups, 30-day retention",
        "Priority 24/7 support",
      ],
    },
    {
      id: "cloud-pro",
      name: "Cloud Pro",
      tagline: "High-traffic stores and APIs",
      pricing: { term24: 49.99, term12: 55.99, term1: 74.99 },
      renewal: 74.99,
      specs: [
        { label: "vCPU", value: "8" },
        { label: "Memory", value: "16 GB" },
        { label: "Storage", value: "400 GB NVMe" },
        { label: "Sites", value: "Unlimited" },
      ],
      features: [
        "8 vCPU, 16 GB memory",
        "400 GB NVMe storage",
        "Unlimited websites",
        "Dedicated database replica",
        "Hourly backups",
        "99.99% uptime SLA",
        "Named support engineer",
      ],
    },
  ],
  features: [
    {
      title: "Isolated resources",
      description:
        "Your container gets its own CPU, memory and disk quota. A noisy neighbour on a shared plan can never slow your checkout down.",
    },
    {
      title: "Autoscaling, not panic upgrades",
      description:
        "Burst capacity absorbs traffic spikes during a campaign, then scales back so you are not paying for idle cores all month.",
    },
    {
      title: "The stack is managed for you",
      description:
        "PHP-FPM tuning, MySQL configuration, Redis and TLS are patched and monitored by us. Deploy code, not OS updates.",
    },
    {
      title: "Observability included",
      description:
        "Per-site CPU, memory, latency and slow-query dashboards, with alerts to email, Slack or webhook when a threshold trips.",
    },
    {
      title: "Zero-downtime deploys",
      description:
        "Atomic releases, staging environments and instant rollback — connect a Git repository and every push can ship a tested release.",
    },
    {
      title: "99.99% uptime SLA",
      description:
        "Cloud Pro carries a written 99.99% SLA with service credits. Status history is public and incident post-mortems are published.",
    },
  ],
  table: {
    columns: ["Cloud Start", "Cloud Scale", "Cloud Pro"],
    rows: [
      { label: "vCPU", values: ["2", "4", "8"] },
      { label: "Memory", values: ["4 GB", "8 GB", "16 GB"] },
      { label: "NVMe storage", values: ["80 GB", "200 GB", "400 GB"] },
      { label: "Websites", values: ["10", "50", "Unlimited"] },
      { label: "Autoscaling", values: ["—", "✓", "✓"] },
      { label: "Backups", values: ["Daily", "Daily 30-day", "Hourly"] },
      { label: "Uptime SLA", values: ["99.9%", "99.9%", "99.99%"] },
    ],
  },
  faqs: [
    {
      question: "What is the difference between VPS and cloud hosting?",
      answer:
        "A VPS is an unmanaged virtual machine you administer yourself. Cloud hosting is a managed container with isolated resources — we handle the operating system, PHP, database and TLS, and you deploy your site.",
    },
    {
      question: "Can I run Node.js, Python or Laravel?",
      answer:
        "Yes. Cloud plans support PHP and Node.js runtimes out of the box, plus Docker-based deployments for Python, Laravel queues and background workers.",
    },
    {
      question: "How does autoscaling billing work?",
      answer:
        "Each plan includes a burst allowance. Sustained usage above your plan's baseline is shown in the dashboard and billed at a published per-hour rate — you can also set a hard cap.",
    },
    {
      question: "Do you support staging environments?",
      answer:
        "Yes, every cloud plan includes staging environments with one-click promotion, plus Git-driven deploys with atomic releases and rollback.",
    },
  ],
  seo: {
    title: "Cloud Hosting — Managed, Isolated, Autoscaling From $9.99/mo",
    description:
      "Managed cloud hosting with isolated CPU and memory, autoscaling, managed PHP/MySQL/Redis, staging environments and a 99.99% uptime SLA.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Dedicated servers                                                         */
/* -------------------------------------------------------------------------- */

const dedicated: HostingProduct = {
  slug: "dedicated",
  href: "/hosting/dedicated",
  name: "Dedicated Servers",
  shortName: "Dedicated",
  eyebrow: "Bare metal",
  tagline: "Single-tenant bare metal with IPMI access and hardware replacement in hours.",
  description:
    "Enterprise AMD EPYC and Intel Xeon servers, provisioned by hand and never oversold. Choose your RAID layout, add extra IPs and control power and console over IPMI.",
  icon: Server,
  fromPrice: 59.99,
  priceUnit: "/mo",
  highlights: [
    "Single-tenant hardware",
    "IPMI / out-of-band access",
    "RAID 1 NVMe included",
    "4-hour hardware replacement",
  ],
  plans: [
    {
      id: "ds-1",
      name: "DS-1",
      tagline: "Busy databases and panels",
      pricing: { term24: 59.99, term12: 64.99, term1: 74.99 },
      renewal: 74.99,
      specs: [
        { label: "CPU", value: "8 cores / 16 threads" },
        { label: "Memory", value: "32 GB ECC" },
        { label: "Storage", value: "2 × 512 GB NVMe" },
        { label: "Bandwidth", value: "20 TB" },
      ],
      features: [
        "8c/16t AMD EPYC",
        "32 GB ECC memory",
        "2 × 512 GB NVMe (RAID 1)",
        "20 TB transfer",
        "IPMI access",
        "1 Gbps uplink",
        "4-hour hardware SLA",
      ],
    },
    {
      id: "ds-2",
      name: "DS-2",
      tagline: "Virtualisation and heavy web",
      pricing: { term24: 99.99, term12: 109.99, term1: 129.99 },
      renewal: 129.99,
      popular: true,
      specs: [
        { label: "CPU", value: "16 cores / 32 threads" },
        { label: "Memory", value: "64 GB ECC" },
        { label: "Storage", value: "2 × 1 TB NVMe" },
        { label: "Bandwidth", value: "30 TB" },
      ],
      features: [
        "16c/32t AMD EPYC",
        "64 GB ECC memory",
        "2 × 1 TB NVMe (RAID 1)",
        "30 TB transfer",
        "IPMI access",
        "10 Gbps uplink option",
        "4-hour hardware SLA",
      ],
    },
    {
      id: "ds-4",
      name: "DS-4",
      tagline: "Clusters and high-traffic apps",
      pricing: { term24: 159.99, term12: 174.99, term1: 199.99 },
      renewal: 199.99,
      specs: [
        { label: "CPU", value: "32 cores / 64 threads" },
        { label: "Memory", value: "128 GB ECC" },
        { label: "Storage", value: "4 × 2 TB NVMe" },
        { label: "Bandwidth", value: "50 TB" },
      ],
      features: [
        "32c/64t AMD EPYC",
        "128 GB ECC memory",
        "4 × 2 TB NVMe (RAID 10)",
        "50 TB transfer",
        "IPMI + remote console",
        "10 Gbps uplink",
        "Named support engineer",
      ],
    },
  ],
  features: [
    {
      title: "Hand-built and never oversold",
      description:
        "Each server is single-tenant hardware, assembled and burn-in tested before handover. What you see in the spec sheet is what you get.",
    },
    {
      title: "Out-of-band management",
      description:
        "IPMI with remote power and console access, so a broken kernel is your problem to fix from anywhere — not a support ticket queue.",
    },
    {
      title: "Choose your RAID and OS",
      description:
        "RAID 1, 5 or 10, hardware or software, plus any OS image or a custom ISO mounted from the dashboard at install time.",
    },
    {
      title: "Hardware replaced in hours",
      description:
        "Spare disks, RAM and PSUs are stocked in every rack. A failed component is swapped under SLA, not shipped from abroad.",
    },
    {
      title: "Extra IPs and BGP",
      description:
        "Additional IPv4 and IPv6 blocks, private VLANs and BGP sessions for hybrid or multi-homed setups are available on request.",
    },
    {
      title: "Uplinks you can size",
      description:
        "1 Gbps included with unmetered-in options, or a 10 Gbps uplink with a committed throughput plan for transfer-heavy workloads.",
    },
  ],
  table: {
    columns: ["DS-1", "DS-2", "DS-4"],
    rows: [
      { label: "CPU cores", values: ["8c / 16t", "16c / 32t", "32c / 64t"] },
      { label: "ECC memory", values: ["32 GB", "64 GB", "128 GB"] },
      { label: "NVMe", values: ["2 × 512 GB", "2 × 1 TB", "4 × 2 TB"] },
      { label: "RAID", values: ["1 / 10", "1 / 10", "1 / 10 / 5"] },
      { label: "Transfer", values: ["20 TB", "30 TB", "50 TB"] },
      { label: "Uplink", values: ["1 Gbps", "1 Gbps", "10 Gbps"] },
      { label: "IPMI", values: ["✓", "✓", "✓"] },
    ],
  },
  faqs: [
    {
      question: "How long does provisioning take?",
      answer:
        "Standard configurations are delivered within 4 business hours; custom RAID, extra IPs or Windows licensing can take up to one business day. You get status emails at each step.",
    },
    {
      question: "Can you install a control panel for me?",
      answer:
        "Yes. We install cPanel, Plesk, DirectAdmin or a plain LAMP/LEMP stack at no extra labour cost. Panel licences are billed separately at the vendor's rate.",
    },
    {
      question: "Do you manage the server?",
      answer:
        "Dedicated servers are unmanaged by default. A fully managed add-on covers OS patching, monitoring, backup verification and 24/7 incident response.",
    },
    {
      question: "What does the hardware SLA cover?",
      answer:
        "Failed CPU, RAM, disk, PSU or network components are replaced within 4 hours of diagnosis, 24/7. SLA credits apply if we miss that window.",
    },
  ],
  seo: {
    title: "Dedicated Server Hosting — Bare Metal, IPMI, From $59.99/mo",
    description:
      "Single-tenant dedicated servers with AMD EPYC, ECC memory, NVMe RAID, IPMI access, 1–10 Gbps uplinks and a 4-hour hardware replacement SLA.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Reseller / agency                                                         */
/* -------------------------------------------------------------------------- */

const reseller: HostingProduct = {
  slug: "reseller",
  href: "/hosting/reseller",
  name: "Reseller Hosting",
  shortName: "Reseller",
  eyebrow: "Agency & reseller",
  tagline: "Run client hosting under your own brand, with white-label billing and support.",
  description:
    "cPanel/WHM accounts you can subdivide for clients, white-label DNS and nameservers, per-client billing and a support desk that answers to your brand.",
  icon: Building2,
  fromPrice: 14.99,
  priceUnit: "/mo",
  highlights: [
    "White-label cPanel / WHM",
    "Your own nameservers",
    "Per-client billing",
    "Free client migrations",
  ],
  plans: [
    {
      id: "reseller-25",
      name: "Reseller 25",
      tagline: "Freelancers and small agencies",
      pricing: { term24: 14.99, term12: 17.99, term1: 24.99 },
      renewal: 24.99,
      specs: [
        { label: "cPanel accounts", value: "25" },
        { label: "Storage", value: "100 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Nameservers", value: "White-label" },
      ],
      features: [
        "25 client cPanel accounts",
        "100 GB NVMe storage",
        "White-label nameservers",
        "WHM + free SSL for clients",
        "Per-client billing",
        "Free migrations",
        "24/7 support",
      ],
    },
    {
      id: "reseller-50",
      name: "Reseller 50",
      tagline: "Growing hosting businesses",
      pricing: { term24: 24.99, term12: 28.99, term1: 39.99 },
      renewal: 39.99,
      popular: true,
      specs: [
        { label: "cPanel accounts", value: "50" },
        { label: "Storage", value: "200 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Nameservers", value: "White-label" },
      ],
      features: [
        "50 client cPanel accounts",
        "200 GB NVMe storage",
        "White-label client area",
        "Free SSL for every client site",
        "Per-client billing + invoices",
        "Free migrations",
        "Priority 24/7 support",
      ],
    },
    {
      id: "reseller-100",
      name: "Reseller 100",
      tagline: "Established hosts",
      pricing: { term24: 39.99, term12: 44.99, term1: 59.99 },
      renewal: 59.99,
      specs: [
        { label: "cPanel accounts", value: "100" },
        { label: "Storage", value: "400 GB NVMe" },
        { label: "Bandwidth", value: "Unmetered" },
        { label: "Nameservers", value: "White-label" },
      ],
      features: [
        "100 client cPanel accounts",
        "400 GB NVMe storage",
        "White-label client area + docs",
        "Dedicated IP for your storefront",
        "Per-client billing + invoices",
        "Free migrations",
        "Named account manager",
      ],
    },
  ],
  features: [
    {
      title: "Your brand, our infrastructure",
      description:
        "White-label nameservers, client area and invoices. Your customers never see ALO Labs in a URL, an email or a footer.",
    },
    {
      title: "WHM without the learning curve",
      description:
        "Create, suspend and package client accounts from WHM, or use our simplified dashboard for the same operations with fewer clicks.",
    },
    {
      title: "Billing built for resellers",
      description:
        "Set your own prices per package, generate invoices and collect payments — or keep billing in your existing system and use our API.",
    },
    {
      title: "Support that respects your brand",
      description:
        "Escalate tickets on your client's behalf and we reply to you, not to them. Add white-label support if you want us to answer directly.",
    },
    {
      title: "Free client migrations",
      description:
        "Move an entire cPanel account list from another host with a single request. We verify mail, DNS and SSL on each account.",
    },
    {
      title: "Room to grow",
      description:
        "Add accounts or storage at any time, or graduate a heavy client onto their own VPS or cloud plan without changing providers.",
    },
  ],
  faqs: [
    {
      question: "Do I need a separate domain for my hosting brand?",
      answer:
        "Not required, but most resellers use one. Add it to your account, register white-label nameservers and point your client area at it — we handle the DNS glue records.",
    },
    {
      question: "Can my clients have their own control panel?",
      answer:
        "Yes. Each client gets an isolated cPanel account with file, email and database tools. You control packages, quotas and billing from WHM.",
    },
    {
      question: "How is billing handled?",
      answer:
        "You are billed once for your reseller plan. What you charge clients is up to you; our dashboard can generate invoices and take payment for you, or stay out of the way entirely.",
    },
    {
      question: "Is there a limit on how much I can charge?",
      answer:
        "None at all. You set your own retail prices and keep the margin. There are no per-account fees beyond the plan itself.",
    },
  ],
  seo: {
    title: "Reseller Hosting — White-Label cPanel/WHM From $14.99/mo",
    description:
      "White-label reseller hosting with cPanel/WHM, your own nameservers, per-client billing, free SSL and free migrations for every client account.",
  },
};

/* -------------------------------------------------------------------------- */
/*  CRM hosting                                                               */
/* -------------------------------------------------------------------------- */

const crm: HostingProduct = {
  slug: "crm",
  href: "/hosting/crm",
  name: "CRM Hosting",
  shortName: "CRM Hosting",
  eyebrow: "Managed CRM hosting",
  tagline: "Your CRM, hosted, hardened and backed up — with the data still yours.",
  description:
    "Managed hosting for open-source CRM platforms: SuiteCRM, EspoCRM, Vtiger, Odoo and Perfex. We deploy, patch, back up and monitor it; you keep the database and the customer records.",
  icon: Users,
  fromPrice: 9.99,
  priceUnit: "/mo",
  highlights: [
    "SuiteCRM, EspoCRM, Vtiger, Odoo",
    "Daily off-host backups",
    "Free installation + migration",
    "Your data, exportable anytime",
  ],
  plans: [
    {
      id: "crm-starter",
      name: "CRM Starter",
      tagline: "A small sales team",
      pricing: { term24: 9.99, term12: 11.99, term1: 15.99 },
      renewal: 15.99,
      specs: [
        { label: "Workspaces", value: "1 CRM" },
        { label: "Users", value: "Up to 10" },
        { label: "Storage", value: "20 GB NVMe" },
        { label: "Backups", value: "Daily, 14 days" },
      ],
      features: [
        "1 managed CRM workspace",
        "Up to 10 users",
        "20 GB NVMe storage",
        "Free SSL + custom domain",
        "Daily backups, 14-day retention",
        "Managed updates and security patches",
        "Email support, 12-hour response",
      ],
    },
    {
      id: "crm-growth",
      name: "CRM Growth",
      tagline: "Sales and support together",
      pricing: { term24: 24.99, term12: 29.99, term1: 39.99 },
      renewal: 39.99,
      popular: true,
      specs: [
        { label: "Workspaces", value: "3 CRMs" },
        { label: "Users", value: "Up to 50" },
        { label: "Storage", value: "100 GB NVMe" },
        { label: "Backups", value: "Daily, 30 days" },
      ],
      features: [
        "3 managed CRM workspaces",
        "Up to 50 users",
        "100 GB NVMe storage",
        "Staging clone for upgrades",
        "Daily backups, 30-day retention",
        "Managed updates + plugin reviews",
        "Priority support, 4-hour response",
      ],
    },
    {
      id: "crm-enterprise",
      name: "CRM Enterprise",
      tagline: "Regulated and multi-team",
      pricing: { term24: 59.99, term12: 69.99, term1: 89.99 },
      renewal: 89.99,
      specs: [
        { label: "Workspaces", value: "Unlimited" },
        { label: "Users", value: "250+" },
        { label: "Storage", value: "400 GB NVMe" },
        { label: "Backups", value: "Hourly, 30 days" },
      ],
      features: [
        "Unlimited CRM workspaces",
        "250+ users",
        "400 GB NVMe storage",
        "Dedicated database instance",
        "Hourly backups, 30-day retention",
        "Named engineer + onboarding",
        "99.9% uptime SLA",
      ],
    },
  ],
  features: [
    {
      title: "Pick your CRM, we deploy it",
      description:
        "SuiteCRM, EspoCRM, Vtiger, Odoo CRM or Perfex — choose a platform (or bring your own) and we install it with a tuned PHP/MySQL stack in under a day.",
    },
    {
      title: "Upgrades tested on a clone",
      description:
        "CRM upgrades are risky. We clone your database, run the upgrade, check the modules you rely on, and only then promote it to production.",
    },
    {
      title: "Your data stays exportable",
      description:
        "No proprietary lock-in: full MySQL dumps and file archives are downloadable from the panel at any time, including during the trial.",
    },
    {
      title: "Hardened for customer records",
      description:
        "Per-IP admin restrictions, MFA-ready login, TLS everywhere, off-host encrypted backups and audit logging on every privileged action.",
    },
    {
      title: "Email that lands",
      description:
        "Send CRM notifications through your own domain with SPF, DKIM and DMARC configured for you, so quotes and invoices reach the inbox.",
    },
    {
      title: "Migration from your old CRM",
      description:
        "We map contacts, companies, pipelines and custom fields from your current system and reconcile the record count with you before go-live.",
    },
  ],
  table: {
    columns: ["CRM Starter", "CRM Growth", "CRM Enterprise"],
    rows: [
      { label: "Workspaces", values: ["1", "3", "Unlimited"] },
      { label: "Users", values: ["10", "50", "250+"] },
      { label: "NVMe storage", values: ["20 GB", "100 GB", "400 GB"] },
      { label: "Database", values: ["Shared tuned", "Shared tuned", "Dedicated instance"] },
      { label: "Backups", values: ["Daily 14-day", "Daily 30-day", "Hourly 30-day"] },
      { label: "Staging clone", values: ["—", "✓", "✓"] },
      { label: "Response SLA", values: ["12 hours", "4 hours", "1 hour"] },
    ],
  },
  faqs: [
    {
      question: "Which CRM platforms do you host?",
      answer:
        "SuiteCRM, EspoCRM, Vtiger, Odoo CRM and Perfex CRM are supported out of the box. If you have another PHP or Python CRM, tell us in the order notes and we will confirm support before billing.",
    },
    {
      question: "Who owns the data and the database?",
      answer:
        "You do. You get full admin access, downloadable MySQL dumps and file backups. If you leave, we hand over a complete archive — there is no export fee.",
    },
    {
      question: "Can you migrate my existing CRM?",
      answer:
        "Yes. Send us access to your current CRM and hosting, and our team migrates records, custom fields, pipelines and attachments, then reconciles record counts with you before cutover.",
    },
    {
      question: "Do you customise the CRM itself?",
      answer:
        "Hosting includes installation and configuration. Custom modules, integrations and workflow development are quoted separately through our service catalogue.",
    },
    {
      question: "Is there a free trial?",
      answer:
        "We provision a 7-day evaluation workspace on request so you can confirm the platform fits before committing to a term.",
    },
  ],
  seo: {
    title: "CRM Hosting — Managed SuiteCRM, EspoCRM, Vtiger, Odoo",
    description:
      "Managed CRM hosting with free installation and migration, tested upgrades, daily off-host backups, TLS, MFA-ready login and full data portability.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Domains                                                                   */
/* -------------------------------------------------------------------------- */

const domains: HostingProduct = {
  slug: "domains",
  href: "/domains",
  name: "Domain Names",
  shortName: "Domains",
  eyebrow: "Domains",
  tagline: "Search, register and transfer domains with free privacy protection.",
  description:
    "Register a new domain or transfer an existing one. WHOIS privacy, DNS management, email forwarding and DNSSEC are included — not upsold.",
  icon: Globe,
  fromPrice: 2.99,
  priceUnit: "/yr",
  highlights: [
    "Free WHOIS privacy",
    "Free DNS + email forwarding",
    "DNSSEC support",
    "Transparent renewal pricing",
  ],
  plans: [
    {
      id: "domain-basic",
      name: "Domain",
      tagline: "Registration with the essentials",
      pricing: { term1: 12.99, term12: 12.99, term24: 12.99 },
      renewal: 15.99,
      specs: [
        { label: "Term", value: "1–10 years" },
        { label: "Privacy", value: "Included" },
        { label: "DNS records", value: "Unlimited" },
        { label: "Transfer lock", value: "On by default" },
      ],
      features: [
        "Free WHOIS privacy",
        "Free DNS management",
        "Free email forwarding",
        "DNSSEC signing",
        "Transfer lock + auth code control",
        "Automatic renewal reminders",
      ],
    },
    {
      id: "domain-premium",
      name: "Premium domain",
      tagline: "Aftermarket and short names",
      pricing: { term1: 249, term12: 249, term24: 249 },
      renewal: 249,
      specs: [
        { label: "Term", value: "1 year" },
        { label: "Privacy", value: "Included" },
        { label: "Broker", value: "Included" },
        { label: "Payment plan", value: "On request" },
      ],
      features: [
        "Broker-assisted acquisition",
        "Escrow-protected transfer",
        "Free privacy protection",
        "Free DNS management",
        "Payment plans available",
      ],
      ctaLabel: "Talk to our broker",
      ctaHref: "/support",
    },
  ],
  features: [
    {
      title: "Renewal price shown up front",
      description:
        "Every domain card lists the register price, the renewal price and the transfer price. No first-year teaser that quietly triples.",
    },
    {
      title: "Free privacy, always",
      description:
        "WHOIS privacy is enabled by default on every eligible TLD at no extra cost, so your home address is not in a public database.",
    },
    {
      title: "DNS that is actually fast",
      description:
        "Anycast DNS with unlimited records, API and Terraform support, DNSSEC and a TTL you control — changes propagate in seconds.",
    },
    {
      title: "Easy transfers in and out",
      description:
        "Transfer in with an auth code and we extend your registration by a year. Need to leave? Unlock and get your auth code from the panel instantly.",
    },
  ],
  faqs: [
    {
      question: "How do I know if a domain is available?",
      answer:
        "Use the search box above. We query the registry live and show availability per extension. Some registry lookups are rate-limited, in which case we say so instead of guessing.",
    },
    {
      question: "Is the renewal price the same as the registration price?",
      answer:
        "Not always — registries raise wholesale prices, and promotional first-year rates differ from renewals. Both numbers are shown on the price table so you can budget.",
    },
    {
      question: "Can I transfer a domain to you?",
      answer:
        "Yes. Unlock the domain at your current registrar, request the auth code, and start a transfer. Transfers add a year to your registration and usually complete in 5–7 days.",
    },
    {
      question: "Do you charge to move a domain away?",
      answer:
        "No. Unlock it in the panel and the auth code is shown immediately. We never hold a domain hostage or charge an exit fee.",
    },
  ],
  seo: {
    title: "Domain Names — Free WHOIS Privacy & Transparent Renewals",
    description:
      "Search and register domains with free WHOIS privacy, anycast DNS, email forwarding, DNSSEC and clearly published renewal prices.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Business email                                                            */
/* -------------------------------------------------------------------------- */

const email: HostingProduct = {
  slug: "email",
  href: "/email",
  name: "Business Email",
  shortName: "Email",
  eyebrow: "Business email",
  tagline: "Professional email on your own domain, with SPF, DKIM and DMARC set up for you.",
  description:
    "Mailboxes, aliases, shared inboxes and calendar on your domain, protected by spam filtering and two-factor authentication. Migration from Gmail or Outlook is free.",
  icon: Mail,
  fromPrice: 0.99,
  priceUnit: "/mailbox/mo",
  highlights: [
    "Your own domain",
    "SPF, DKIM, DMARC configured",
    "Spam + phishing filtering",
    "Free migration",
  ],
  plans: [
    {
      id: "email-starter",
      name: "Mail Starter",
      tagline: "Solo founders and small teams",
      pricing: { term24: 0.99, term12: 1.49, term1: 2.99 },
      renewal: 2.99,
      specs: [
        { label: "Storage", value: "10 GB / mailbox" },
        { label: "Aliases", value: "10" },
        { label: "Attachment size", value: "25 MB" },
        { label: "Devices", value: "Unlimited" },
      ],
      features: [
        "Mailbox on your domain",
        "10 GB storage",
        "10 aliases",
        "Webmail + IMAP/SMTP",
        "Spam and virus filtering",
        "2FA and app passwords",
      ],
    },
    {
      id: "email-business",
      name: "Mail Business",
      tagline: "Teams that live in email",
      pricing: { term24: 2.99, term12: 3.49, term1: 4.99 },
      renewal: 4.99,
      popular: true,
      specs: [
        { label: "Storage", value: "30 GB / mailbox" },
        { label: "Aliases", value: "Unlimited" },
        { label: "Attachment size", value: "50 MB" },
        { label: "Shared inbox", value: "Included" },
      ],
      features: [
        "Mailbox on your domain",
        "30 GB storage",
        "Unlimited aliases",
        "Shared inboxes + groups",
        "Calendar and contacts",
        "Advanced phishing protection",
        "Priority support",
      ],
    },
    {
      id: "email-enterprise",
      name: "Mail Enterprise",
      tagline: "Compliance and retention",
      pricing: { term24: 5.99, term12: 6.49, term1: 8.99 },
      renewal: 8.99,
      specs: [
        { label: "Storage", value: "100 GB / mailbox" },
        { label: "Aliases", value: "Unlimited" },
        { label: "Retention", value: "10 years" },
        { label: "eDiscovery", value: "Included" },
      ],
      features: [
        "Mailbox on your domain",
        "100 GB storage",
        "10-year archiving + eDiscovery",
        "Data loss prevention rules",
        "S/MIME encryption",
        "SSO / SAML",
        "Named support engineer",
      ],
    },
  ],
  features: [
    {
      title: "Deliverability done properly",
      description:
        "We publish SPF, DKIM and DMARC for your domain and monitor your sending reputation, so invoices and quotes stop landing in spam.",
    },
    {
      title: "Works with the client you already use",
      description:
        "Full IMAP, SMTP, POP3, CalDAV and CardDAV support — Outlook, Apple Mail, Thunderbird, iOS and Android all work with two-factor app passwords.",
    },
    {
      title: "Migrated without losing mail",
      description:
        "Give us access to your current mailbox and we copy messages, folders, contacts and calendars, then run both sides in parallel before switching MX.",
    },
    {
      title: "Security that is not optional",
      description:
        "TLS on every hop, phishing and impersonation detection, attachment sandboxing and enforced 2FA policies per mailbox group.",
    },
  ],
  faqs: [
    {
      question: "Is email included with hosting?",
      answer:
        "Shared, WordPress and cloud hosting plans include mailboxes for your domain. Standalone Mail plans are for domains hosted elsewhere, or when you need more storage and compliance features.",
    },
    {
      question: "Can I keep using Gmail or Outlook?",
      answer:
        "Yes, through IMAP/SMTP with an app password. You can also forward to an existing Gmail account, though we recommend the direct mailbox for full control of your data.",
    },
    {
      question: "How does migration work?",
      answer:
        "Open a migration request with your current email credentials. We copy mail and folders at no cost, then tell you exactly when to change MX records.",
    },
    {
      question: "What is the mailbox limit?",
      answer:
        "There is no hard cap on the number of mailboxes — you pay per mailbox per month. Aliases and groups do not count as mailboxes on Business and Enterprise plans.",
    },
  ],
  seo: {
    title: "Business Email Hosting — Your Domain, SPF/DKIM/DMARC, From $0.99",
    description:
      "Professional business email on your own domain with spam protection, 2FA, calendar, shared inboxes and free migration from Gmail or Outlook.",
  },
};

/* -------------------------------------------------------------------------- */
/*  SSL                                                                       */
/* -------------------------------------------------------------------------- */

const ssl: HostingProduct = {
  slug: "ssl",
  href: "/ssl",
  name: "SSL Certificates",
  shortName: "SSL",
  eyebrow: "TLS certificates",
  tagline: "Free DV certificates on every hosting plan, plus wildcard and multi-domain TLS.",
  description:
    "Encrypt every connection with automatically renewed certificates. Choose free domain-validated TLS, wildcard for subdomains, or multi-domain for many hostnames on one certificate.",
  icon: ShieldCheck,
  fromPrice: 0,
  priceUnit: "",
  highlights: [
    "Free DV with hosting",
    "Automatic renewal",
    "Wildcard subdomains",
    "Installation included",
  ],
  plans: [
    {
      id: "ssl-free",
      name: "Free DV",
      tagline: "Included with hosting",
      pricing: { term1: 0, term12: 0, term24: 0 },
      renewal: 0,
      specs: [
        { label: "Domains", value: "1 hostname" },
        { label: "Validation", value: "Domain (DV)" },
        { label: "Issued in", value: "Under 5 minutes" },
        { label: "Renewal", value: "Automatic" },
      ],
      features: [
        "1 hostname (www + apex)",
        "Let's Encrypt DV certificate",
        "Automatic issuance and renewal",
        "HTTPS redirect enforced",
        "Browser padlock + SHA-256",
        "Expiry monitoring",
      ],
      ctaLabel: "Included with hosting",
      ctaHref: "/hosting/shared",
    },
    {
      id: "ssl-wildcard",
      name: "Wildcard",
      tagline: "Unlimited subdomains",
      pricing: { term1: 49.99, term12: 49.99, term24: 49.99 },
      renewal: 59.99,
      specs: [
        { label: "Domains", value: "*.domain + apex" },
        { label: "Validation", value: "Domain (DV)" },
        { label: "Issued in", value: "Under 15 minutes" },
        { label: "Warranty", value: "$50,000" },
      ],
      features: [
        "Unlimited subdomains",
        "Apex + wildcard hostnames",
        "DNS or HTTP validation",
        "Free reissues",
        "$50,000 relying-party warranty",
        "Installation included",
      ],
    },
    {
      id: "ssl-multi",
      name: "Multi-domain",
      tagline: "Many hostnames, one certificate",
      pricing: { term1: 79.99, term12: 79.99, term24: 79.99 },
      renewal: 89.99,
      specs: [
        { label: "Domains", value: "Up to 100 names" },
        { label: "Validation", value: "Domain (DV)" },
        { label: "Issued in", value: "Under 30 minutes" },
        { label: "Warranty", value: "$100,000" },
      ],
      features: [
        "Up to 100 hostnames",
        "Add or remove names anytime",
        "Free reissues",
        "$100,000 warranty",
        "Installation included",
        "Managed renewal reminders",
      ],
    },
  ],
  features: [
    {
      title: "Issued and renewed automatically",
      description:
        "Free certificates are provisioned at site creation and renewed 30 days before expiry. If renewal ever fails, we alert you before the padlock disappears.",
    },
    {
      title: "One click to force HTTPS",
      description:
        "Redirect all HTTP traffic to HTTPS, enable HSTS with the right max-age, and fix mixed content — from the control panel, no config files.",
    },
    {
      title: "Certificates on your own domain",
      description:
        "Wildcard and multi-domain certificates are issued to your organisation, with validation instructions that do not require a support ticket.",
    },
    {
      title: "Monitoring you can see",
      description:
        "A TLS dashboard lists every hostname, issuer, expiry date and chain status. Expiring certificates raise an alert 30, 14 and 3 days out.",
    },
  ],
  faqs: [
    {
      question: "Do I need to pay for SSL?",
      answer:
        "No. Every shared, WordPress, cloud and CRM plan includes a free domain-validated certificate per hostname, renewed automatically for as long as the site is hosted with us.",
    },
    {
      question: "When do I need a wildcard certificate?",
      answer:
        "When you run many subdomains (app.example.com, shop.example.com, api.example.com). A wildcard covers any single-level subdomain plus the apex, and does not need reinstalling for each new subdomain.",
    },
    {
      question: "What is the difference between DV, OV and EV?",
      answer:
        "DV validates domain control only. OV and EV also verify the organisation and appear in some enterprise procurement checklists. Browsers no longer show an EV green bar, so DV is enough for most sites.",
    },
    {
      question: "Can you install a certificate I bought elsewhere?",
      answer:
        "Yes. Paste the certificate, private key and intermediate chain into the panel and we validate and install it, or open a support ticket and we will do it for you.",
    },
  ],
  seo: {
    title: "SSL Certificates — Free DV With Hosting, Wildcard & Multi-Domain",
    description:
      "Free automatically renewed SSL with every hosting plan, plus wildcard and multi-domain certificates with installation, monitoring and warranty.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Website builder                                                           */
/* -------------------------------------------------------------------------- */

const builder: HostingProduct = {
  slug: "website-builder",
  href: "/hosting/website-builder",
  name: "Website Builder",
  shortName: "Website Builder",
  eyebrow: "ALO Builder",
  tagline: "Describe the site you need and publish it — no code, no template shopping.",
  description:
    "An AI-assisted builder that generates a responsive site from a prompt, then lets you edit every section visually. Hosting, SSL and a domain are wired in from day one.",
  icon: LayoutGrid,
  fromPrice: 2.99,
  priceUnit: "/mo",
  highlights: [
    "Build from a prompt",
    "140+ templates",
    "Mobile-first pages",
    "Hosting + SSL included",
  ],
  plans: [
    {
      id: "builder-start",
      name: "Builder Start",
      tagline: "A single landing page",
      pricing: { term24: 2.99, term12: 3.99, term1: 6.99 },
      renewal: 6.99,
      specs: [
        { label: "Pages", value: "10" },
        { label: "Storage", value: "10 GB" },
        { label: "Forms", value: "3" },
        { label: "Domain", value: "Connect your own" },
      ],
      features: [
        "AI page generation",
        "10 pages",
        "140+ templates",
        "Contact forms",
        "Free SSL + hosting",
        "Mobile-first responsive output",
      ],
    },
    {
      id: "builder-growth",
      name: "Builder Growth",
      tagline: "A full business site",
      pricing: { term24: 6.99, term12: 8.99, term1: 12.99 },
      renewal: 12.99,
      popular: true,
      specs: [
        { label: "Pages", value: "Unlimited" },
        { label: "Storage", value: "100 GB" },
        { label: "Forms", value: "Unlimited" },
        { label: "Domain", value: "Free for 1 year" },
      ],
      features: [
        "AI page generation",
        "Unlimited pages",
        "Blog + SEO tools",
        "Ecommerce-ready product pages",
        "Free domain for 1 year",
        "Free SSL + CDN",
      ],
    },
  ],
  features: [
    {
      title: "Prompt to published page",
      description:
        "Describe your business, tone and preferred colours. The builder drafts copy, imagery and layout, then you refine it with inline editing.",
    },
    {
      title: "Real hosting behind it",
      description:
        "Builder sites run on the same NVMe infrastructure as our hosting plans — not a separate, slower platform with a different support queue.",
    },
    {
      title: "SEO and performance defaults",
      description:
        "Semantic markup, sitemap generation, canonical URLs, image compression and Core Web Vitals budgets are handled without plugins.",
    },
    {
      title: "Take the code if you outgrow it",
      description:
        "Export your site as static HTML or migrate it to WordPress. There is no proprietary lock on the content you created.",
    },
  ],
  faqs: [
    {
      question: "Do I need hosting as well?",
      answer:
        "No — hosting, SSL and CDN are included in every builder plan. You only add a domain, either by connecting one you own or registering one at checkout.",
    },
    {
      question: "Can I use my own domain?",
      answer:
        "Yes. Connect a domain you already own, or register a new one during setup and we configure DNS automatically.",
    },
    {
      question: "Can I move to WordPress later?",
      answer:
        "Yes. Export the content or ask support to convert the site to a WordPress installation on the same hosting account.",
    },
  ],
  seo: {
    title: "AI Website Builder — Prompt to Published, Hosting Included",
    description:
      "Build a responsive website from a prompt, refine it visually, and publish with hosting, SSL and CDN included. Export or migrate to WordPress anytime.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

export const HOSTING_PRODUCTS: HostingProduct[] = [
  shared,
  wordpress,
  vps,
  cloud,
  dedicated,
  reseller,
  crm,
  domains,
  email,
  ssl,
  builder,
];

/** The products promoted on the homepage picker, in display order. */
export const FEATURED_SLUGS = [
  "shared",
  "wordpress",
  "vps",
  "domains",
  "email",
  "crm",
  "cloud",
  "ssl",
] as const;

export function getProduct(slug: string): HostingProduct | undefined {
  return HOSTING_PRODUCTS.find((product) => product.slug === slug);
}

export function relatedProducts(slug: string, count = 3): HostingProduct[] {
  const index = HOSTING_PRODUCTS.findIndex((product) => product.slug === slug);
  if (index === -1) return HOSTING_PRODUCTS.slice(0, count);
  const ordered = [
    ...HOSTING_PRODUCTS.slice(index + 1),
    ...HOSTING_PRODUCTS.slice(0, index),
  ];
  return ordered.slice(0, count);
}

/** Homepage / pricing-page tabs: the plan groups worth comparing side by side. */
export const PRICING_GROUPS = [
  { slug: "shared", label: "Web hosting" },
  { slug: "wordpress", label: "WordPress" },
  { slug: "vps", label: "VPS" },
  { slug: "cloud", label: "Cloud" },
  { slug: "dedicated", label: "Dedicated" },
  { slug: "email", label: "Email" },
] as const;
