import path from "path";
import { env } from "../config/env";

/**
 * Storage abstraction. Currently only `local` is implemented.
 * Adding `s3` later only means adding an S3 driver that implements
 * the same `save()` / `resolveUrl()` shape — no app code changes needed.
 */
export interface StoredFile {
  filename: string;
  path: string; // relative to upload dir
  url: string; // publicly accessible URL
  size: number;
  mimeType: string;
}

export const storage = {
  driver: env.storage.driver,

  resolveUrl(filename: string, subdir = ""): string {
    // In production, set up a reverse proxy / CDN. Here we expose /uploads.
    const rel = path.posix.join(subdir, filename);
    return `/uploads/${rel}`;
  },

  localDir(subdir = ""): string {
    return path.resolve(env.storage.uploadDir, subdir);
  },
};