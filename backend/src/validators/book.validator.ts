import { z } from "zod";

export const bookCreateSchema = z.object({
  title: z.string().min(1).max(300),
  authorId: z.string().optional(),
  authorName: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  categoryName: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  coverImage: z.string().optional(),
  coverMediaId: z.string().optional(),
  pagesCount: z.number().int().positive().optional(),
  language: z.enum(["ar", "en", "fr", "ur", "hi", "other"]).optional(),
  pdfUrl: z.string().optional(),
  pdfMediaId: z.string().optional(),
  isFeatured: z.boolean().optional(),
  rating: z.number().min(0).max(5).optional(),
  status: z.enum(["published", "draft", "hidden"]).optional(),
});
export const bookUpdateSchema = bookCreateSchema.partial();