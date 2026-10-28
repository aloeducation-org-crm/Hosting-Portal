/**
 * §12 logical storage pools + §13 document access policy.
 *
 * Pools are rows in `storage_buckets` with `kind = "pool"` (name = the pool
 * key). A pool is ONLY a namespace + policy: nothing here formats, mounts,
 * partitions or touches a disk. `bucketPath` is the configured backend root
 * on a managed host; until an admin sets it the pool reports
 * `not-provisioned` and every upload is refused honestly.
 *
 * Access policy (v1, enforced in `canAccessPool` and tested):
 *   - SUPER_ADMIN / ADMIN / DEVOPS  → any pool; reads of other users' files
 *     are audited (spec: super-admin access must be logged and controlled).
 *   - RESELLER                      → PARTNER_STORAGE only, own files.
 *   - CLIENT                        → STUDENT_STORAGE only, own files
 *     (the student self-service upload path).
 *   - Everyone else                 → no document access at all.
 *   - BACKUP_STORAGE                → job-managed: manual upload refused for
 *      every role (backups only land through the backup worker).
 */
import path from "node:path";

/**
 * Role names are inlined (not imported from `@/lib/auth`) so this module stays
 * dependency-light enough for `prisma/seed.ts`. Values are identical to
 * `ROLES` in src/lib/auth.ts.
 */
const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  RESELLER: "RESELLER",
  CLIENT: "CLIENT",
  DEVOPS: "DEVOPS",
} as const;

export interface PoolDefinition {
  key: string;
  label: string;
  description: string;
  categories: string[];
  manualUpload: boolean;
}

export const POOL_DEFINITIONS: PoolDefinition[] = [
  {
    key: "STUDENT_STORAGE",
    label: "Student documents",
    description: "Passports, certificates, transcripts, English tests, CVs, SOPs, financial documents, admission and visa letters.",
    categories: [
      "passport",
      "academic-certificate",
      "transcript",
      "english-test-result",
      "cv",
      "statement-of-purpose",
      "financial-document",
      "admission-letter",
      "visa-document",
    ],
    manualUpload: true,
  },
  {
    key: "PARTNER_STORAGE",
    label: "Partner documents",
    description: "Partner agreements, student referrals, agency documents, commission records, institutional correspondence, compliance files.",
    categories: [
      "partner-agreement",
      "student-referral",
      "agency-document",
      "commission-document",
      "institutional-correspondence",
      "compliance-document",
    ],
    manualUpload: true,
  },
  {
    key: "EMPLOYEE_STORAGE",
    label: "Employee documents",
    description: "Employment documents, internal reports, operational files, company policies, department documents.",
    categories: [
      "employment-document",
      "internal-report",
      "operational-file",
      "company-policy",
      "department-document",
    ],
    manualUpload: true,
  },
  {
    key: "COMPANY_STORAGE",
    label: "Company documents",
    description: "Company-level records and shared organizational files.",
    categories: ["company-document"],
    manualUpload: true,
  },
  {
    key: "PROJECT_STORAGE",
    label: "Project artifacts",
    description: "Per-project files produced by deployments and delivery workflows.",
    categories: ["project-artifact"],
    manualUpload: true,
  },
  {
    key: "BACKUP_STORAGE",
    label: "Backups (job-managed)",
    description: "Backup archives created and verified by the backup worker. Manual upload is refused for every role.",
    categories: ["backup-archive"],
    manualUpload: false,
  },
];

export const POOL_KEYS = POOL_DEFINITIONS.map((p) => p.key);

const POOL_BY_KEY = new Map(POOL_DEFINITIONS.map((p) => [p.key, p]));

export function getPoolDefinition(key: string): PoolDefinition | undefined {
  return POOL_BY_KEY.get(key);
}

export function categoriesForPool(key: string): string[] {
  return POOL_BY_KEY.get(key)?.categories ?? [];
}

/** Staff roles that may touch any pool (their cross-owner reads are audited). */
const STAFF_ROLES = new Set<string>([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.DEVOPS]);

export type PoolAction = "read" | "upload" | "configure";

export interface PoolAccessDecision {
  allowed: boolean;
  /** Restrict results/uploads to this owner (undefined = all owners). */
  ownerScope?: string;
  reason?: string;
}

export function canAccessPool(
  user: { id: string; role: string },
  poolKey: string,
  action: PoolAction
): PoolAccessDecision {
  const pool = POOL_BY_KEY.get(poolKey);
  if (!pool) {
    return { allowed: false, reason: `Unknown storage pool "${poolKey}"` };
  }
  if (action === "configure") {
    return user.role === ROLES.SUPER_ADMIN
      ? { allowed: true }
      : { allowed: false, reason: "Only a super admin may configure storage pools" };
  }
  if (STAFF_ROLES.has(user.role)) {
    return { allowed: true }; // cross-owner access is audited at the route layer
  }
  if (user.role === ROLES.RESELLER && poolKey === "PARTNER_STORAGE") {
    return { allowed: true, ownerScope: user.id };
  }
  if (user.role === ROLES.CLIENT && poolKey === "STUDENT_STORAGE") {
    return { allowed: true, ownerScope: user.id };
  }
  return {
    allowed: false,
    reason: `Role ${user.role} has no access to ${poolKey}`,
  };
}

/**
 * Validates an upload target before anything touches the filesystem:
 * pool exists, manual upload allowed, category belongs to the pool.
 * Returns null when valid, otherwise the exact refusal reason.
 */
export function validateUploadTarget(poolKey: string, category: string): string | null {
  const pool = POOL_BY_KEY.get(poolKey);
  if (!pool) return `Unknown storage pool "${poolKey}"`;
  if (!pool.manualUpload) {
    return `${poolKey} is job-managed (backup worker only); manual upload is refused for every role`;
  }
  if (!pool.categories.includes(category)) {
    return `Category "${category}" does not belong to ${poolKey}; allowed: ${pool.categories.join(", ")}`;
  }
  return null;
}

/** Sanitizes a user-supplied filename to a safe display name (no paths). */
export function sanitizeFilename(name: string): string {
  const base = path.posix.basename(name.replace(/\\/g, "/"));
  return base
    .replace(/\0/g, "")
    .replace(/^\.+/, "")
    .replace(/[^\w.@ -]/g, "_")
    .slice(0, 200)
    .trim() || "file";
}

/** Storage-relative path for a new upload: never escapes the pool root. */
export function buildStoragePath(ownerScope: string, filename: string, id: string): string {
  const owner = ownerScope.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "platform";
  const ext = path.posix.extname(filename).slice(0, 16).replace(/[^A-Za-z0-9.]/g, "");
  return `${owner}/${id}${ext}`;
}

/**
 * Joins a pool root and a storage-relative path, guaranteeing the result
 * stays inside the root (path-traversal guard).
 */
export function resolveWithinRoot(root: string, relative: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
}
