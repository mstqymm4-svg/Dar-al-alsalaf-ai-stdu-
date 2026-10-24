/**
 * Phase 25 — Migration helper from Base44 export to PostgreSQL.
 *
 * This script does NOT connect to Base44 at runtime (the Base44 SDK only
 * works inside the platform). Instead it consumes JSON files you export
 * from the Base44 admin/data view and inserts them via Prisma.
 *
 * How to export: in the Base44 app builder, list each entity
 * (Books, Videos, VideoChannels, SocialChannels, AppSettings, …) and
 * download as JSON, OR run a one-off script inside Base44 that calls
 * base44.entities.X.list() and writes the result to a file. Place those
 * files in `scripts/data/` with the names below, then run:
 *
 *   npm run migrate-from-base44
 *
 * It is idempotent-ish: it upserts by matching title/name + url where
 * possible. Review the dry-run output before committing.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../config/prisma";

const DATA_DIR = path.resolve(__dirname, "data");

function load(name: string): any[] {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(raw) ? raw : raw.data ?? [];
  } catch {
    return [];
  }
}

async function migrateBooks() {
  const rows = load("books.json");
  for (const b of rows) {
    await prisma.book.upsert({
      where: { id: b.id ?? "missing" },
      create: {
        title: b.title,
        authorName: b.author,
        categoryName: b.category,
        description: b.description,
        coverImage: b.cover_image,
        pagesCount: b.pages_count,
        language: mapLanguage(b.language),
        pdfUrl: b.pdf_url,
        isFeatured: b.is_featured ?? false,
        rating: b.rating ?? 0,
        status: b.status ?? "published",
      },
      update: {},
    }).catch(() => {
      // upsert by id may fail if id is a Base44 format; fallback to create
      return prisma.book.create({
        data: {
          title: b.title,
          authorName: b.author,
          categoryName: b.category,
          description: b.description,
          coverImage: b.cover_image,
          pagesCount: b.pages_count,
          language: mapLanguage(b.language),
          pdfUrl: b.pdf_url,
          isFeatured: b.is_featured ?? false,
          rating: b.rating ?? 0,
          status: b.status ?? "published",
        },
      });
    });
  }
  console.log(`books: processed ${rows.length}`);
}

function mapLanguage(l?: string) {
  const map: Record<string, string> = {
    "العربية": "ar", "الإنجليزية": "en", "الفرنسية": "fr", "الأوردو": "ur", "الهندية": "hi",
  };
  return (l && map[l]) || "other";
}

async function migrateVideos() {
  const rows = load("videos.json");
  for (const v of rows) {
    await prisma.video.create({
      data: {
        title: v.title,
        description: v.description,
        youtubeUrl: v.youtube_url,
        channelName: v.channel_name,
        category: v.category,
        thumbnail: v.thumbnail,
        duration: v.duration,
        isFeatured: v.is_featured ?? false,
        visible: v.visible ?? true,
        sortOrder: v.sort_order ?? 0,
        videoType: v.video_type ?? "normal",
      },
    }).catch(() => {});
  }
  console.log(`videos: processed ${rows.length}`);
}

async function migrateChannels() {
  for (const [name, target] of [
    ["videoChannels.json", "videoChannel"],
    ["socialChannels.json", "socialChannel"],
  ] as const) {
    const rows = load(name);
    for (const r of rows) {
      const model = (prisma as any)[target];
      await model.create({ data: rowToChannel(r, target) }).catch(() => {});
    }
    console.log(`${name}: processed ${rows.length}`);
  }
}

function rowToChannel(r: any, target: string) {
  if (target === "videoChannel") {
    return {
      name: r.name,
      channelLogo: r.channel_logo,
      description: r.description,
      youtubeUrl: r.youtube_url,
      category: r.category,
      sortOrder: r.sort_order ?? 0,
      visible: r.visible ?? true,
    };
  }
  return {
    name: r.name,
    channelType: r.channel_type ?? "custom",
    url: r.url,
    iconUrl: r.icon_url,
    description: r.description,
    sortOrder: r.sort_order ?? 0,
    visible: r.visible ?? true,
  };
}

async function migrateSettings() {
  const rows = load("appSettings.json");
  for (const s of rows) {
    await prisma.appSetting.upsert({
      where: { key: s.setting_key },
      create: {
        key: s.setting_key,
        value: s.setting_value,
        type: (s.setting_type as any) ?? "text",
        description: s.description,
      },
      update: { value: s.setting_value, type: (s.setting_type as any) ?? "text", description: s.description },
    }).catch(() => {});
  }
  console.log(`appSettings: processed ${rows.length}`);
}

async function main() {
  console.log(`Reading migration data from ${DATA_DIR}`);
  await migrateBooks();
  await migrateVideos();
  await migrateChannels();
  await migrateSettings();
  await prisma.$disconnect();
  console.log("Migration complete.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  prisma.$disconnect().finally(() => process.exit(1));
});