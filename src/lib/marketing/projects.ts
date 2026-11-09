/**
 * Projects showcase registry.
 *
 * This is the only file you edit to change what the public landing page shows.
 * Each entry is a plain object — add, remove or reorder them and the homepage,
 * /projects, /projects/[slug] and the sitemap all follow.
 *
 * Rules that keep the page honest:
 *   - `status` reflects reality: "live" only if it is actually serving users.
 *   - `url` is optional. Leave it out for internal tools; the card then says
 *     "Team sign-in" instead of pretending there is a public link.
 *   - no invented metrics. If you have real numbers, put them in `highlights`.
 */

export type ProjectStatus = "live" | "beta" | "internal" | "archived";

export interface ShowcaseProject {
  slug: string;
  name: string;
  /** One line, shown under the name on cards. */
  tagline: string;
  /** Two or three sentences for the project's own page. */
  description: string;
  status: ProjectStatus;
  /** Grouping label, e.g. "Platform", "Operations", "Client systems". */
  category: string;
  /** Public URL. Omit for internal-only projects. */
  url?: string;
  /** Text for the card button when `url` is set. */
  urlLabel?: string;
  /** Where the team signs in when there is no public URL. */
  dashboardHref?: string;
  /** Objections-free facts: what it does, not marketing claims. */
  highlights: string[];
  tags: string[];
  /** Year it went into service. */
  since: number;
  /** Optional stack summary, shown on the detail page. */
  stack?: string[];
}

export const PROJECTS: ShowcaseProject[] = [
  {
    slug: "hosting-portal",
    name: "ALO Hosting Portal",
    tagline: "The platform our own sites, domains and mail run on.",
    description:
      "A single control plane for everything we host: site provisioning, DNS, SSL lifecycle, mailboxes, backups and billing. It runs on our own servers, and every screen in it talks to infrastructure we operate rather than a third-party reseller API.",
    status: "live",
    category: "Platform",
    url: "https://hosting.alolabs.net",
    urlLabel: "Open portal",
    highlights: [
      "Site provisioning, SSL issuance and DNS handled in one workflow",
      "Domains, mailboxes, backups and invoices under one account",
      "Role-based access with MFA for every operator",
      "Health, uptime and certificate expiry monitored continuously",
    ],
    tags: ["Next.js", "Control plane", "Infrastructure"],
    since: 2024,
    stack: ["Next.js 16", "React 19", "Prisma + SQLite (libSQL)", "Caddy", "Linux / systemd"],
  },
  {
    slug: "industry-systems",
    name: "Industry Systems",
    tagline: "Ready-to-adapt software for 20 industries, built and maintained by us.",
    description:
      "A catalogue of industry software families — education, healthcare, retail, logistics, finance, legal and more — each with defined modules, prerequisites and exclusions. These are systems we build and run for clients rather than templates we resell.",
    status: "live",
    category: "Client systems",
    url: "/industries",
    urlLabel: "Browse systems",
    highlights: [
      "20 published industry families with module-level detail",
      "Requirements, prerequisites and exclusions written down",
      "Delivered on the same infrastructure as this portal",
    ],
    tags: ["Solutions", "Client work"],
    since: 2023,
  },
  {
    slug: "crm",
    name: "ALO CRM",
    tagline: "Contacts, pipelines and follow-ups for our own sales work.",
    description:
      "The CRM we use internally: contacts, companies, deal pipelines, activity logging and lead intake from the website. It is part of the portal rather than a separate product, so a new enquiry lands in the same place the rest of the work is tracked.",
    status: "live",
    category: "Operations",
    dashboardHref: "/dashboard/crm",
    highlights: [
      "Contacts, companies and pipelines in one view",
      "Website enquiry intake routed straight into the CRM",
      "Activity history attached to every deal",
    ],
    tags: ["CRM", "Operations"],
    since: 2024,
  },
  {
    slug: "ai-automations",
    name: "AI Assistant & Automations",
    tagline: "Model-backed assistants and scheduled workflows, with logs you can read.",
    description:
      "Assistants and automations that run inside the portal: a support assistant, a deployment helper and scheduled workflows that mix model calls with read-only hosting queries. Every run is logged step by step, and nothing runs without a configured provider.",
    status: "beta",
    category: "Operations",
    dashboardHref: "/ai/automations",
    highlights: [
      "Provider chain with failover — no key, no answer, no fake output",
      "Automations run server-side with per-step run history",
      "Read-only hosting queries scoped to one account",
    ],
    tags: ["AI", "Automation"],
    since: 2025,
  },
];

export function getProject(slug: string): ShowcaseProject | undefined {
  return PROJECTS.find((project) => project.slug === slug);
}

export function otherProjects(slug: string, count = 3): ShowcaseProject[] {
  return PROJECTS.filter((project) => project.slug !== slug).slice(0, count);
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  live: "Live",
  beta: "Beta",
  internal: "Internal",
  archived: "Archived",
};

/** Card/detail CTA — a real link when public, otherwise the sign-in path. */
export function projectAction(project: ShowcaseProject): {
  href: string;
  label: string;
  external: boolean;
} {
  if (project.url) {
    return {
      href: project.url,
      label: project.urlLabel ?? "Open project",
      external: project.url.startsWith("http"),
    };
  }
  return {
    href: project.dashboardHref ?? "/login",
    label: "Team sign-in",
    external: false,
  };
}
