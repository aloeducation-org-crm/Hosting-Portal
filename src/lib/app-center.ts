import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

/**
 * App Center domain library.
 *
 * The catalog is defined once, globally: each app lives in `app_definitions`
 * and is reused by every company (organization). A company's install row in
 * `company_apps` carries only per-tenant overrides — its own branding and
 * settings — so nothing about one tenant's configuration can leak into
 * another's.
 *
 * Everything here except `ensureBuiltinApps` is pure, which is what makes the
 * merge rules unit-testable without a database.
 */

// ─── Categories ───────────────────────────────────────────────────────────────

export const APP_CATEGORIES = [
  { id: "finance", label: "Finance" },
  { id: "sales", label: "Sales" },
  { id: "people", label: "People" },
  { id: "projects", label: "Projects" },
  { id: "support", label: "Support" },
  { id: "ai", label: "AI" },
  { id: "content", label: "Content" },
  { id: "website", label: "Website" },
  { id: "operations", label: "Operations" },
  { id: "marketing", label: "Marketing" },
] as const;

export type AppCategoryId = (typeof APP_CATEGORIES)[number]["id"];

export const APP_CATEGORY_IDS = APP_CATEGORIES.map((c) => c.id);

// ─── Setting field descriptors (the `configSchema` shape) ────────────────────

export const settingFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "keys start with a letter and contain only letters, digits and underscores"),
    label: z.string().min(1).max(80),
    type: z.enum(["text", "number", "boolean", "select"]),
    /** Allowed for type="select" — the offered choices. */
    options: z.array(z.string().min(1).max(60)).min(1).max(50).optional(),
    /** Catalog-wide default value for this field. */
    default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
    help: z.string().max(200).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && (!field.options || field.options.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "select fields must declare options" });
    }
    if (field.default !== undefined) {
      const kind = typeof field.default;
      const ok =
        (field.type === "text" && kind === "string") ||
        (field.type === "number" && kind === "number") ||
        (field.type === "boolean" && kind === "boolean") ||
        (field.type === "select" && kind === "string" && field.options?.includes(field.default as string));
      if (!ok) {
        ctx.addIssue({ code: "custom", path: ["default"], message: "default must match the field type" });
      }
    }
  });

export type SettingField = z.infer<typeof settingFieldSchema>;

export const configSchemaSchema = z.array(settingFieldSchema).max(30);

export const settingsValuesSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(500), z.number(), z.boolean()]),
);

export type SettingsValues = Record<string, string | number | boolean>;

// ─── Branding overrides (per company) ────────────────────────────────────────

export const brandOverridesSchema = z.object({
  /** Display name override — what THIS company calls the app. */
  name: z.string().min(1).max(60).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent color must be a 6-digit hex like #E8501A")
    .nullable()
    .optional(),
});

export type BrandOverrides = z.infer<typeof brandOverridesSchema>;

// ─── Catalog definition payloads ─────────────────────────────────────────────

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Create a custom app definition (admin only). `slug` is slugified when omitted. */
export const createAppSchema = z.object({
  slug: z.string().min(2).max(40).optional(),
  name: z.string().min(2).max(60),
  summary: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(APP_CATEGORY_IDS as [string, ...string[]]),
  icon: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9]+$/, "icon must be a lucide icon name like LayoutGrid")
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent color must be a 6-digit hex like #E8501A")
    .optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "version must look like 1.0.0")
    .optional(),
  route: z
    .string()
    .min(1)
    .max(200)
    .regex(/^\/[A-Za-z0-9\-_/]*$/, "route must start with /")
    .nullable()
    .optional(),
  configSchema: configSchemaSchema.nullable().optional(),
  defaultSettings: settingsValuesSchema.nullable().optional(),
  status: z.enum(["active", "hidden"]).optional(),
});

export type CreateAppInput = z.infer<typeof createAppSchema>;

export const updateAppSchema = createAppSchema.omit({ slug: true }).partial();
export type UpdateAppInput = z.infer<typeof updateAppSchema>;

// ─── Install payloads ────────────────────────────────────────────────────────

export const installSchema = z.object({
  organizationId: z.string().min(1),
  branding: brandOverridesSchema.optional(),
  settings: settingsValuesSchema.optional(),
  enabled: z.boolean().optional(),
});
export type InstallInput = z.infer<typeof installSchema>;

export const configureInstallSchema = z.object({
  branding: brandOverridesSchema.optional(),
  settings: settingsValuesSchema.optional(),
  enabled: z.boolean().optional(),
});
export type ConfigureInstallInput = z.infer<typeof configureInstallSchema>;

// ─── Validation helpers ──────────────────────────────────────────────────────

/** Normalize a stored `configSchema` JSON blob into a validated field list. */
export function normalizeConfigSchema(raw: unknown): SettingField[] {
  const parsed = configSchemaSchema.safeParse(Array.isArray(raw) ? raw : []);
  return parsed.success ? parsed.data : [];
}

