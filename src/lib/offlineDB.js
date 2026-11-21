/**
 * offlineDB — IndexedDB wrapper for Dar Al-Uloom offline storage
 *
 * Stores:
 * - books:       book metadata (key = book.id)
 * - pdfs:        PDF ArrayBuffers (key = pdfUrl)
 * - images:      cover/book image blobs (key = imageUrl)
 * - favorites:   local favorites (key = bookId)
 * - pending:     pending sync operations (key = opId)
 * - meta:        key-value metadata (lastSync, offlineEnabled, etc.)
 * - videos:      video metadata (key = video.id)
 * - channels:    video channel metadata (key = channel.id)
 * - social:      social channel metadata (key = channel.id)
 * - settings:    app settings cache (key = setting_key)
 */

import initialBooks from "../../data-export/Books.json";
import initialVideos from "../../data-export/Videos.json";
import initialVideoChannels from "../../data-export/VideoChannels.json";
import initialSocialChannels from "../../data-export/SocialChannels.json";
import initialSettings from "../../data-export/AppSettings.json";

const DB_NAME = "dar_al_ulum_offline";
const DB_VERSION = 3;

let _db = null;
let _dbReady = null; // in-flight open promise to avoid duplicate opens

function _wireLifecycle(db) {
  db.onclose = () => { _db = null; };
  db.onversionchange = () => { db.close(); _db = null; };
}

function openDB() {
  // Still valid connection
  if (_db) return Promise.resolve(_db);
  // Open already in-flight
  if (_dbReady) return _dbReady;

  _dbReady = new Promise((resolve, reject) => {
    let settled = false;
    let fallbackTimer = null;

    const finishResolve = (dbInstance) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      _db = dbInstance;
      _wireLifecycle(_db);
      _dbReady = null;
      resolve(_db);
    };

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      _dbReady = null;
      reject(err);
    };

    const tryFallbackOpenCurrentVersion = () => {
      try {
        const fallbackReq = indexedDB.open(DB_NAME);
        fallbackReq.onsuccess = () => {
          finishResolve(fallbackReq.result);
        };
        fallbackReq.onerror = () => {
          finishReject(fallbackReq.error || new Error("IndexedDB fallback open failed"));
        };
      } catch (err) {
        finishReject(err);
      }
    };

    // If version upgrade is blocked by an unclosed connection for >900ms, fall back to opening the existing DB version
    fallbackTimer = setTimeout(() => {
      if (!settled) {
        tryFallbackOpenCurrentVersion();
      }
    }, 900);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books"))       db.createObjectStore("books",       { keyPath: "id" });
      if (!db.objectStoreNames.contains("pdfs"))        db.createObjectStore("pdfs",        { keyPath: "url" });
      if (!db.objectStoreNames.contains("images"))      db.createObjectStore("images",      { keyPath: "url" });
      if (!db.objectStoreNames.contains("favorites"))   db.createObjectStore("favorites",   { keyPath: "bookId" });
      if (!db.objectStoreNames.contains("pending"))     db.createObjectStore("pending",     { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("meta"))        db.createObjectStore("meta",        { keyPath: "key" });
      if (!db.objectStoreNames.contains("videos"))      db.createObjectStore("videos",      { keyPath: "id" });
      if (!db.objectStoreNames.contains("video_blobs")) db.createObjectStore("video_blobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("channels"))    db.createObjectStore("channels",    { keyPath: "id" });
      if (!db.objectStoreNames.contains("social"))      db.createObjectStore("social",      { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings"))    db.createObjectStore("settings",    { keyPath: "setting_key" });
    };
    req.onsuccess = () => {
      finishResolve(req.result);
    };
    req.onerror = () => {
      tryFallbackOpenCurrentVersion();
    };
    req.onblocked = () => {
      tryFallbackOpenCurrentVersion();
    };
  });

  return _dbReady;
}

const _memPdfs = new Map();
const _memBooks = new Map();
const _memVideos = new Map();
const _memChannels = new Map();
const _memSocial = new Map();
const _memSettings = new Map();
const _memVideoBlobs = new Map();

function withIdbTimeout(promise, ms = 1200, fallbackValue = undefined) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
  ]);
}

