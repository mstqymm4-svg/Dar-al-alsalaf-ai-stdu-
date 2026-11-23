/**
 * DAR AL TAWHID — Intelligent Reader Audio & OCR Cache Manager (v4)
 *
 * Uses a dedicated IndexedDB database (`dat_intelligent_reader_cache_v4`) to store:
 * 1. `page_ocr`: Structured OCR & Nastaliq extraction results per `bookId::pageNumber`
 * 2. `tts_audio`: Synthesized neural audio + word boundary timings per `hash(version + text + voiceId + language)`
 * 3. `quran_meta`: Verified Quran verse metadata & audio URLs
 */

const CACHE_DB_NAME = "dat_intelligent_reader_cache_v4";
const CACHE_DB_VERSION = 1;
export const PIPELINE_CACHE_VERSION = "v4";

const LEGACY_DB_NAMES = [
  "dat_intelligent_reader_cache_v1",
  "dat_intelligent_reader_cache_v2",
  "dat_intelligent_reader_cache_v3",
  "dar_al_tawhid_intelligent_reader_v1",
];

let _cacheDb = null;
let _legacyCleaned = false;

function cleanupLegacyCachesOnce() {
  if (_legacyCleaned || typeof indexedDB === "undefined") return;
  _legacyCleaned = true;
  for (const oldName of LEGACY_DB_NAMES) {
    try {
      indexedDB.deleteDatabase(oldName);
    } catch {}
  }
}

function openCacheDb() {
  cleanupLegacyCachesOnce();
  if (_cacheDb) return Promise.resolve(_cacheDb);
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("page_ocr")) {
          db.createObjectStore("page_ocr", { keyPath: "cacheKey" });
        }
        if (!db.objectStoreNames.contains("tts_audio")) {
          db.createObjectStore("tts_audio", { keyPath: "cacheKey" });
        }
        if (!db.objectStoreNames.contains("quran_meta")) {
          db.createObjectStore("quran_meta", { keyPath: "cacheKey" });
        }
      };
      req.onsuccess = () => {
        _cacheDb = req.result;
        _cacheDb.onclose = () => {
          _cacheDb = null;
        };
        resolve(_cacheDb);
      };
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

const _memOcr = new Map();
const _memTts = new Map();
const _memQuran = new Map();

export function hashString(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ─── Page OCR Cache ───────────────────────────────────────────────────────────
export async function getCachedPageOcr(bookId, pageNumber) {
  const cacheKey = `${PIPELINE_CACHE_VERSION}::${String(bookId || "book")}::p${Number(pageNumber || 1)}`;
  if (_memOcr.has(cacheKey)) return _memOcr.get(cacheKey);
  try {
    const db = await openCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("page_ocr", "readonly");
      const req = tx.objectStore("page_ocr").get(cacheKey);
      req.onsuccess = () => {
        if (req.result && req.result?.data?.pipelineVersion === 4) {
          _memOcr.set(cacheKey, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedPageOcr(bookId, pageNumber, data) {
  const cacheKey = `${PIPELINE_CACHE_VERSION}::${String(bookId || "book")}::p${Number(pageNumber || 1)}`;
  const record = {
    cacheKey,
    bookId: String(bookId || "book"),
    pageNumber: Number(pageNumber || 1),
    data: { ...data, pipelineVersion: 4 },
    sizeBytes: JSON.stringify(data || {}).length,
    updatedAt: Date.now(),
  };
  _memOcr.set(cacheKey, record);
  try {
    const db = await openCacheDb();
    await new Promise((resolve) => {
      const tx = db.transaction("page_ocr", "readwrite");
      tx.objectStore("page_ocr").put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {}
  return record;
}

// ─── TTS Audio Cache ──────────────────────────────────────────────────────────
export function makeTtsCacheKey(text, voiceId, language) {
  return `tts::${PIPELINE_CACHE_VERSION}::${voiceId}::${language}::${hashString(text)}`;
}

export async function getCachedTtsAudio(text, voiceId, language) {
  const cacheKey = makeTtsCacheKey(text, voiceId, language);
  if (_memTts.has(cacheKey)) return _memTts.get(cacheKey);
  try {
    const db = await openCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("tts_audio", "readonly");
      const req = tx.objectStore("tts_audio").get(cacheKey);
      req.onsuccess = () => {
        if (req.result && req.result.pipelineVersion === 4) {
          _memTts.set(cacheKey, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedTtsAudio(text, voiceId, language, payload) {
  const cacheKey = makeTtsCacheKey(text, voiceId, language);
  const record = {
    cacheKey,
    pipelineVersion: 4,
    voiceId,
    language,
    ...payload,
    sizeBytes: (payload?.audioBase64?.length || 0) * 0.75,
    updatedAt: Date.now(),
  };
  _memTts.set(cacheKey, record);
  try {
    const db = await openCacheDb();
    await new Promise((resolve) => {
      const tx = db.transaction("tts_audio", "readwrite");
      tx.objectStore("tts_audio").put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {}
  return record;
}

// ─── Quran Verification Cache ─────────────────────────────────────────────────
export async function getCachedQuranVerification(text, reciterId) {
  const cacheKey = `quran::${PIPELINE_CACHE_VERSION}::${reciterId}::${hashString(text)}`;
  if (_memQuran.has(cacheKey)) return _memQuran.get(cacheKey);
  try {
    const db = await openCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("quran_meta", "readonly");
      const req = tx.objectStore("quran_meta").get(cacheKey);
      req.onsuccess = () => {
        if (req.result) _memQuran.set(cacheKey, req.result);
        resolve(req.result || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedQuranVerification(text, reciterId, result) {
  const cacheKey = `quran::${PIPELINE_CACHE_VERSION}::${reciterId}::${hashString(text)}`;
  const record = { cacheKey, reciterId, ...result, updatedAt: Date.now() };
  _memQuran.set(cacheKey, record);
  try {
    const db = await openCacheDb();
    await new Promise((resolve) => {
      const tx = db.transaction("quran_meta", "readwrite");
      tx.objectStore("quran_meta").put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {}
  return record;
}

// ─── Cache Statistics & Cleanup ───────────────────────────────────────────────
export async function getReaderCacheStats() {
  let ocrCount = 0;
  let ocrBytes = 0;
  let ttsCount = 0;
  let ttsBytes = 0;
  try {
    const db = await openCacheDb();
    const ocrAll = await new Promise((resolve) => {
      const req = db.transaction("page_ocr", "readonly").objectStore("page_ocr").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    ocrCount = ocrAll.length;
    ocrBytes = ocrAll.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);

    const ttsAll = await new Promise((resolve) => {
      const req = db.transaction("tts_audio", "readonly").objectStore("tts_audio").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    ttsCount = ttsAll.length;
    ttsBytes = ttsAll.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  } catch {
    ocrCount = _memOcr.size;
    ttsCount = _memTts.size;
  }
  return {
    ocrCount,
    ocrBytes,
    ttsCount,
    ttsBytes,
    totalBytes: Math.round(ocrBytes + ttsBytes),
  };
}

export async function clearReaderCache() {
  _memOcr.clear();
  _memTts.clear();
  _memQuran.clear();
  try {
    const db = await openCacheDb();
    for (const storeName of ["page_ocr", "tts_audio", "quran_meta"]) {
      await new Promise((resolve) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }
  } catch {}
}
