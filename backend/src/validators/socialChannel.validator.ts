import { z } from "zod";

export const socialChannelCreateSchema = z.object({
  name: z.string().min(1).max(200),
  channelType: z
    .enum(["whatsapp", "instagram", "facebook", "telegram", "youtube", "twitter", "website", "email", "custom"])
    .default("custom"),
  url: z.string().min(1),
  iconUrl: z.string().optional(),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().default(0),
  visible: z.boolean().default(true),
});
export const socialChannelUpdateSchema = socialChannelCreateSchema.partial();