async function tx(store, mode = "readonly") {
  // If cached connection is dead, drop it so openDB() re-opens
  if (_db) {
    try {
      if (!_db.objectStoreNames.contains(store)) {
        throw new Error(`ObjectStore ${store} not found in current DB version`);
      }
      // A dead/closing connection throws on transaction() — detect & recover
      return _db.transaction(store, mode).objectStore(store);
    } catch (e) {
      if (String(e?.message || "").includes("not found in current DB version")) {
        throw e;
      }
      _db = null;
    }
  }
  const db = await openDB();
  if (!db.objectStoreNames.contains(store)) {
    throw new Error(`ObjectStore ${store} not found in current DB version`);
  }
  return db.transaction(store, mode).objectStore(store);
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// Wait for a transaction to finish. `transaction.done` is not supported in all
// browsers (e.g. older Safari), so we listen to events instead.
function txDone(store) {
  const tx = store.transaction;
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

// ─── Books ────────────────────────────────────────────────────────────────────
export async function cacheBooks(books) {
  if (Array.isArray(books)) {
    for (const book of books) {
      if (book?.id) _memBooks.set(String(book.id), { ...book, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books", "readwrite");
        for (const book of books) {
          store.put({ ...book, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function replaceCachedBooks(books) {
  _memBooks.clear();
  if (Array.isArray(books)) {
    for (const book of books) {
      if (book?.id) _memBooks.set(String(book.id), { ...book, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books", "readwrite");
        store.clear();
        for (const book of books) {
          store.put({ ...book, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedBooks() {
  await purgeOldSeedMediaOnce();
  const items = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books");
        return await reqAsPromise(store.getAll());
      } catch {
        return Array.from(_memBooks.values());
      }
    })(),
    1000,
    Array.from(_memBooks.values())
  );
  if (items && items.length > 0) {
    for (const b of items) {
      if (b?.id && !_memBooks.has(String(b.id))) _memBooks.set(String(b.id), b);
    }
    return Array.from(_memBooks.values());
  }
  if (_memBooks.size > 0) {
    return Array.from(_memBooks.values());
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem("dau_books_initialized") === "true") {
    return [];
  }
  if (Array.isArray(initialBooks) && initialBooks.length > 0) {
    if (typeof localStorage !== "undefined") localStorage.setItem("dau_books_initialized", "true");
    await cacheBooks(initialBooks);
    return initialBooks;
  }
  return [];
}

export async function getCachedBook(id) {
  await purgeOldSeedMediaOnce();
  if (_memBooks.has(String(id))) return _memBooks.get(String(id));
  let book = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books");
        return (await reqAsPromise(store.get(id))) || (await reqAsPromise(store.get(String(id))));
      } catch {
        return null;
      }
    })(),
    1000,
    null
  );
  if (!book && Array.isArray(initialBooks)) {
    book = initialBooks.find((b) => b.id === id) || null;
    if (book) {
      await cacheBooks([book]);
    }
  }
  return book;
}

export async function deleteCachedBook(id) {
  _memBooks.delete(String(id));
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books", "readwrite");
        store.delete(id);
        store.delete(String(id));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function clearAllCachedBooks() {
  _memBooks.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("books", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── PDFs ─────────────────────────────────────────────────────────────────────
function normalizePdfTitleKey(str) {
  return String(str || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isLikelyPdfBuffer(buffer) {
  if (!buffer) return false;
  const u8 =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : buffer.buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength || 0)
      : null;
  if (!u8 || u8.length < 32) return false;
  const maxScan = Math.min(u8.length - 5, 2048);
  for (let i = 0; i <= maxScan; i++) {
    // "%PDF-" = 0x25 0x50 0x44 0x46 0x2d
    if (
      u8[i] === 0x25 &&
      u8[i + 1] === 0x50 &&
      u8[i + 2] === 0x44 &&
      u8[i + 3] === 0x46 &&
      u8[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

export async function cachePdf(url, buffer, bookId, title) {
  if (!url || !buffer || !isLikelyPdfBuffer(buffer)) return;
  const rec = { url, buffer, bookId, title, size: buffer.byteLength, date: Date.now() };
  _memPdfs.set(url, rec);
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pdfs", "readwrite");
        store.put(rec);
        await txDone(store);
      } catch {}
    })(),
    10000
  );
}

export async function getCachedPdf(url) {
  if (!url) return null;
  if (_memPdfs.has(url)) {
    const m = _memPdfs.get(url);
    if (isLikelyPdfBuffer(m?.buffer)) return m;
    _memPdfs.delete(url);
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pdfs");
        const rec = await reqAsPromise(store.get(url));
        if (rec && isLikelyPdfBuffer(rec.buffer)) {
          _memPdfs.set(url, rec);
          return rec;
        }
        return null;
      } catch {
        return null;
      }
    })(),
    10000,
    null
  );
}

export async function getAllCachedPdfs() {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pdfs");
        const list = await reqAsPromise(store.getAll());
        if (Array.isArray(list) && list.length > 0) {
          const validList = list.filter((rec) => rec?.url && isLikelyPdfBuffer(rec?.buffer));
          for (const rec of validList) {
            _memPdfs.set(rec.url, rec);
          }
          return validList;
        }
        return Array.from(_memPdfs.values()).filter((rec) => isLikelyPdfBuffer(rec?.buffer));
      } catch {
        return Array.from(_memPdfs.values()).filter((rec) => isLikelyPdfBuffer(rec?.buffer));
      }
    })(),
    10000,
    Array.from(_memPdfs.values()).filter((rec) => isLikelyPdfBuffer(rec?.buffer))
  );
}

export async function findCachedPdfForBook({ url, bookId, title } = {}) {
  if (url) {
    const exact = await getCachedPdf(url);
    if (exact?.buffer && isLikelyPdfBuffer(exact.buffer)) return exact;
  }
  const all = await getAllCachedPdfs();
  if (!Array.isArray(all) || all.length === 0) return null;

  const normTargetTitle = normalizePdfTitleKey(title);
  const matched = all.find((rec) => {
    if (!rec?.buffer || !isLikelyPdfBuffer(rec.buffer)) return false;
    if (url && rec.url === url) return true;
    if (bookId && (rec.bookId === bookId || rec.url === bookId)) return true;
    if (normTargetTitle) {
      const normRecTitle = normalizePdfTitleKey(rec.title);
      if (
        normRecTitle &&
        (normRecTitle === normTargetTitle ||
          normRecTitle.includes(normTargetTitle) ||
          normTargetTitle.includes(normRecTitle))
      ) {
        return true;
      }
    }
    return false;
  });

  if (matched) return matched;
  // If there is only 1 valid cached PDF in IndexedDB and the user only has 1 book, return it as fallback
  if (all.length === 1 && all[0]?.buffer && isLikelyPdfBuffer(all[0].buffer)) {
    return all[0];
  }
  return null;
}

export async function deleteCachedPdf(url) {
  _memPdfs.delete(url);
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pdfs", "readwrite");
        store.delete(url);
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function clearAllCachedPdfs() {
  _memPdfs.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pdfs", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── Images ───────────────────────────────────────────────────────────────────
export async function cacheImage(url, blob) {
  if (!url || !blob) return;
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("images", "readwrite");
        store.put({ url, blob, size: blob.size, date: Date.now() });
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedImage(url) {
  if (!url) return null;
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("images");
        return await reqAsPromise(store.get(url));
      } catch {
        return null;
      }
    })(),
    1000,
    null
  );
}

export async function getAllCachedImages() {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("images");
        return (await reqAsPromise(store.getAll())) || [];
      } catch {
        return [];
      }
    })(),
    1000,
    []
  );
}

export async function getCachedImageBlobUrl(url) {
  const rec = await getCachedImage(url);
  return rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
}

// ─── Favorites (offline) ──────────────────────────────────────────────────────
export async function saveLocalFavorite(bookId, userEmail) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("favorites", "readwrite");
        store.put({ bookId, userEmail, date: Date.now() });
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function removeLocalFavorite(bookId) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("favorites", "readwrite");
        store.delete(bookId);
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getLocalFavorites() {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("favorites");
        return (await reqAsPromise(store.getAll())) || [];
      } catch {
        return [];
      }
    })(),
    1000,
    []
  );
}

