import { UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { createPrismaClient } from "../src/lib/db";

const prisma = createPrismaClient();

// ─── Permissions ─────────────────────────────────────────────────────────────

const PERMISSIONS = [
  // Website
  { name: "WEBSITE_CREATE", category: "website", description: "Create new websites" },
  { name: "WEBSITE_READ", category: "website", description: "View website details" },
  { name: "WEBSITE_UPDATE", category: "website", description: "Modify website settings" },
  { name: "WEBSITE_DELETE", category: "website", description: "Delete websites" },
  { name: "WEBSITE_SUSPEND", category: "website", description: "Suspend websites" },
  { name: "WEBSITE_RESUME", category: "website", description: "Resume suspended websites" },
  { name: "WEBSITE_DEPLOY", category: "website", description: "Deploy to websites" },
  { name: "WEBSITE_RESTART", category: "website", description: "Restart website services" },
  // Domain
  { name: "DOMAIN_CREATE", category: "domain", description: "Add domains" },
  { name: "DOMAIN_READ", category: "domain", description: "View domain details" },
  { name: "DOMAIN_UPDATE", category: "domain", description: "Modify domain settings" },
  { name: "DOMAIN_DELETE", category: "domain", description: "Remove domains" },
  { name: "SSL_MANAGE", category: "domain", description: "Manage SSL certificates" },
  // Database
  { name: "DATABASE_CREATE", category: "database", description: "Create databases" },
  { name: "DATABASE_READ", category: "database", description: "View database details" },
  { name: "DATABASE_UPDATE", category: "database", description: "Modify databases" },
  { name: "DATABASE_DELETE", category: "database", description: "Delete databases" },
  // Backup
  { name: "BACKUP_CREATE", category: "backup", description: "Create backups" },
  { name: "BACKUP_READ", category: "backup", description: "View backup details" },
  { name: "BACKUP_RESTORE", category: "backup", description: "Restore from backups" },
  // File management
  { name: "FILE_MANAGE", category: "file", description: "Manage website files" },
  // Logs
  { name: "LOGS_READ", category: "logs", description: "View system logs" },
  // User management
  { name: "USER_CREATE", category: "user", description: "Create users" },
  { name: "USER_READ", category: "user", description: "View user details" },
  { name: "USER_UPDATE", category: "user", description: "Modify users" },
  { name: "USER_DELETE", category: "user", description: "Delete users" },
  { name: "ROLE_MANAGE", category: "user", description: "Manage roles and permissions" },
  // Audit
  { name: "AUDIT_READ", category: "audit", description: "View audit logs" },
  // System
  { name: "SERVER_MANAGE", category: "system", description: "Manage server settings" },
  { name: "SYSTEM_MANAGE", category: "system", description: "Full system administration" },
];

// ─── Roles ───────────────────────────────────────────────────────────────────

const ROLES: Array<{ name: UserRole; description: string }> = [
  { name: "SUPER_ADMIN", description: "Full system access with all permissions" },
  { name: "ADMIN", description: "Administrative access for users, servers, and plans" },
  { name: "RESELLER", description: "Reseller partner access with client management and commissions" },
  { name: "CLIENT", description: "Client access to manage websites, domains, databases, AI tools, and billing" },
  { name: "DEVOPS", description: "DevOps access for deployment and infrastructure" },
  { name: "SUPPORT", description: "Support access for viewing and basic operations" },
  { name: "VIEWER", description: "Read-only access" },
];

// ─── Role Permission Mapping ────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.name),
  ADMIN: [
    "WEBSITE_CREATE", "WEBSITE_READ", "WEBSITE_UPDATE", "WEBSITE_DELETE",
    "WEBSITE_SUSPEND", "WEBSITE_RESUME", "WEBSITE_DEPLOY", "WEBSITE_RESTART",
    "DOMAIN_CREATE", "DOMAIN_READ", "DOMAIN_UPDATE", "DOMAIN_DELETE", "SSL_MANAGE",
    "DATABASE_CREATE", "DATABASE_READ", "DATABASE_UPDATE", "DATABASE_DELETE",
    "BACKUP_CREATE", "BACKUP_READ", "BACKUP_RESTORE",
    "FILE_MANAGE", "LOGS_READ",
    "USER_CREATE", "USER_READ", "USER_UPDATE",
    "AUDIT_READ", "SERVER_MANAGE",
  ],
  RESELLER: [
    "WEBSITE_CREATE", "WEBSITE_READ", "WEBSITE_UPDATE", "WEBSITE_DELETE",
    "WEBSITE_SUSPEND", "WEBSITE_RESUME", "WEBSITE_DEPLOY", "WEBSITE_RESTART",
    "DOMAIN_CREATE", "DOMAIN_READ", "DOMAIN_UPDATE", "DOMAIN_DELETE", "SSL_MANAGE",
    "DATABASE_CREATE", "DATABASE_READ", "DATABASE_UPDATE", "DATABASE_DELETE",
    "BACKUP_CREATE", "BACKUP_READ", "BACKUP_RESTORE",
    "FILE_MANAGE", "LOGS_READ",
    "USER_CREATE", "USER_READ",
  ],
  CLIENT: [
    "WEBSITE_CREATE", "WEBSITE_READ", "WEBSITE_UPDATE", "WEBSITE_DELETE",
    "WEBSITE_DEPLOY", "WEBSITE_RESTART",
    "DOMAIN_CREATE", "DOMAIN_READ", "DOMAIN_UPDATE", "DOMAIN_DELETE", "SSL_MANAGE",
    "DATABASE_CREATE", "DATABASE_READ", "DATABASE_UPDATE", "DATABASE_DELETE",
    "BACKUP_CREATE", "BACKUP_READ", "BACKUP_RESTORE",
    "FILE_MANAGE", "LOGS_READ",
  ],
  DEVOPS: [
    "WEBSITE_CREATE", "WEBSITE_READ", "WEBSITE_UPDATE",
    "WEBSITE_DEPLOY", "WEBSITE_RESTART",
    "DOMAIN_READ",
    "DATABASE_CREATE", "DATABASE_READ", "DATABASE_UPDATE",
    "BACKUP_CREATE", "BACKUP_READ", "BACKUP_RESTORE",
    "FILE_MANAGE", "LOGS_READ",
    "SERVER_MANAGE",
  ],
  SUPPORT: [
    "WEBSITE_READ",
    "DOMAIN_READ",
    "DATABASE_READ",
    "BACKUP_READ",
    "USER_READ",
    "AUDIT_READ",
  ],
  VIEWER: [
    "WEBSITE_READ",
    "DOMAIN_READ",
    "DATABASE_READ",
  ],
};

