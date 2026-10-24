import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

/** Validates `req.body` against a zod schema. */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    return next();
  };
}

/** Validates `req.query` against a zod schema. */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    (req as any).validatedQuery = result.data;
    return next();
  };
}