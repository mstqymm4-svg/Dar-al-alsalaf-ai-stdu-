import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/** Global API rate limiter. Tighten per-route (e.g. auth) as needed. */
export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

/** Stricter limiter for auth endpoints (brute-force protection). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts, please try again later." },
});