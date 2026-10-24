import { Response } from "express";

export function success<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function error(res: Response, message: string, status = 400, details?: unknown) {
  return res.status(status).json({ success: false, message, ...(details ? { details } : {}) });
}

/** Paginated list envelope. */
export function paginated<T>(res: Response, rows: T[], total: number, page: number, limit: number) {
  return res.status(200).json({
    success: true,
    data: rows,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
  });
}