import { z } from "zod";

export const videoCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  youtubeUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  videoType: z.enum(["normal", "short", "live"]).optional(),
  videoChannelId: z.string().optional(),
  channelName: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  thumbnail: z.string().optional(),
  thumbnailMediaId: z.string().optional(),
  duration: z.string().max(20).optional(),
  isFeatured: z.boolean().optional(),
  visible: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export const videoUpdateSchema = videoCreateSchema.partial();