import { z } from "zod";

export const upsertSettingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().optional(),
  type: z.enum(["color", "font", "text", "boolean", "url", "json"]).optional(),
  description: z.string().max(1000).optional(),
});