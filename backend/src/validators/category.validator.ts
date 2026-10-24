import { z } from "zod";

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().default(0),
});
export const categoryUpdateSchema = categoryCreateSchema.partial();