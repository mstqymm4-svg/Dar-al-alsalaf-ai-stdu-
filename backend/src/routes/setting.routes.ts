import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { upsertSettingSchema } from "../validators/setting.validator";
import type { AuthenticatedRequest } from "../types/express";

const router = Router();

/** Public: all settings as a key→value map. */
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = { value: r.value, type: r.type, description: r.description };
    return success(res, map);
  } catch (e) {
    return next(e);
  }
});

/** Public: single setting by key. */
router.get("/:key", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: req.params.key } });
    if (!row) return next(ApiError.notFound());
    return success(res, row);
  } catch (e) {
    return next(e);
  }
});

/** Admin: upsert a setting. */
router.put("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(upsertSettingSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { key, value, type, description } = req.body;
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    const row = await prisma.appSetting.upsert({
      where: { key },
      create: { key, value, type, description, changedBy: req.user?.email },
      update: { value, type, description, previousValue: existing?.value ?? null, changedBy: req.user?.email },
    });
    return success(res, row);
  } catch (e) {
    return next(e);
  }
});

router.delete("/:key", authenticate, authorize("ADMIN", "SUPER_ADMIN"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.appSetting.delete({ where: { key: req.params.key } });
    return success(res, { ok: true });
  } catch (e) {
    return next(e);
  }
});

export default router;