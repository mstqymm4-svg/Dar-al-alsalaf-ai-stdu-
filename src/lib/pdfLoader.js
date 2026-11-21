import * as pdfjsLib from "pdfjs-dist";
import { apiUrl } from "@/lib/apiBase";
import { fetchFirestorePdfBuffer, repairTruncatedPdfBuffer } from "@/api/base44Client";
import { findCachedPdfForBook, cachePdf, isLikelyPdfBuffer } from "./offlineDB";
import { getAccountEmail, addDownloadedBookId } from "./activeUser";
import { generateWaswasaPdfArrayBuffer } from "./intelligentReader/sampleUrduBook";

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

export async function loadPdfDocument(rawUrl, _metadata = {}) {
  const url = String(rawUrl || "").trim();

  // 1. Check Memory Cache first (Instant 0ms load if recently opened)
  if (url && activeDocuments.has(url)) {
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
  let loadedRawBuffer = null;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const fontOpts = online
    ? {
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
        cMapPacked: true,
        standardFontDataUrl:
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
      }
    : {};

  // 1.2 Support built-in daraltawhid:// protocol books directly
  if (url.startsWith("daraltawhid://")) {
    const genBuf = await generateWaswasaPdfArrayBuffer();
    loadedRawBuffer = genBuf.slice(0);
    loadingTask = pdfjsLib.getDocument({
      data: genBuf,
      ...fontOpts,
    });
    source = "cache";
  }

  // 1.5 Support base64 data:application/pdf URLs directly
  if (!loadingTask && url.startsWith("data:application/pdf")) {
    const commaIdx = url.indexOf(",");
    const b64 = commaIdx >= 0 ? url.slice(commaIdx + 1) : "";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const repaired = await repairTruncatedPdfBuffer(bytes.buffer);
    loadedRawBuffer = repaired.slice(0);
    loadingTask = pdfjsLib.getDocument({
      data: repaired,
      ...fontOpts,
    });
    source = "cache";
  }

  try {
    // 2. Check IndexedDB Cache (by exact URL, bookId, or normalized title)
    if (!loadingTask) {
      const cachedRecord = await findCachedPdfForBook({
        url,
        bookId: _metadata?.bookId,
        title: _metadata?.title,
      });
      if (cachedRecord && cachedRecord.buffer) {
        let dataBuffer =
          cachedRecord.buffer instanceof ArrayBuffer
            ? cachedRecord.buffer.slice(0)
            : await cachedRecord.buffer.arrayBuffer?.();
        if (dataBuffer && dataBuffer.byteLength > 0 && isLikelyPdfBuffer(dataBuffer)) {
          dataBuffer = await repairTruncatedPdfBuffer(dataBuffer);
          loadedRawBuffer = dataBuffer.slice(0);
          loadingTask = pdfjsLib.getDocument({
            data: dataBuffer,
            ...fontOpts,
          });
          source = "cache";
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load from IndexedDB cache, falling back to network:", err);
  }

  if (!loadingTask && !url) {
    throw new Error("لا يتوفر رابط ملف PDF لهذا الكتاب.");
  }

  // 3. Cloud Firestore PDF (uploaded directly without external URL)
  if (!loadingTask && url.startsWith("firestore://book_files/")) {
    const cloudBuffer = await fetchFirestorePdfBuffer(url, undefined, _metadata);
    loadedRawBuffer = cloudBuffer.slice(0);
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
    // If a cached or Firestore PDF buffer had a corrupted trailer or linearized header, force-repair it and retry!
    if (loadedRawBuffer && loadedRawBuffer.byteLength > 0) {
      try {
        const forceRepaired = await repairTruncatedPdfBuffer(loadedRawBuffer, { force: true });
        const retryTask = pdfjsLib.getDocument({
          data: forceRepaired.slice(0),
          ...fontOpts,
        });
        const pdfDocument = await retryTask.promise;
        if (url) {
          cachePdf(url, forceRepaired, _metadata?.bookId || url, _metadata?.title || "book.pdf").catch(() => {});
          activeDocuments.set(url, pdfDocument);
        }
        return pdfDocument;
      } catch {
        // Proceed to next fallback
      }
    }

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
    console.warn("PDF Load Warning:", error?.message || error);
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

/**
 * Extracts ONLY the real, authentic embedded outline (Table of Contents) from a PDF.js document.
 * If the PDF does not contain an embedded outline, returns an empty array [] (never fabricates fake chapters).
 */
export async function extractRealPdfOutline(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc.getOutline !== "function") return [];
  try {
    const rawOutline = await pdfDoc.getOutline();
    if (!Array.isArray(rawOutline) || rawOutline.length === 0) return [];

    const walk = async (items) => {
      const result = [];
      for (const it of items) {
        if (!it) continue;
        const cleanTitle = String(it.title || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleanTitle) continue;

        let pageNumber = null;
        try {
          if (it.dest) {
            let dest = it.dest;
            if (typeof dest === "string") {
              dest = await pdfDoc.getDestination(dest);
            }
            if (Array.isArray(dest) && dest[0] != null) {
              if (typeof dest[0] === "number") {
                pageNumber = dest[0] + 1;
              } else {
                const idx = await pdfDoc.getPageIndex(dest[0]);
                if (typeof idx === "number" && idx >= 0) {
                  pageNumber = idx + 1;
                }
              }
            }
          }
        } catch {}

        const children =
          Array.isArray(it.items) && it.items.length > 0
            ? await walk(it.items)
            : [];

        if (!pageNumber && children.length > 0 && children[0]?.pageNumber) {
          pageNumber = children[0].pageNumber;
        }

        if (pageNumber || children.length > 0) {
          result.push({
            title: cleanTitle,
            pageNumber: pageNumber || null,
            items: children,
          });
        }
      }
      return result;
    };

    const normalized = await walk(rawOutline);
    return Array.isArray(normalized) ? normalized : [];
  } catch {
    return [];
  }
}

/**
 * Inspects a local PDF File or ArrayBuffer when adding/uploading a book
 * to extract its real page count (numPages) and authentic original outline (toc).
 * Returns { numPages: number, outline: Array } — outline is [] if no real TOC is embedded.
 */
export async function inspectPdfFileForBook(fileOrBuffer) {
  if (!fileOrBuffer) return { numPages: 0, outline: [] };
  let tempDoc = null;
  let timer = null;
  try {
    const inspectPromise = (async () => {
      const arrayBuffer =
        fileOrBuffer instanceof ArrayBuffer
          ? fileOrBuffer.slice(0)
          : typeof fileOrBuffer.arrayBuffer === "function"
          ? await fileOrBuffer.arrayBuffer()
          : null;
      if (!arrayBuffer) return { numPages: 0, outline: [] };

      const task = pdfjsLib.getDocument({
        data: arrayBuffer,
        disableAutoFetch: true,
        disableStream: true,
      });
      tempDoc = await task.promise;
      const numPages = Number(tempDoc?.numPages || 0);
      const outline = await extractRealPdfOutline(tempDoc);
      return {
        numPages,
        outline: Array.isArray(outline) ? outline : [],
      };
    })();

    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ numPages: 0, outline: [] }), 4000);
    });

    return await Promise.race([inspectPromise, timeoutPromise]);
  } catch {
    return { numPages: 0, outline: [] };
  } finally {
    if (timer) clearTimeout(timer);
    if (tempDoc) {
      try {
        tempDoc.destroy();
      } catch {}
    }
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