// ─── Sample Plans ────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: "Starter",
    slug: "starter",
    description: "Perfect for personal projects and experimentation",
    priceCents: 0,
    interval: "monthly",
    maxSites: 5,
    maxBandwidthGb: 100,
    maxStorageGb: 1,
    maxDatabases: 1,
    maxAiTokens: 10000,
    resellerCommissionPct: 0,
    isPopular: false,
    features: JSON.stringify([
      "Up to 5 websites",
      "1 GB SSD storage",
      "100 GB monthly bandwidth",
      "1 PostgreSQL/MySQL database",
      "10,000 AI tokens / month",
      "Free Cloudflare SSL",
      "Community support",
    ]),
    isActive: true,
  },
  {
    name: "Business",
    slug: "business",
    description: "Ideal for growing businesses and professionals",
    priceCents: 2999, // $29.99
    interval: "monthly",
    maxSites: 25,
    maxBandwidthGb: 1000,
    maxStorageGb: 10,
    maxDatabases: 10,
    maxAiTokens: 100000,
    resellerCommissionPct: 15,
    isPopular: true,
    features: JSON.stringify([
      "Up to 25 websites",
      "10 GB NVMe storage",
      "1 TB monthly bandwidth",
      "10 Managed databases",
      "100,000 AI tokens / month",
      "Free SSL certificates",
      "Automated daily backups",
      "Next.js / Node.js / PHP / Static runtimes",
      "Priority email support",
    ]),
    isActive: true,
  },
  {
    name: "Enterprise",
    slug: "enterprise",
    description: "For organizations and resellers that need unlimited power and support",
    priceCents: 9999, // $99.99
    interval: "monthly",
    maxSites: 999,
    maxBandwidthGb: 10000,
    maxStorageGb: 100,
    maxDatabases: 50,
    maxAiTokens: 1000000,
    resellerCommissionPct: 25,
    isPopular: false,
    features: JSON.stringify([
      "Unlimited websites",
      "100 GB NVMe storage",
      "10 TB monthly bandwidth",
      "50 Managed databases + Redis",
      "1,000,000 AI tokens / month",
      "Free wildcard SSL certificates",
      "Real-time & daily backups",
      "All runtimes (Static, PHP, Node.js, Next.js)",
      "Priority 24/7 support",
      "White-label reseller portal (25% commission)",
      "CI/CD preview deployments",
      "Dedicated firewall & DDoS protection",
    ]),
    isActive: true,
  },
];

