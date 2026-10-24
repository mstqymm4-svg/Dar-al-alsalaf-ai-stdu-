import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { prisma } from "../config/prisma";
import { storage } from "../config/storage";
import { success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import type { AuthenticatedRequest } from "../types/express";

function publicUrl(absPath: string) {
  const rel = path.relative(env.storage.uploadDir, absPath).split(path.sep).join("/");
  return `/uploads/${rel}`;
}

export const uploadController = {
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) return next(ApiError.badRequest("No file provided"));

      const url = publicUrl(file.path);
      let media: any = null;
      if (req.user) {
        media = await prisma.media.create({
          data: {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url,
            disk: "local",
            path: file.path,
            uploaderId: req.user.id,
          },
        });
      }

      return success(res, {
        url,
        filename: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        mediaId: media?.id ?? null,
      }, 201);
    } catch (e) {
      return next(e);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const media = await prisma.media.findUnique({ where: { id: req.params.id } });
      if (!media) return next(ApiError.notFound());
      if (media.path && fs.existsSync(media.path)) {
        try { fs.unlinkSync(media.path); } catch {}
      }
      await prisma.media.delete({ where: { id: media.id } });
      return success(res, { ok: true });
    } catch (e) {
      return next(e);
    }
  },
};