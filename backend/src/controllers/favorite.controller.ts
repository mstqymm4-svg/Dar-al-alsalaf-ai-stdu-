import { Request, Response, NextFunction } from "express";
import { favoriteService } from "../services/favorite.service";
import { success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import type { AuthenticatedRequest } from "../types/express";

export const favoriteController = {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const rows = await favoriteService.list(req.user.id);
      return success(res, rows);
    } catch (e) {
      return next(e);
    }
  },

  async ids(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      return success(res, await favoriteService.ids(req.user.id));
    } catch (e) {
      return next(e);
    }
  },

  async add(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const row = await favoriteService.add(req.user.id, req.params.bookId);
      return success(res, row, 201);
    } catch (e) {
      return next(e);
    }
  },

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const result = await favoriteService.remove(req.user.id, req.params.bookId);
      return success(res, result);
    } catch (e) {
      return next(e);
    }
  },
};