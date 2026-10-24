import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT || "5000", 10),

  databaseUrl: required("DATABASE_URL"),

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  },

  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  corsOrigins: (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  storage: {
    driver: (process.env.STORAGE_DRIVER || "local") as "local" | "s3",
    uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads"),
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(50 * 1024 * 1024), 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "300", 10),
  },
};

export type Env = typeof env;