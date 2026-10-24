import { Router, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { success } from "../utils/apiResponse";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  return success(res, { status: "ok", database: db, time: new Date().toISOString() });
});

export default router;