// ─── Default CRM Pipeline ──────────────────────────────────────────────────

const DEFAULT_PIPELINE = {
  name: "Sales Pipeline",
  stages: JSON.stringify([
    "Lead",
    "Qualified",
    "Proposal",
    "Negotiation",
    "Closed Won",
    "Closed Lost",
  ]),
  isDefault: true,
};

// ─── Default Alert Rules ────────────────────────────────────────────────────

const ALERT_RULES = [
  {
    name: "High CPU Usage",
    metric: "cpu",
    condition: "gt",
    threshold: 90,
    cooldownMin: 5,
    isActive: true,
  },
  {
    name: "High Memory Usage",
    metric: "memory",
    condition: "gt",
    threshold: 85,
    cooldownMin: 5,
    isActive: true,
  },
  {
    name: "High Disk Usage",
    metric: "disk",
    condition: "gt",
    threshold: 90,
    cooldownMin: 5,
    isActive: true,
  },
  {
    name: "SSL Certificate Expiring Soon",
    metric: "ssl_expiry",
    condition: "lt",
    threshold: 7,
    cooldownMin: 60,
    isActive: true,
  },
];

// ─── Seed Functions ──────────────────────────────────────────────────────────

async function seedPermissions() {
  console.log("\n📋 Seeding permissions...");
  let count = 0;
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: { category: perm.category, description: perm.description },
      create: perm,
    });
    count++;
  }
  console.log(`   ✅ ${count} permissions upserted`);
}

async function seedRoles() {
  console.log("\n🔐 Seeding roles with permissions...");

  for (const roleDef of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: roleDef,
    });

    const desiredPerms = ROLE_PERMISSIONS[roleDef.name] ?? [];

    const currentLinks = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const currentPermNames = new Set(currentLinks.map((l) => l.permission.name));
    const desiredPermSet = new Set(desiredPerms);

    for (const permName of desiredPerms) {
      if (!currentPermNames.has(permName)) {
        const perm = await prisma.permission.findUnique({ where: { name: permName } });
        if (perm) {
          await prisma.rolePermission.create({
            data: { roleId: role.id, permissionId: perm.id },
          });
        }
      }
    }

    for (const link of currentLinks) {
      if (!desiredPermSet.has(link.permission.name)) {
        await prisma.rolePermission.delete({
          where: { id: link.id },
        });
      }
    }

    console.log(`   ✅ ${roleDef.name} — ${desiredPerms.length} permissions`);
  }
}

async function seedUsers() {
  console.log("\n👤 Seeding default users (Admin, Reseller, Client)...");

  const defaultUsers: Array<{
    email: string;
    name: string;
    password: string;
    roleName: UserRole;
    companyName: string;
  }> = [
    {
      email: "admin@alolabs.net",
      name: "ALO Super Admin",
      password: "admin123",
      roleName: "SUPER_ADMIN",
      companyName: "ALO Labs",
    },
    {
      email: "reseller@alolabs.net",
      name: "ALO Partner Reseller",
      password: "reseller123",
      roleName: "RESELLER",
      companyName: "ALO Partner Agency",
    },
    {
      email: "client@alolabs.net",
      name: "ALO Demo Client",
      password: "client123",
      roleName: "CLIENT",
      companyName: "Acme Cloud Apps",
    },
  ];

  for (const u of defaultUsers) {
    const role = await prisma.role.findUnique({ where: { name: u.roleName } });
    if (!role) continue;

    const passwordHash = await hashPassword(u.password);
    const existing = await prisma.user.findUnique({ where: { email: u.email } });

    if (existing) {
      await prisma.user.update({
        where: { email: u.email },
        data: {
          passwordHash,
          roleId: role.id,
          companyName: u.companyName,
          onboardingCompleted: true,
          onboardingStep: 4,
          emailVerified: existing.emailVerified ?? new Date(),
        },
      });
      console.log(`   ✅ User updated: ${u.email} (${u.roleName})`);
    } else {
      await prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          passwordHash,
          roleId: role.id,
          companyName: u.companyName,
          onboardingCompleted: true,
          onboardingStep: 4,
          emailVerified: new Date(),
        },
      });
      console.log(`   ✅ User created: ${u.email} / ${u.password} (${u.roleName})`);
    }
  }
}

