import { prisma } from "../config/prisma";
import { hashPassword } from "../utils/hash";
import { logger } from "../utils/logger";

/**
 * Create the first SUPER_ADMIN.
 *
 * Usage:
 *   npm run create-admin -- <email> <password> <name>
 *   OR set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env and run `npm run create-admin`
 */
async function main() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  const name = process.argv[4] || process.env.ADMIN_NAME || "Super Admin";

  if (!email || !password) {
    console.error("Usage: npm run create-admin -- <email> <password> [name]");
    console.error("   or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role === "SUPER_ADMIN") {
      logger.info("User is already a SUPER_ADMIN");
    } else {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN", isActive: true } });
      logger.info(`Existing user ${email} promoted to SUPER_ADMIN`);
    }
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, fullName: name, role: "SUPER_ADMIN", isActive: true },
  });
  logger.info(`SUPER_ADMIN created: ${user.email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  logger.error("createAdmin failed", { message: e.message });
  prisma.$disconnect().finally(() => process.exit(1));
});