/**
 * Validate one company's settings overrides against the app's configSchema.
 * Unknown keys and wrong types are rejected per key instead of silently
 * dropped, so a typo in the Configure dialog is visible to the user.
 */
export function validateSettings(
  configSchema: unknown,
  settings: SettingsValues,
): { ok: true; value: SettingsValues } | { ok: false; errors: Record<string, string> } {
  const fields = normalizeConfigSchema(configSchema);
  const errors: Record<string, string> = {};
  const value: SettingsValues = {};

  for (const [key, val] of Object.entries(settings)) {
    const field = fields.find((f) => f.key === key);
    if (!field) {
      errors[key] = fields.length
        ? `Unknown setting "${key}" — not in this app's config schema`
        : "This app declares no config schema";
      continue;
    }
    const kind = typeof val;
    if (field.type === "text" && kind !== "string") errors[key] = `${field.label} must be text`;
    else if (field.type === "number" && (kind !== "number" || !Number.isFinite(val as number)))
      errors[key] = `${field.label} must be a number`;
    else if (field.type === "boolean" && kind !== "boolean") errors[key] = `${field.label} must be true or false`;
    else if (field.type === "select") {
      if (kind !== "string" || !field.options?.includes(val as string))
        errors[key] = `${field.label} must be one of: ${field.options?.join(", ") ?? ""}`;
    }
    if (!(key in errors)) value[key] = val;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// ─── Effective view: definition defaults overlaid with company overrides ────

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export interface AppDefinitionLike {
  name: string;
  accentColor?: string | null;
  configSchema?: unknown;
  defaultSettings?: unknown;
}

export interface InstallationLike {
  branding?: unknown;
  settings?: unknown;
}

/**
 * The settings a company actually runs with: field defaults, then the
 * catalog's defaultSettings, then the company's overrides. When the app
 * declares a config schema, overrides for keys outside it are ignored so
 * stale rows stay harmless after an app's schema evolves.
 */
export function effectiveSettings(
  definition: AppDefinitionLike,
  installation?: InstallationLike | null,
): SettingsValues {
  const fields = normalizeConfigSchema(definition.configSchema);
  const base: SettingsValues = {};
  for (const field of fields) {
    if (field.default !== undefined) base[field.key] = field.default;
  }
  Object.assign(base, asRecord(definition.defaultSettings));

  const overrides = asRecord(installation?.settings);
  for (const [key, val] of Object.entries(overrides)) {
    if (fields.length > 0 && !fields.some((f) => f.key === key)) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") base[key] = val;
  }
  return base;
}

export interface EffectiveBranding {
  name: string;
  logoUrl: string | null;
  accentColor: string;
}

/** The branding a company sees: catalog defaults overlaid with its overrides. */
export function effectiveBranding(
  definition: AppDefinitionLike,
  installation?: InstallationLike | null,
): EffectiveBranding {
  const branding = asRecord(installation?.branding);
  const str = (v: unknown, fallback: string | null): string | null =>
    typeof v === "string" && v.trim() ? v : fallback;
  return {
    name: str(branding.name, definition.name) ?? definition.name,
    logoUrl: str(branding.logoUrl, null),
    accentColor: str(branding.accentColor, definition.accentColor ?? "#E8501A") ?? "#E8501A",
  };
}

/** Catalog slug from a display name ("My Cool App" -> "my-cool-app"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isValidSlug(slug: string): boolean {
  return slugPattern.test(slug);
}

// ─── Built-in catalog ────────────────────────────────────────────────────────
// One definition per app, created once and reused by every company. Icon names
// are lucide-react component names — all verified present in the installed
// version (there is no Grid2x3).

export interface BuiltinApp {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  icon: string;
  accentColor: string;
  version: string;
  route: string | null;
  configSchema: SettingField[];
  defaultSettings: SettingsValues;
}

const currencyField: SettingField = {
  key: "currency",
  label: "Default currency",
  type: "select",
  options: ["USD", "EUR", "GBP", "BDT"],
  default: "USD",
  help: "Used for new invoices and reports",
};

const autoInvoice: SettingField = {
  key: "autoInvoice",
  label: "Auto-generate invoices",
  type: "boolean",
  default: true,
  help: "Create an invoice automatically when a deal is won",
};

export const BUILTIN_APPS: BuiltinApp[] = [
  {
    slug: "accounting",
    name: "Accounting",
    summary: "Invoices, expenses, taxes and financial reports",
    description:
      "Double-entry bookkeeping with invoicing, bill tracking, tax handling and real-time financial reporting. Every company gets its own chart of books and currency.",
    category: "finance",
    icon: "Calculator",
    accentColor: "#0F766E",
    version: "1.0.0",
    route: "/dashboard/billing",
    configSchema: [
      currencyField,
      { key: "fiscalYearStart", label: "Fiscal year starts", type: "text", default: "January" },
      { ...autoInvoice },
    ],
    defaultSettings: { currency: "USD", fiscalYearStart: "January", autoInvoice: true },
  },
  {
    slug: "crm",
    name: "CRM",
    summary: "Leads, pipelines and customer follow-ups",
    description:
      "Track leads through custom pipelines, log customer interactions and never lose a follow-up. One shared catalog app, one private pipeline per company.",
    category: "sales",
    icon: "Target",
    accentColor: "#2563EB",
    version: "1.0.0",
    route: "/dashboard/crm",
    configSchema: [
      { key: "leadScoring", label: "Enable lead scoring", type: "boolean", default: true },
      { key: "pipelineName", label: "Default pipeline name", type: "text", default: "Sales Pipeline" },
      { ...autoInvoice },
    ],
    defaultSettings: { leadScoring: true, pipelineName: "Sales Pipeline", autoInvoice: false },
  },
  {
    slug: "hr",
    name: "HR",
    summary: "Employees, leave and attendance",
    description:
      "Employee directory, time-off requests and attendance records. Each company manages its own team data with its own policies.",
    category: "people",
    icon: "Users",
    accentColor: "#7C3AED",
    version: "1.0.0",
    route: null,
    configSchema: [
      { key: "probationDays", label: "Probation period (days)", type: "number", default: 90 },
      { key: "allowHalfDay", label: "Allow half-day leave", type: "boolean", default: true },
    ],
    defaultSettings: { probationDays: 90, allowHalfDay: true },
  },
  {
    slug: "projects",
    name: "Projects",
    summary: "Tasks, milestones and Gantt-style planning",
    description:
      "Plan work in tasks and milestones, assign owners and watch progress across every project your company runs.",
    category: "projects",
    icon: "ListTodo",
    accentColor: "#D97706",
    version: "1.0.0",
    route: null,
    configSchema: [
      { key: "weekStart", label: "Week starts on", type: "select", options: ["Monday", "Sunday"], default: "Monday" },
      { key: "enableGantt", label: "Enable Gantt view", type: "boolean", default: true },
    ],
    defaultSettings: { weekStart: "Monday", enableGantt: true },
  },
  {
    slug: "helpdesk",
    name: "Helpdesk",
    summary: "Tickets, SLAs and support queues",
    description:
      "A shared support inbox with priorities, SLA targets and canned responses, so nothing slips through the cracks.",
    category: "support",
    icon: "LifeBuoy",
    accentColor: "#DC2626",
    version: "1.0.0",
    route: null,
    configSchema: [
      { key: "slaHours", label: "First response SLA (hours)", type: "number", default: 4 },
      { key: "cannedReplies", label: "Enable canned replies", type: "boolean", default: true },
      { ...autoInvoice },
    ],
    defaultSettings: { slaHours: 4, cannedReplies: true, autoInvoice: false },
  },
  {
    slug: "ai",
    name: "AI",
    summary: "AI workflows, prompts and automations",
    description:
      "Build prompt-driven workflows and let agents handle the repetitive parts of running your business.",
    category: "ai",
    icon: "Sparkles",
    accentColor: "#9333EA",
    version: "1.0.0",
    route: "/ai/builder",
    configSchema: [
      { key: "provider", label: "Model provider", type: "select", options: ["OpenAI", "Anthropic", "Local"], default: "OpenAI" },
      { key: "autoApprove", label: "Auto-approve low-risk actions", type: "boolean", default: false },
    ],
    defaultSettings: { provider: "OpenAI", autoApprove: false },
  },
  {
    slug: "documents",
    name: "Documents",
    summary: "Files, folders and shared storage",
    description:
      "Organize company files in one place with granular sharing. Storage is scoped per company — one tenant never sees another's files.",
    category: "content",
    icon: "FileText",
    accentColor: "#0891B2",
    version: "1.0.0",
    route: "/storage",
    configSchema: [
      { key: "maxUploadMb", label: "Max upload size (MB)", type: "number", default: 100 },
      { key: "versioning", label: "Keep file versions", type: "boolean", default: true },
    ],
    defaultSettings: { maxUploadMb: 100, versioning: true },
  },
  {
    slug: "website",
    name: "Website",
    summary: "Sites, domains and deploys",
    description:
      "Build and publish sites with connected domains, SSL and deployments — the core of the hosting portal itself.",
    category: "website",
    icon: "Globe",
    accentColor: "#E8501A",
    version: "1.0.0",
    route: "/sites",
    configSchema: [
      { key: "autoSsl", label: "Auto-provision SSL", type: "boolean", default: true },
      { key: "staging", label: "Create staging environment", type: "boolean", default: false },
    ],
    defaultSettings: { autoSsl: true, staging: false },
  },
  {
    slug: "inventory",
    name: "Inventory",
    summary: "Products, stock and warehouses",
    description:
      "Track products and stock levels across warehouses, with reordering alerts tuned per company.",
    category: "operations",
    icon: "Package",
    accentColor: "#65A30D",
    version: "1.0.0",
    route: null,
    configSchema: [
      { key: "warehouseName", label: "Main warehouse", type: "text", default: "Main Warehouse" },
      { key: "reorderAlerts", label: "Reorder alerts", type: "boolean", default: true },
    ],
    defaultSettings: { warehouseName: "Main Warehouse", reorderAlerts: true },
  },
  {
    slug: "marketing",
    name: "Marketing",
    summary: "Campaigns, segments and broadcasts",
    description:
      "Plan campaigns, segment audiences and send broadcasts — with each company's brand voice and sender identity.",
    category: "marketing",
    icon: "Megaphone",
    accentColor: "#DB2777",
    version: "1.0.0",
    route: "/dashboard/marketing",
    configSchema: [
      { key: "senderName", label: "Default sender name", type: "text", default: "The Team" },
      { key: "sendWindow", label: "Send window", type: "select", options: ["Any time", "Business hours"], default: "Business hours" },
      { ...autoInvoice },
    ],
    defaultSettings: { senderName: "The Team", sendWindow: "Business hours", autoInvoice: false },
  },
];

// ─── Company-scoped authorization ────────────────────────────────────────────
// These take the Prisma client as a parameter (like ensureBuiltinApps) so this
// module keeps zero server-module imports — the UI imports zod schemas and the
// merge helpers from here without pulling Prisma or next-auth into the browser
// bundle. The platform-admin check is inlined to mirror isAdminRole() in
// @/lib/auth; keep the two in sync.

type AppCenterDb = Pick<PrismaClient, "organization" | "membership">;

function isPlatformAdmin(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** May this user SEE this company's catalog/install state? */
export async function canViewCompany(
  client: AppCenterDb,
  user: { id: string; role: string },
  organizationId: string,
): Promise<boolean> {
  if (isPlatformAdmin(user.role)) return true;
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true },
  });
  if (!org) return false;
  if (org.ownerId === user.id) return true;
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  return Boolean(membership);
}

