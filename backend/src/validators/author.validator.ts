import { z } from "zod";

export const authorCreateSchema = z.object({
  name: z.string().min(1).max(120),
  bio: z.string().max(5000).optional(),
  image: z.string().optional(),
});
export const authorUpdateSchema = authorCreateSchema.partial();