export async function getLocalFavoriteIds() {
  const favs = await getLocalFavorites();
  return favs.map(f => f.bookId);
}

// ─── Pending sync queue ───────────────────────────────────────────────────────
export async function addPendingOp(op) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pending", "readwrite");
        store.put({ ...op, date: Date.now() });
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getPendingOps() {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pending");
        return (await reqAsPromise(store.getAll())) || [];
      } catch {
        return [];
      }
    })(),
    1000,
    []
  );
}

export async function deletePendingOp(id) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("pending", "readwrite");
        store.delete(id);
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── Videos ───────────────────────────────────────────────────────────────────
export async function cacheVideos(videos) {
  if (Array.isArray(videos)) {
    for (const v of videos) {
      if (v?.id) _memVideos.set(String(v.id), { ...v, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("videos", "readwrite");
        for (const v of (videos || [])) {
          if (v?.id) store.put({ ...v, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function replaceCachedVideos(videos) {
  _memVideos.clear();
  if (Array.isArray(videos)) {
    for (const v of videos) {
      if (v?.id) _memVideos.set(String(v.id), { ...v, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("videos", "readwrite");
        store.clear();
        for (const v of (videos || [])) {
          if (v?.id) store.put({ ...v, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function clearAllCachedVideos() {
  _memVideos.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("videos", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

let _catalogPurgePromise = null;
export async function purgeOldSeedMediaOnce() {
  if (_catalogPurgePromise) return _catalogPurgePromise;
  _catalogPurgePromise = Promise.resolve();
  return _catalogPurgePromise;
}

export async function getCachedVideos() {
  await purgeOldSeedMediaOnce();
  const items = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("videos");
        return await reqAsPromise(store.getAll());
      } catch {
        return Array.from(_memVideos.values());
      }
    })(),
    1000,
    Array.from(_memVideos.values())
  );
  if (items && items.length > 0) {
    for (const v of items) {
      if (v?.id && !_memVideos.has(String(v.id))) _memVideos.set(String(v.id), v);
    }
    return Array.from(_memVideos.values());
  }
  if (_memVideos.size > 0) {
    return Array.from(_memVideos.values());
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem("dau_videos_initialized") === "true") {
    return [];
  }
  if (Array.isArray(initialVideos) && initialVideos.length > 0) {
    if (typeof localStorage !== "undefined") localStorage.setItem("dau_videos_initialized", "true");
    await cacheVideos(initialVideos);
    return initialVideos;
  }
  return [];
}

export async function deleteCachedVideo(id) {
  _memVideos.delete(String(id));
  await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("videos", "readwrite");
        store.delete(id);
        store.delete(String(id));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
  await removeVideoFromOffline(id).catch(() => {});
}

// ─── Offline Video Blobs (Watch Without Internet) ─────────────────────────────
const OFFLINE_VIDEOS_KEY = "dau_offline_video_ids";

export function getSavedOfflineVideoIds() {
  try {
    const raw = localStorage.getItem(OFFLINE_VIDEOS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isVideoSavedOffline(videoId) {
  if (!videoId) return false;
  return getSavedOfflineVideoIds().includes(String(videoId));
}

function setSavedOfflineVideoIds(ids) {
  try {
    const unique = Array.from(new Set(ids.map(String)));
    localStorage.setItem(OFFLINE_VIDEOS_KEY, JSON.stringify(unique));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dau:offline-videos-changed", { detail: unique }));
    }
  } catch {}
}

export async function getOfflineVideoRecord(videoId) {
  if (!videoId) return null;
  if (_memVideoBlobs.has(String(videoId))) return _memVideoBlobs.get(String(videoId));
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("video_blobs");
        const rec =
          (await reqAsPromise(store.get(videoId))) ||
          (await reqAsPromise(store.get(String(videoId)))) ||
          null;
        if (rec) _memVideoBlobs.set(String(videoId), rec);
        return rec;
      } catch {
        return _memVideoBlobs.get(String(videoId)) || null;
      }
    })(),
    1000,
    _memVideoBlobs.get(String(videoId)) || null
  );
}

export async function getOfflineVideoBlobUrl(videoId) {
  const rec = await getOfflineVideoRecord(videoId);
  if (rec && rec.blob instanceof Blob && rec.blob.size > 0) {
    return {
      blobUrl: URL.createObjectURL(rec.blob),
      mimeType: rec.mimeType || "video/mp4",
      size: rec.size || rec.blob.size,
      record: rec,
    };
  }
  return null;
}

export async function removeVideoFromOffline(videoId) {
  if (!videoId) return;
  _memVideoBlobs.delete(String(videoId));
  await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("video_blobs", "readwrite");
        store.delete(videoId);
        store.delete(String(videoId));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
  const current = getSavedOfflineVideoIds().filter((id) => id !== String(videoId));
  setSavedOfflineVideoIds(current);
}

export async function downloadVideoForOffline(video, onProgress) {
  if (!video || !video.id) throw new Error("Invalid video");
  const vidKey = String(video.id);
  onProgress?.(5);

  // 1. Always cache the video metadata in IndexedDB "videos"
  try {
    await cacheVideos([video]);
  } catch {}

  // 2. Cache the video thumbnail image for offline display
  const thumbUrl = video.thumbnail || video.thumbnail_url || "";
  if (thumbUrl) {
    try {
      const proxiedThumb = `/api/proxy-image?url=${encodeURIComponent(thumbUrl)}`;
      const tRes = await fetch(proxiedThumb);
      if (tRes.ok) {
        const tBlob = await tRes.blob();
        if (tBlob && tBlob.size > 0) {
          await cacheImage(thumbUrl, tBlob);
        }
      }
    } catch {}
  }
  onProgress?.(18);

  // 3. Download MP4 video stream via /api/youtube-download or direct file_url
  const rawUrl = video.file_url || video.youtube_url || "";
  const isDirect =
    rawUrl &&
    (/\.(mp4|webm|mov)(\?.*)?$/i.test(rawUrl) ||
      rawUrl.startsWith("blob:") ||
      rawUrl.startsWith("data:video/"));

  const downloadEndpoint = isDirect
    ? `/api/youtube-download?directUrl=${encodeURIComponent(rawUrl)}`
    : `/api/youtube-download?url=${encodeURIComponent(rawUrl)}`;

  let videoBlob = null;
  let mimeType = "video/mp4";

  try {
    const res = await fetch(downloadEndpoint);
    if (res.ok) {
      mimeType = (res.headers.get("content-type") || "video/mp4").split(";")[0];
      const totalBytes = Number(res.headers.get("content-length") || 0);

      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            if (totalBytes > 0) {
              const pct = Math.min(96, Math.round(18 + (received / totalBytes) * 78));
              onProgress?.(pct);
            } else {
              // Smooth synthetic progress when Content-Length is chunked
              const approxPct = Math.min(92, 18 + Math.floor(Math.log10(received + 10) * 11));
              onProgress?.(approxPct);
            }
          }
        }
        if (received > 0) {
          videoBlob = new Blob(chunks, { type: mimeType });
        }
      } else {
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          videoBlob = new Blob([buf], { type: mimeType });
        }
      }
    }
  } catch {
    // Fallback if direct MP4 stream extraction was blocked
  }

  onProgress?.(98);

  // 4. Save into IndexedDB "video_blobs"
  const record = {
    id: vidKey,
    title: video.title || "",
    channel_name: video.channel_name || "",
    youtube_url: video.youtube_url || "",
    thumbnail: thumbUrl,
    blob: videoBlob,
    hasVideoBlob: Boolean(videoBlob && videoBlob.size > 0),
    mimeType,
    size: videoBlob ? videoBlob.size : 0,
    date: Date.now(),
  };
  _memVideoBlobs.set(vidKey, record);
  await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("video_blobs", "readwrite");
        store.put(record);
        await txDone(store);
      } catch {}
    })(),
    1200
  );

  const ids = getSavedOfflineVideoIds();
  if (!ids.includes(vidKey)) {
    setSavedOfflineVideoIds([...ids, vidKey]);
  } else {
    setSavedOfflineVideoIds(ids);
  }
  onProgress?.(100);
  return record;
}

// ─── Video Channels ───────────────────────────────────────────────────────────
export async function clearAllCachedVideoChannels() {
  _memChannels.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("channels", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function cacheVideoChannels(channels) {
  if (Array.isArray(channels)) {
    for (const c of channels) {
      if (c?.id) _memChannels.set(String(c.id), { ...c, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("channels", "readwrite");
        for (const c of (channels || [])) {
          if (c?.id) store.put({ ...c, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function replaceCachedVideoChannels(channels) {
  _memChannels.clear();
  if (Array.isArray(channels)) {
    for (const c of channels) {
      if (c?.id) _memChannels.set(String(c.id), { ...c, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("channels", "readwrite");
        store.clear();
        for (const c of (channels || [])) {
          if (c?.id) store.put({ ...c, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedVideoChannels() {
  await purgeOldSeedMediaOnce();
  const items = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("channels");
        return await reqAsPromise(store.getAll());
      } catch {
        return Array.from(_memChannels.values());
      }
    })(),
    1000,
    Array.from(_memChannels.values())
  );
  if (items && items.length > 0) {
    for (const c of items) {
      if (c?.id && !_memChannels.has(String(c.id))) _memChannels.set(String(c.id), c);
    }
    return Array.from(_memChannels.values());
  }
  if (_memChannels.size > 0) {
    return Array.from(_memChannels.values());
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem("dau_video_channels_initialized") === "true") {
    return [];
  }
  if (Array.isArray(initialVideoChannels) && initialVideoChannels.length > 0) {
    if (typeof localStorage !== "undefined") localStorage.setItem("dau_video_channels_initialized", "true");
    await cacheVideoChannels(initialVideoChannels);
    return initialVideoChannels;
  }
  return [];
}

export async function deleteCachedVideoChannel(id) {
  _memChannels.delete(String(id));
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("channels", "readwrite");
        store.delete(id);
        store.delete(String(id));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── Social Channels ──────────────────────────────────────────────────────────
export async function clearAllCachedSocialChannels() {
  _memSocial.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("social", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function cacheSocialChannels(channels) {
  if (Array.isArray(channels)) {
    for (const c of channels) {
      if (c?.id) _memSocial.set(String(c.id), { ...c, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("social", "readwrite");
        for (const c of (channels || [])) {
          if (c?.id) store.put({ ...c, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function replaceCachedSocialChannels(channels) {
  _memSocial.clear();
  if (Array.isArray(channels)) {
    for (const c of channels) {
      if (c?.id) _memSocial.set(String(c.id), { ...c, _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("social", "readwrite");
        store.clear();
        for (const c of (channels || [])) {
          if (c?.id) store.put({ ...c, _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedSocialChannels() {
  await purgeOldSeedMediaOnce();
  const items = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("social");
        return await reqAsPromise(store.getAll());
      } catch {
        return Array.from(_memSocial.values());
      }
    })(),
    1000,
    Array.from(_memSocial.values())
  );
  if (items && items.length > 0) {
    for (const c of items) {
      if (c?.id && !_memSocial.has(String(c.id))) _memSocial.set(String(c.id), c);
    }
    return Array.from(_memSocial.values());
  }
  if (_memSocial.size > 0) {
    return Array.from(_memSocial.values());
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem("dau_social_channels_initialized") === "true") {
    return [];
  }
  if (Array.isArray(initialSocialChannels) && initialSocialChannels.length > 0) {
    if (typeof localStorage !== "undefined") localStorage.setItem("dau_social_channels_initialized", "true");
    await cacheSocialChannels(initialSocialChannels);
    return initialSocialChannels;
  }
  return [];
}

export async function deleteCachedSocialChannel(id) {
  _memSocial.delete(String(id));
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("social", "readwrite");
        store.delete(id);
        store.delete(String(id));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function cacheSettings(settings) {
  if (Array.isArray(settings)) {
    for (const s of settings) {
      const k = s?.setting_key || s?.id;
      if (k) _memSettings.set(String(k), { ...s, setting_key: String(k), _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings", "readwrite");
        for (const s of (settings || [])) {
          const k = s?.setting_key || s?.id;
          if (k) store.put({ ...s, setting_key: String(k), _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function replaceCachedSettings(settings) {
  _memSettings.clear();
  if (Array.isArray(settings)) {
    for (const s of settings) {
      const k = s?.setting_key || s?.id;
      if (k) _memSettings.set(String(k), { ...s, setting_key: String(k), _cached_at: Date.now() });
    }
  }
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings", "readwrite");
        store.clear();
        for (const s of (settings || [])) {
          const k = s?.setting_key || s?.id;
          if (k) store.put({ ...s, setting_key: String(k), _cached_at: Date.now() });
        }
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedSettings() {
  const items = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings");
        return await reqAsPromise(store.getAll());
      } catch {
        return Array.from(_memSettings.values());
      }
    })(),
    1000,
    Array.from(_memSettings.values())
  );
  if (items && items.length > 0) {
    for (const s of items) {
      const k = s?.setting_key || s?.id;
      if (k && !_memSettings.has(String(k))) _memSettings.set(String(k), s);
    }
    return Array.from(_memSettings.values());
  }
  if (_memSettings.size > 0) {
    return Array.from(_memSettings.values());
  }
  const map = new Map();
  for (const s of (initialSettings || [])) {
    if (s.setting_key && !map.has(s.setting_key)) {
      map.set(s.setting_key, s);
    }
  }
  const deduped = Array.from(map.values());
  if (deduped.length > 0) {
    await cacheSettings(deduped);
    return deduped;
  }
  return [];
}

export async function deleteCachedSetting(key) {
  _memSettings.delete(String(key));
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings", "readwrite");
        store.delete(key);
        store.delete(String(key));
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function clearAllCachedSettings() {
  _memSettings.clear();
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings", "readwrite");
        store.clear();
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

export async function getCachedSetting(key) {
  if (_memSettings.has(String(key))) {
    return _memSettings.get(String(key))?.setting_value ?? null;
  }
  const rec = await withIdbTimeout(
    (async () => {
      try {
        const store = await tx("settings");
        return await reqAsPromise(store.get(key));
      } catch {
        return null;
      }
    })(),
    1000,
    null
  );
  if (rec) return rec.setting_value;
  const match = (initialSettings || []).find((s) => s.setting_key === key);
  return match ? match.setting_value : null;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────
export async function getMeta(key) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("meta");
        const rec = await reqAsPromise(store.get(key));
        return rec ? rec.value : null;
      } catch {
        return null;
      }
    })(),
    1000,
    null
  );
}

export async function setMeta(key, value) {
  return withIdbTimeout(
    (async () => {
      try {
        const store = await tx("meta", "readwrite");
        store.put({ key, value });
        await txDone(store);
      } catch {}
    })(),
    1000
  );
}

// ─── Storage management ───────────────────────────────────────────────────────
export async function clearAllCache() {
  _memBooks.clear();
  _memPdfs.clear();
  _memVideos.clear();
  _memChannels.clear();
  _memSocial.clear();
  _memSettings.clear();
  _memVideoBlobs.clear();
  const stores = ["books", "pdfs", "images", "pending", "videos", "channels", "social", "settings"];
  for (const s of stores) {
    await withIdbTimeout(
      (async () => {
        try {
          const store = await tx(s, "readwrite");
          store.clear();
          await txDone(store);
        } catch {}
      })(),
      1000
    );
  }
}

export async function getStorageEstimate() {
  let booksCount = 0, pdfsCount = 0, imagesCount = 0, pdfsSize = 0, imagesSize = 0, videosCount = 0;

  const books = await getCachedBooks();
  booksCount = books.length;

  const pdfs = await getAllCachedPdfs();
  pdfsCount = pdfs.length;
  pdfsSize = pdfs.reduce((sum, p) => sum + (p.size || 0), 0);

  const images = await getAllCachedImages();
  imagesCount = images.length;
  imagesSize = images.reduce((sum, i) => sum + (i.size || 0), 0);

  const videos = await getCachedVideos();
  videosCount = videos.length;

  const totalSize = pdfsSize + imagesSize;
  const navEstimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};

  return {
    booksCount,
    pdfsCount,
    imagesCount,
    videosCount,
    pdfsSize,
    imagesSize,
    totalSize,
    quota: navEstimate.quota || 0,
    usage: navEstimate.usage || 0,
  };
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}