async function seedPlans() {
  console.log("\n💰 Seeding plans...");
  let count = 0;
  for (const plan of PLANS) {
    const existing = await prisma.plan.findUnique({ where: { name: plan.name } });
    if (existing) {
      await prisma.plan.update({
        where: { name: plan.name },
        data: plan,
      });
    } else {
      await prisma.plan.create({ data: plan });
    }
    count++;
  }
  console.log(`   ✅ ${count} plans upserted (Starter, Business, Enterprise)`);
}

async function seedDefaultOrganization() {
  console.log("\n🏢 Seeding default organization...");
  const admin = await prisma.user.findUnique({ where: { email: "admin@alolabs.net" } });
  if (!admin) return;

  const org = await prisma.organization.upsert({
    where: { slug: "alo-labs" },
    update: { name: "ALO Labs Hosting", ownerId: admin.id },
    create: {
      name: "ALO Labs Hosting",
      slug: "alo-labs",
      ownerId: admin.id,
      customDomain: "hosting.alolabs.net",
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: admin.id,
        organizationId: org.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      userId: admin.id,
      organizationId: org.id,
      role: "OWNER",
      acceptedAt: new Date(),
    },
  });
  console.log(`   ✅ Organization ready: ${org.name} (${org.slug})`);
}

async function seedCrmPipeline() {
  console.log("\n📊 Seeding default CRM pipeline...");

  const existing = await prisma.crmPipeline.findFirst({
    where: { isDefault: true },
  });

  if (existing) {
    await prisma.crmPipeline.update({
      where: { id: existing.id },
      data: {
        name: DEFAULT_PIPELINE.name,
        stages: DEFAULT_PIPELINE.stages,
        isDefault: true,
      },
    });
    console.log(`   ✅ Default pipeline updated: ${DEFAULT_PIPELINE.name}`);
  } else {
    await prisma.crmPipeline.create({
      data: {
        name: DEFAULT_PIPELINE.name,
        stages: DEFAULT_PIPELINE.stages,
        isDefault: true,
      },
    });
    console.log(`   ✅ Default pipeline created: ${DEFAULT_PIPELINE.name}`);
  }
}

async function seedAlertRules() {
  console.log("\n🚨 Seeding alert rules...");
  for (const rule of ALERT_RULES) {
    const existing = await prisma.alertRule.findFirst({
      where: { name: rule.name },
    });

    if (existing) {
      await prisma.alertRule.update({
        where: { id: existing.id },
        data: rule,
      });
    } else {
      await prisma.alertRule.create({ data: rule });
    }
    console.log(`   ✅ Alert rule ready: ${rule.name}`);
  }
}

async function seedServer() {
  console.log("\n🖥️  Seeding server...");

  await prisma.server.upsert({
    where: { hostname: "hosting.alolabs.net" },
    update: {
      name: "Primary Edge & App Node",
      ip: "100.85.239.114",
      tailscaleIp: "100.85.239.114",
      os: "Ubuntu 22.04.5 LTS",
      cpuCores: 4,
      ramGb: 15,
      diskGb: 100,
      status: "ONLINE",
      role: "WEB",
      region: "ap-south-1",
      maxSites: 250,
    },
    create: {
      name: "Primary Edge & App Node",
      hostname: "hosting.alolabs.net",
      ip: "100.85.239.114",
      tailscaleIp: "100.85.239.114",
      os: "Ubuntu 22.04.5 LTS",
      cpuCores: 4,
      ramGb: 15,
      diskGb: 100,
      status: "ONLINE",
      role: "WEB",
      region: "ap-south-1",
      maxSites: 250,
    },
  });
  console.log("   ✅ Server registered: hosting.alolabs.net (Ubuntu 22.04, 15GB RAM)");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ALO Labs Hosting Portal — Database Seed");
  console.log("═══════════════════════════════════════════════════════════");

  await seedPermissions();
  await seedRoles();
  await seedUsers();
  await seedPlans();
  await seedDefaultOrganization();
  await seedCrmPipeline();
  await seedAlertRules();
  await seedServer();

  const [permCount, roleCount, userCount, planCount, pipelineCount, alertCount] =
    await Promise.all([
      prisma.permission.count(),
      prisma.role.count(),
      prisma.user.count(),
      prisma.plan.count(),
      prisma.crmPipeline.count(),
      prisma.alertRule.count(),
    ]);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Seed Summary");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Permissions:   ${permCount}`);
  console.log(`  Roles:         ${roleCount}`);
  console.log(`  Users:         ${userCount}`);
  console.log(`  Plans:         ${planCount}`);
  console.log(`  Pipelines:     ${pipelineCount}`);
  console.log(`  Alert Rules:   ${alertCount}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✅ Seed complete!");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
