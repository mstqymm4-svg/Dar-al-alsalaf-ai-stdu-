import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service";
import { success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import type { AuthenticatedRequest } from "../types/express";

function ctx(req: Request) {
  return { userAgent: req.headers["user-agent"], ip: req.ip };
}

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      return success(res, result, 201);
    } catch (e) {
      return next(e);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body, ctx(req));
      return success(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refresh(refreshToken, ctx(req));
      return success(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken) await authService.logout(refreshToken);
      return success(res, { ok: true });
    } catch (e) {
      return next(e);
    }
  },

  async me(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const user = await authService.me(req.user.id);
      return success(res, user);
    } catch (e) {
      return next(e);
    }
  },
};