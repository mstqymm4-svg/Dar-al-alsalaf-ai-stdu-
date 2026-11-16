import * as pdfjsLib from "pdfjs-dist";
import { apiUrl } from "@/lib/apiBase";
import { getCachedPdf } from "./offlineDB";

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
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
        });
        source = "cache";
      }
    }
  } catch (err) {
    console.warn("Failed to load from IndexedDB cache, falling back to network:", err);
  }

  // 3. Network Load with Progressive Streaming & Range Requests
  if (!loadingTask) {
    loadingTask = pdfjsLib.getDocument({
      url: url,
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
      disableAutoFetch: false,
      disableStream: false,
      disableRange: false,
      rangeChunkSize: 65536 * 4, // 256KB chunks for fast initial page render
    });
  }

  try {
    const pdfDocument = await loadingTask.promise;

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
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true,
        });
        const pdfDocument = await fallbackTask.promise;
        activeDocuments.set(url, pdfDocument);
        return pdfDocument;
      } catch {
        try {
          const proxiedUrl = apiUrl(`/api/proxy-image?url=${encodeURIComponent(url)}`);
          const proxyTask = pdfjsLib.getDocument({
            url: proxiedUrl,
            cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
            disableAutoFetch: true,
            disableStream: true,
            disableRange: true,
          });
          const pdfDocument = await proxyTask.promise;
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