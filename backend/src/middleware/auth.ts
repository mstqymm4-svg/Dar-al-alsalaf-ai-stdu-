import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { ApiError } from "../utils/ApiError";
import { AuthenticatedRequest } from "../types/express";

type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
const ROLE_RANK: Record<Role, number> = { USER: 0, ADMIN: 1, SUPER_ADMIN: 2 };

/** Verifies the access token and attaches `req.user`. */
export function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized("Missing access token"));

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role as Role };
    return next();
  } catch {
    return next(ApiError.unauthorized("Invalid or expired access token"));
  }
}

/** Role guard. Usage: authorize("ADMIN") or authorize("ADMIN", "SUPER_ADMIN"). */
export function authorize(...allowed: Role[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const userRank = ROLE_RANK[req.user.role];
    const minRequired = Math.min(...allowed.map((r) => ROLE_RANK[r]));
    if (userRank < minRequired) return next(ApiError.forbidden("Insufficient permissions"));
    return next();
  };
}