import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { env } from "../config/env";

/** 404 for unmatched routes. */
export function notFound(_req: Request, res: Response) {
  return res.status(404).json({ success: false, message: "Route not found" });
}

/** Global error handler — the last middleware in the chain. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      details: err.flatten(),
    });
  }

  // Prisma known errors
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Resource already exists" });
  }
  if (anyErr?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }

  logger.error("Unhandled error", { message: (err as Error)?.message });
  if (!env.isProd) logger.error((err as Error)?.stack || "");

  return res.status(500).json({
    success: false,
    message: env.isProd ? "Internal server error" : (err as Error)?.message || "Internal server error",
  });
}