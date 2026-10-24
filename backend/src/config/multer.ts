import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { env } from "./env";

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/webm",
];

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

/** Multer middleware. Use `upload.single("file")`. Destination chosen by route param/body `kind`. */
export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const kind = (req.params.kind || req.body.kind || "misc").replace(/[^a-z0-9-_]/gi, "_");
      const dir = path.resolve(env.storage.uploadDir, kind);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || MIME_EXT[file.mimetype] || "";
      const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: env.storage.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});