/**
 * May this user INSTALL / CONFIGURE / UNINSTALL apps for this company?
 * Platform admins, the company owner, or OWNER/ADMIN members — ordinary
 * members can use apps but not change what the company has installed.
 */
export async function canManageCompany(
  client: AppCenterDb,
  user: { id: string; role: string },
  organizationId: string,
): Promise<boolean> {
  if (isPlatformAdmin(user.role)) return true;
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true },
  });
  if (!org) return false;
  if (org.ownerId === user.id) return true;
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}

/** JSON scalars allowed in branding/settings overrides. */
export type OverrideValue = string | number | boolean | null;

/**
 * Shallow-merge a patch over stored JSON overrides. `undefined` (key absent)
 * leaves the stored value untouched; an explicit `null` clears an override so
 * a company can hand a field back to the catalog default. The result is always
 * a flat record of JSON scalars — exactly what branding/settings columns hold
 * and exactly what Prisma's Json input accepts.
 */
export function mergeOverrides(
  existing: unknown,
  patch: Record<string, unknown> | undefined,
): Record<string, OverrideValue> | undefined {
  if (patch === undefined) return undefined;
  const merged: Record<string, OverrideValue> = {};
  const keep = (key: string, value: unknown) => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      merged[key] = value;
    }
  };
  for (const [key, value] of Object.entries(asRecord(existing))) keep(key, value);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) keep(key, value);
  }
  return merged;
}

/**
 * Self-seed the built-in catalog. Production never runs `prisma seed`, so
 * GET /api/apps calls this on every read: missing definitions are created,
 * existing rows are NEVER overwritten (`create` only) so an admin's edits to a
 * built-in survive. Safe to call concurrently — the unique slug turns races
 * into a harmless P2002.
 */
export async function ensureBuiltinApps(client: PrismaClient): Promise<void> {
  const existing = await client.appDefinition.findMany({
    where: { slug: { in: BUILTIN_APPS.map((a) => a.slug) } },
    select: { slug: true },
  });
  const have = new Set(existing.map((row) => row.slug));
  for (const app of BUILTIN_APPS) {
    if (have.has(app.slug)) continue;
    try {
      await client.appDefinition.create({
        data: {
          slug: app.slug,
          name: app.name,
          summary: app.summary,
          description: app.description,
          category: app.category,
          icon: app.icon,
          accentColor: app.accentColor,
          version: app.version,
          route: app.route,
          status: "active",
          isSystem: true,
          configSchema: app.configSchema,
          defaultSettings: app.defaultSettings,
          createdBy: "system",
        },
      });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
}
