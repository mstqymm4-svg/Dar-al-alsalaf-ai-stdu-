import * as pdfjsLib from "pdfjs-dist";
import { apiUrl } from "@/lib/apiBase";
import { fetchFirestorePdfBuffer } from "@/api/base44Client";
import { getCachedPdf, cachePdf } from "./offlineDB";
import { getAccountEmail, addDownloadedBookId } from "./activeUser";

// Bundle worker locally using Vite's asset handling with fallback for older Android WebViews
let workerPort = null;
try {
  workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" }
  );
  pdfjsLib.GlobalWorkerOptions.workerPort = workerPort;
} catch {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  } catch {
    // pdfjs will fall back to fake worker automatically
  }
}

export { pdfjsLib };

// Memory Cache for Instant Resume during the same session
const activeDocuments = new Map();
const pageTextCache = new Map();
const MAX_ACTIVE_DOCS = 3;

function persistDocumentOfflineInBackground(pdfDocument, url, metadata = {}) {
  if (!pdfDocument || !url) return;
  pdfDocument
    .getData()
    .then((uint8) => {
      if (uint8 && uint8.buffer) {
        const buf = uint8.buffer.slice(
          uint8.byteOffset,
          uint8.byteOffset + uint8.byteLength
        );
        return cachePdf(url, buf, metadata.bookId, metadata.title).then(() => {
          if (metadata.bookId) {
            addDownloadedBookId(getAccountEmail(), metadata.bookId);
          }
        });
      }
    })
    .catch(() => {});
}

export async function loadPdfDocument(url, _metadata = {}) {
  if (!url) throw new Error("No PDF URL provided");

  // 1. Check Memory Cache first (Instant 0ms load if recently opened)
  if (activeDocuments.has(url)) {
    const cachedDoc = activeDocuments.get(url);
    if (cachedDoc && typeof cachedDoc.numPages === "number") {
      activeDocuments.delete(url);
      activeDocuments.set(url, cachedDoc);
      return cachedDoc;
    }
    activeDocuments.delete(url);
  }

  let loadingTask;
  let source = "remote";
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const fontOpts = online
    ? {
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
        cMapPacked: true,
        standardFontDataUrl:
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
      }
    : {};

  try {
    // 2. Check IndexedDB Cache (Fast offline/local load)
    const cachedRecord = await getCachedPdf(url);
    if (cachedRecord && cachedRecord.buffer) {
      const dataBuffer =
        cachedRecord.buffer instanceof ArrayBuffer
          ? cachedRecord.buffer.slice(0)
          : await cachedRecord.buffer.arrayBuffer?.();
      if (dataBuffer) {
        loadingTask = pdfjsLib.getDocument({
          data: dataBuffer,
          ...fontOpts,
        });
        source = "cache";
      }
    }
  } catch (err) {
    console.warn("Failed to load from IndexedDB cache, falling back to network:", err);
  }

  // 3. Cloud Firestore PDF (uploaded directly without external URL)
  if (!loadingTask && String(url).startsWith("firestore://book_files/")) {
    const cloudBuffer = await fetchFirestorePdfBuffer(url);
    loadingTask = pdfjsLib.getDocument({
      data: cloudBuffer,
      ...fontOpts,
    });
    source = "cloud-firestore";
  }

  // 4. Network Load with Progressive Streaming & Range Requests
  if (!loadingTask) {
    loadingTask = pdfjsLib.getDocument({
      url: url,
      ...fontOpts,
      disableAutoFetch: false,
      disableStream: false,
      disableRange: false,
      rangeChunkSize: 65536 * 4, // 256KB chunks for fast initial page render
    });
  }

  try {
    const pdfDocument = await loadingTask.promise;

    // Auto-save to IndexedDB in background if loaded from network/Firestore so it works offline automatically
    if (source !== "cache") {
      persistDocumentOfflineInBackground(pdfDocument, url, _metadata);
    }

    // Store in Memory Cache (LRU eviction)
    if (activeDocuments.size >= MAX_ACTIVE_DOCS) {
      const oldestKey = activeDocuments.keys().next().value;
      const oldestDoc = activeDocuments.get(oldestKey);
      activeDocuments.delete(oldestKey);
      try {
        oldestDoc.destroy();
      } catch {}
    }
    activeDocuments.set(url, pdfDocument);

    return pdfDocument;
  } catch (error) {
    // Fallback for Android APK/AAB WebViews where Range headers or CORS may block direct streaming
    if (source === "remote" && /^https?:\/\//i.test(url)) {
      try {
        const fallbackTask = pdfjsLib.getDocument({
          url: url,
          ...fontOpts,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true,
        });
        const pdfDocument = await fallbackTask.promise;
        persistDocumentOfflineInBackground(pdfDocument, url, _metadata);
        activeDocuments.set(url, pdfDocument);
        return pdfDocument;
      } catch {
        try {
          const proxiedUrl = apiUrl(`/api/proxy-image?url=${encodeURIComponent(url)}`);
          const proxyTask = pdfjsLib.getDocument({
            url: proxiedUrl,
            ...fontOpts,
            disableAutoFetch: true,
            disableStream: true,
            disableRange: true,
          });
          const pdfDocument = await proxyTask.promise;
          persistDocumentOfflineInBackground(pdfDocument, url, _metadata);
          activeDocuments.set(url, pdfDocument);
          return pdfDocument;
        } catch {
          // Proceed to error handler below
        }
      }
    }
    console.error("PDF Load Error:", error);
    throw new Error(getArabicPdfErrorMessage(error));
  }
}

