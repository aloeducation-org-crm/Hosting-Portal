import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

const email = (process.env.ADMIN_EMAIL ?? "admin@alolabs.net").trim().toLowerCase();
const credentialsPath = process.env.ADMIN_CREDENTIAL_FILE ?? "/var/lib/alo-hosting/admin-credentials";

async function main(): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL must be a valid email address");
  try {
    await stat(credentialsPath);
    console.log("Super-admin bootstrap already completed; leaving current credentials unchanged.");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const password = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password);
  const role = await db.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: {},
    create: { name: "SUPER_ADMIN", description: "Platform super-administrator" },
    select: { id: true },
  });
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash, roleId: role.id, isActive: true, isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
    });
  } else {
    await db.user.create({
      data: { email, name: "ALO Super Admin", passwordHash, roleId: role.id, isActive: true, emailVerified: new Date(), onboardingCompleted: true, onboardingStep: 4 },
    });
  }

  const directory = path.dirname(credentialsPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${credentialsPath}.tmp-${process.pid}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`ADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, credentialsPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  console.log(`Created initial SUPER_ADMIN (${email}); generated 32-character password stored in root-only ${credentialsPath}.`);
}

main().catch(async (error: unknown) => {
  console.error("Super-admin bootstrap failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
