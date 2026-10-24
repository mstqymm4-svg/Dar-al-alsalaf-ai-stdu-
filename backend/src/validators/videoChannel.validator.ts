import { z } from "zod";

export const videoChannelCreateSchema = z.object({
  name: z.string().min(1).max(200),
  channelLogo: z.string().optional(),
  description: z.string().max(2000).optional(),
  youtubeUrl: z.string().optional(),
  category: z.string().max(100).optional(),
  sortOrder: z.number().int().default(0),
  visible: z.boolean().default(true),
});
export const videoChannelUpdateSchema = videoChannelCreateSchema.partial();