export async function extractPageText(pdf, pageNum) {
  if (!pdf || !pageNum) return "";
  const docId = pdf?.fingerprints?.[0] || "doc";
  const cacheKey = `${docId}_p${pageNum}`;
  if (pageTextCache.has(cacheKey)) {
    return pageTextCache.get(cacheKey);
  }
  try {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = (content?.items || [])
      .map((item) => item?.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageTextCache.size > 500) {
      const firstKey = pageTextCache.keys().next().value;
      pageTextCache.delete(firstKey);
    }
    pageTextCache.set(cacheKey, text);
    return text;
  } catch {
    return "";
  }
}

export function clearPageCache() {
  pageTextCache.clear();
}

export function prefetchPdf(_url) {
  // Lightweight no-op to avoid background worker contention before reader opens
}

export function releasePdfDocument(url) {
  if (!url) return;
  const doc = activeDocuments.get(url);
  if (doc) {
    activeDocuments.delete(url);
    try {
      doc.destroy();
    } catch {}
  }
}

function getArabicPdfErrorMessage(error) {
  if (!error) return "حدث خطأ غير معروف أثناء تحميل الكتاب.";

  const msg = (error.message || "").toLowerCase();
  const name = (error.name || "").toLowerCase();

  if (name === "invalidpdferror" || msg.includes("invalid pdf")) {
    return "ملف الكتاب تالف أو ليس بصيغة PDF صالحة.";
  }
  if (name === "missingpdferror" || msg.includes("missing pdf") || msg.includes("404")) {
    return "لم يتم العثور على ملف الكتاب في الخادم (404).";
  }
  if (name === "unexpectedresponseexception" || msg.includes("network") || msg.includes("failed to fetch") || msg.includes("cors")) {
    return "تعذر الاتصال بالخادم لتحميل الكتاب. يرجى التحقق من اتصال الإنترنت أو صلاحيات الرابط.";
  }
  if (name === "passwordexception" || msg.includes("password")) {
    return "هذا الكتاب محمي بكلمة مرور ولا يمكن فتحه.";
  }

  return "تعذر فتح الكتاب. قد يكون الرابط غير مدعوم أو هناك مشكلة في الشبكة.";
}