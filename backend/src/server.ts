import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { logger } from "./utils/logger";

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info("Connected to PostgreSQL");
  } catch (err) {
    logger.error("Failed to connect to PostgreSQL", { message: (err as Error).message });
    process.exit(1);
  }

  app.listen(env.port, () => {
    logger.info(`DAR AL ULOOM API running on http://localhost:${env.port} [${env.nodeEnv}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap();