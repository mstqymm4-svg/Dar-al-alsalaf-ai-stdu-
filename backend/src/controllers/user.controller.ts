import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import type { AuthenticatedRequest } from "../types/express";

function sanitize(u: any) {
  const { passwordHash, ...rest } = u;
  return rest;
}

export const userController = {
  async list(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
      return success(res, users.map(sanitize));
    } catch (e) {
      return next(e);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { role, isActive, fullName, preferredLanguage, notificationsEnabled } = req.body;
      const data: any = {};
      if (role !== undefined) data.role = role;
      if (isActive !== undefined) data.isActive = isActive;
      if (fullName !== undefined) data.fullName = fullName;
      if (preferredLanguage !== undefined) data.preferredLanguage = preferredLanguage;
      if (notificationsEnabled !== undefined) data.notificationsEnabled = notificationsEnabled;

      const user = await prisma.user.update({ where: { id: req.params.id }, data });
      return success(res, sanitize(user));
    } catch (e) {
      return next(e);
    }
  },

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (req.params.id === req.user?.id) return next(ApiError.badRequest("Cannot delete your own account here"));
      await prisma.user.delete({ where: { id: req.params.id } });
      return success(res, { ok: true });
    } catch (e) {
      return next(e);
    }
  },

  async me(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) return next(ApiError.notFound());
      return success(res, sanitize(user));
    } catch (e) {
      return next(e);
    }
  },
};