import { PrismaClient } from "@prisma/client";
import { env } from "./env";

/**
 * Single Prisma instance. In dev, global caching prevents exhausting
 * connections during hot-reloads of ts-node-dev.
 */
const globalForPrisma = globalThis as unknown as { prisma?: any };

let prismaInstance: any;
try {
  prismaInstance =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: env.isProd ? ["error"] : ["error", "warn"],
    });
} catch {
  console.warn("[AI Studio] Database not connected — using mock");
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
    upsert: async (d: any) => d?.create ?? {},
    count: async () => 0,
  };
  prismaInstance = new Proxy({}, { get: () => noOp });
}

export const prisma = prismaInstance;
if (!env.isProd) globalForPrisma.prisma = prisma;