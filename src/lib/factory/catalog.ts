/**
 * Software Factory domain library — zod schemas, constants and the read
 * helpers used by public pages and the Super Admin registry APIs.
 *
 * Content definitions live in `./industry-definitions` and
 * `./service-definitions`; this module owns validation and data access.
 */
import { z } from "zod";

export const SERVICE_CATEGORIES = [
  "software",
  "marketing",
  "seo",
  "email",
  "whatsapp",
  "social",
  "analytics",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  software: "Software & Digital Services",
  marketing: "Digital Marketing",
  seo: "SEO Marketing",
  email: "Email Marketing",
  whatsapp: "WhatsApp Business & Sharing",
  social: "Social Media",
  analytics: "Analytics & Reporting",
};

export const INDUSTRY_STATUSES = ["draft", "published", "hidden"] as const;
export const SERVICE_STATUSES = ["draft", "published", "retired"] as const;
export const MAPPING_RELATIONS = ["core", "recommended", "optional"] as const;

const jsonRecord = z.record(z.string(), z.unknown());

const moduleSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  mandatory: z.boolean(),
});

const featureGroupSchema = z.object({
  group: z.string().min(1).max(120),
  items: z.array(z.string().min(1).max(200)).min(1),
});

const faqSchema = z.object({
  q: z.string().min(1).max(300),
  a: z.string().min(1).max(600),
});

const deliverableSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(400).optional(),
});

const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase kebab-case only");

export const createIndustrySchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(120),
  tagline: z.string().min(2).max(220),
  summary: z.string().min(2).max(400),
  icon: z.string().min(1).max(60).default("Building2"),
  accentFrom: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#4f46e5"),
  accentTo: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#9333ea"),
  order: z.number().int().min(0).default(0),
  status: z.enum(INDUSTRY_STATUSES).default("draft"),
  modules: z.array(moduleSchema).min(1),
  features: z.array(featureGroupSchema).min(1),
  challenges: z.array(z.object({ title: z.string().min(1).max(200), description: z.string().min(1).max(400) })).default([]),
  workflow: z.array(z.string().min(1).max(300)).default([]),
  faqs: z.array(faqSchema).default([]),
  reports: z.array(z.string().min(1).max(200)).default([]),
});

export const updateIndustrySchema = createIndustrySchema.partial().omit({ slug: true });

export const createServiceSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  summary: z.string().min(2).max(300),
  description: z.string().min(2).max(1200),
  deliverables: z.array(deliverableSchema).min(1),
  prerequisites: z.array(z.string().min(1).max(300)).default([]),
  exclusions: z.array(z.string().min(1).max(300)).default([]),
  requiredApps: z.array(slugSchema).default([]),
  status: z.enum(SERVICE_STATUSES).default("draft"),
  order: z.number().int().min(0).default(0),
  industries: z
    .array(z.object({ industry: slugSchema, relation: z.enum(MAPPING_RELATIONS) }))
    .default([]),
});

export const updateServiceSchema = createServiceSchema
  .partial()
  .omit({ slug: true, industries: true });

export type CreateIndustryInput = z.infer<typeof createIndustrySchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

/**
 * Normalise JSON payloads coming back from Prisma (Json columns are typed as
 * InputJsonValue) into the exact shapes the UI expects. Anything malformed
 * degrades to an empty list instead of crashing a page.
 */
export function asArray<T = unknown>(value: unknown, guard: (v: unknown) => v is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

export function normalizeModules(value: unknown) {
  return asArray(value, isObject).filter(
    (m) => isString(m.key) && isString(m.name) && isString(m.description)
  );
}

export function normalizeStrings(value: unknown): string[] {
  return asArray(value, isString);
}

export function normalizeFeatureGroups(value: unknown) {
  return asArray(value, isObject).filter(
    (g) => isString(g.group) && Array.isArray(g.items)
  ) as { group: string; items: unknown[] }[];
}

export function normalizeFaqs(value: unknown) {
  return asArray(value, isObject).filter((f) => isString(f.q) && isString(f.a)) as { q: string; a: string }[];
}

export function normalizeChallenges(value: unknown) {
  return asArray(value, isObject).filter((c) => isString(c.title) && isString(c.description)) as {
    title: string;
    description: string;
  }[];
}

export function normalizeDeliverables(value: unknown) {
  return asArray(value, isObject).filter((d) => isString(d.name)) as { name: string; description?: unknown }[];
}

// ── Read helpers (used by server pages and tests) ───────────────────────────

export type DbClient = {
  // Structural match against PrismaClient: Prisma's generic method signatures
  // are not assignable to strict Record-typed parameters, so these stay loose
  // while the normalize/read helpers above return the precise row types.
  industrySystem: {
     
    findMany(args?: any): Promise<any>;
     
    findUnique(args?: any): Promise<any>;
     
    count(args?: any): Promise<number>;
  };
  serviceDefinition: {
     
    findMany(args?: any): Promise<any>;
     
    findUnique(args?: any): Promise<any>;
     
    count(args?: any): Promise<number>;
  };
  serviceIndustry: {
     
    count(args?: any): Promise<number>;
     
    findMany(args?: any): Promise<any>;
  };
};

export interface IndustryRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  icon: string;
  accentFrom: string;
  accentTo: string;
  order: number;
  status: string;
  modules: unknown;
  features: unknown;
  challenges: unknown;
  workflow: unknown;
  faqs: unknown;
  reports: unknown;
}

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  deliverables: unknown;
  prerequisites: unknown;
  exclusions: unknown;
  requiredApps: unknown;
  priceMode: string;
  status: string;
  order: number;
}

export interface ServiceMappingRow {
  relation: string;
  service: ServiceRow;
}

/** Published industry families in directory order (public pages). */
export async function listPublishedIndustries(db: DbClient): Promise<IndustryRow[]> {
  return (await db.industrySystem.findMany({
    where: { status: "published" },
    orderBy: { order: "asc" },
  })) as unknown as IndustryRow[];
}

/** One published industry by slug, or null (public landing page). */
export async function getPublishedIndustry(db: DbClient, slug: string): Promise<IndustryRow | null> {
  return (await db.industrySystem.findUnique({ where: { slug } })) as unknown as IndustryRow | null;
}

/** Published services in catalog order. */
export async function listPublishedServices(db: DbClient): Promise<ServiceRow[]> {
  return (await db.serviceDefinition.findMany({
    where: { status: "published" },
    orderBy: [{ category: "asc" }, { order: "asc" }],
  })) as unknown as ServiceRow[];
}

/** Published services mapped to an industry slug, with relation labels. */
export async function listServicesForIndustry(
  db: DbClient,
  industrySlug: string
): Promise<ServiceMappingRow[]> {
  const rows = (await db.serviceIndustry.findMany({
    where: { industry: { slug: industrySlug, status: "published" }, service: { status: "published" } },
    include: { service: true },
    orderBy: { service: { order: "asc" } },
  })) as unknown as (ServiceMappingRow & { service: ServiceRow })[];
  return rows;
}
