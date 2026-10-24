import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { success, paginated } from "./apiResponse";
import { ApiError } from "./ApiError";

export interface CrudOptions {
  model: string; // prisma model name, camelized (e.g. "book", "category")
  searchFields?: string[];
  filterFields?: string[];
  sortFields?: string[];
  defaultOrderBy?: Record<string, "asc" | "desc">;
  include?: any;
  beforeCreate?: (data: any, req: Request) => any | Promise<any>;
}

export function crudHandlers(opts: CrudOptions) {
  const model = (prisma as any)[opts.model];

  function orderBy(q: any) {
    const sort = q.sort as string | undefined;
    if (sort) {
      const [field, dir] = sort.split(":");
      if (opts.sortFields?.includes(field)) return { [field]: dir === "desc" ? "desc" : "asc" };
    }
    return opts.defaultOrderBy ?? { createdAt: "desc" };
  }

  return {
    async list(req: Request, res: Response, next: NextFunction) {
      try {
        const q = req.query as any;
        const page = Math.max(1, parseInt(q.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(q.limit || "20", 10)));
        const where: any = {};
        if (q.search && opts.searchFields?.length) {
          where.OR = opts.searchFields.map((f) => ({ [f]: { contains: q.search, mode: "insensitive" } }));
        }
        for (const f of opts.filterFields || []) {
          if (q[f] !== undefined && q[f] !== "") where[f] = q[f];
        }
        const [rows, total] = await Promise.all([
          model.findMany({
            where,
            orderBy: orderBy(q),
            skip: (page - 1) * limit,
            take: limit,
            include: opts.include,
          }),
          model.count({ where }),
        ]);
        return paginated(res, rows, total, page, limit);
      } catch (e) {
        return next(e);
      }
    },
    async get(req: Request, res: Response, next: NextFunction) {
      try {
        const row = await model.findUnique({ where: { id: req.params.id }, include: opts.include });
        if (!row) return next(ApiError.notFound());
        return success(res, row);
      } catch (e) {
        return next(e);
      }
    },
    async create(req: Request, res: Response, next: NextFunction) {
      try {
        const data = opts.beforeCreate ? await opts.beforeCreate(req.body, req) : req.body;
        const row = await model.create({ data, include: opts.include });
        return success(res, row, 201);
      } catch (e) {
        return next(e);
      }
    },
    async update(req: Request, res: Response, next: NextFunction) {
      try {
        const row = await model.update({ where: { id: req.params.id }, data: req.body, include: opts.include });
        return success(res, row);
      } catch (e) {
        return next(e);
      }
    },
    async remove(req: Request, res: Response, next: NextFunction) {
      try {
        await model.delete({ where: { id: req.params.id } });
        return success(res, { ok: true });
      } catch (e) {
        return next(e);
      }
    },
  };
}