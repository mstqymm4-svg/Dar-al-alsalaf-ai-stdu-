/**
 * DAR AL TAWHID — Intelligent Multilingual & Nastaliq Text Processor
 * (الأقسام: 4، 6، 7، 8، 9، 10)
 *
 * Modules:
 * 1. PDF Native Text & Bounding-Box Coordinate Extractor
 * 2. OCR Quality & Nastaliq Anomaly Detector + Gemini 4 Hydrogen Vision OCR Client
 * 3. Urdu Text Processor (Unicode Normalization, Nastaliq Joiner Cleanup, Prosody Layer)
 * 4. Multilingual Islamic Segment Classifier (Urdu, Quran, Hadith, Dua, Arabic Quote, Heading, Footnote)
 * 5. Authentic Quranic Verse Verifier (Never uses TTS for verified Quranic verses)
 */

import {
  getCachedPageOcr,
  setCachedPageOcr,
  getCachedQuranVerification,
  setCachedQuranVerification,
} from "./cacheManager";

// ─── Urdu vs Arabic Script Character Sets ─────────────────────────────────────
// Urdu-specific characters not used in standard Arabic: ٹ ڈ ڑ ں ے ہ ھ پ چ ژ گ ک ی
const URDU_SPECIFIC_REGEX = /[ٹڈڑںےہھپچژگکی]/g;
// Urdu common grammatical particles & auxiliaries
const URDU_PARTICLES_REGEX =
  /(?:^|\s)(?:کے|کی|کا|میں|ہے|ہیں|تھا|تھے|تھی|اور|پر|سے|کو|نے|بھی|تو|یہ|وہ|اس|ان|جب|اگر|کیونکہ|لیکن|تاکہ|ہوتا|ہوتی|کرتے|رہا|جائے|والے|وسوسہ|وسوسے)(?=\s|$|[۔،؟!])/g;

// Quranic delimiters & markers
const QURAN_BRACKET_REGEX = /﴿([^﴾]{6,})﴾/g;
const QURAN_INTRO_REGEX =
  /(?:قال الله تعالى|قوله تعالى|قوله عز وجل|كما قال تعالى|ارشاد باری تعالیٰ ہے|قرآن مجید میں ہے|فرمانِ الٰہی ہے)/i;

// Hadith markers (Arabic & Urdu)
const HADITH_MARKER_REGEX =
  /(?:قال رسول الله|قال النبي|صلى الله عليه وسلم|ﷺ|رواه البخاري|رواه مسلم|متفق عليه|حدثنا|أخبرنا|عن أبي هريرة|عن ابن عباس|عن عائشة|نبی کریم ﷺ نے فرمایا|رسول اللہ ﷺ کا ارشاد ہے|حدیث شریف میں ہے)/i;

// Dua markers
const DUA_MARKER_REGEX =
  /(?:اللَّهُمَّ|اللهم إني أعوذ بك|أعوذ بالله من الشيطان الرجيم|رب أعوذ بك من همزات الشياطين|سبحانك اللهم)/i;

/**
 * 1. Normalize Urdu Unicode characters without changing author's wording
 *    Preserves originalText untouched; produces cleanedPronunciationText for TTS.
 */
export function normalizeUrduTextForPronunciation(rawText) {
  if (!rawText) return "";
  let s = String(rawText);

  // Strip stray control chars and zero-width artifacts that break TTS word tokens
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "");

  // Normalize Arabic/Persian Kaf & Yeh variants in Urdu context
  // Keep Arabic diacritics if present, but normalize broken ligatures
  s = s
    .replace(/\uFBA6|\uFBA7|\uFBA8|\uFBA9/g, "ہ") // Heh goal presentation forms
    .replace(/\uFBAA|\uFBAB|\uFBAC|\uFBAD/g, "ھ") // Do-chashmi heh presentation forms
    .replace(/\uFBFC|\uFBFD|\uFBFE|\uFBFF/g, "ی") // Farsi Yeh presentation forms
    .replace(/\uFBAE|\uFBAF/g, "ے") // Yeh barree presentation forms
    .replace(/\uFB8E|\uFB8F|\uFB90|\uFB91/g, "ک") // Keheh presentation forms
    .replace(/\uFB92|\uFB93|\uFB94|\uFB95/g, "گ"); // Gaf presentation forms

  // Strip isolated footnote markers like (1), [١], *, † from spoken audio layer
  s = s.replace(/\[\d+\]|\(\d+\)|\[[٠-٩]+\]|\([٠-٩]+\)/g, " ");

  // Fix common Urdu compound spacing so TTS pronounces them smoothly
  s = s
    .replace(/\s+/g, " ")
    .replace(/\s+([۔،؛؟!:])/g, "$1")
    .trim();

  return s;
}

/**
 * 2. Detect language and Islamic text category of a sentence or block
 *    Returns: { language: 'ur' | 'ar', segmentType: 'quran' | 'hadith' | 'dua' | 'arabic_quote' | 'urdu_body' | 'heading' | 'footnote' }
 */
export function classifyTextSegment(text, hintType = "") {
  const clean = String(text || "").trim();
  if (!clean) {
    return { language: "ur", segmentType: "urdu_body" };
  }

  if (hintType === "heading" || hintType === "footnote") {
    const isUrdu = detectIsUrduScript(clean);
    return { language: isUrdu ? "ur" : "ar", segmentType: hintType };
  }

  // Check explicit Quranic brackets ﴿ ... ﴾ or canonical Quran phrases
  if (
    /﴿[^﴾]{6,}﴾/.test(clean) ||
    hintType === "quran" ||
    containsCanonicalQuranPhrase(clean)
  ) {
    return { language: "ar", segmentType: "quran" };
  }

  // Check Hadith markers
  if (hintType === "hadith" || HADITH_MARKER_REGEX.test(clean)) {
    const isUrdu = detectIsUrduScript(clean);
    // If the sentence itself is predominantly Arabic Hadith text, classify as Arabic Hadith
    return {
      language: isUrdu ? "ur" : "ar",
      segmentType: "hadith",
    };
  }

  // Check Dua markers
  if (hintType === "dua" || DUA_MARKER_REGEX.test(clean)) {
    const isUrdu = detectIsUrduScript(clean);
    return {
      language: isUrdu ? "ur" : "ar",
      segmentType: "dua",
    };
  }

  const isUrdu = detectIsUrduScript(clean);
  if (!isUrdu) {
    return {
      language: "ar",
      segmentType: hintType === "arabic_quote" ? "arabic_quote" : "arabic_quote",
    };
  }

  return {
    language: "ur",
    segmentType: "urdu_body",
  };
}

export function detectIsUrduScript(text) {
  const s = String(text || "");
  const urduChars = (s.match(URDU_SPECIFIC_REGEX) || []).length;
  const urduParticles = (s.match(URDU_PARTICLES_REGEX) || []).length;
  const hasUrduFullStop = s.includes("۔");
  if (urduParticles >= 1 || urduChars >= 2 || hasUrduFullStop) {
    return true;
  }
  return false;
}

const CANONICAL_QURAN_SUBSTRINGS = [
  "من شر الوسواس الخناس",
  "الذي يوسوس في صدور الناس",
  "واما ينزغنك من الشيطان نزغ فاستعذ بالله",
  "وقل رب اعوذ بك من همزات الشياطين",
  "واعوذ بك رب ان يحضرون",
  "الا بذكر الله تطمئن القلوب",
  "لا يكلف الله نفسا الا وسعها",
  "ولقد خلقنا الانسان ونعلم ما توسوس به نفسه",
];

function normalizeForQuickArabicMatch(str) {
  return String(str || "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىیے]/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function containsCanonicalQuranPhrase(text) {
  const norm = normalizeForQuickArabicMatch(text);
  return CANONICAL_QURAN_SUBSTRINGS.some((p) => norm.includes(p));
}

/**
 * 3. Split a block into meaningful prosody sentences (القسم 7 — التحكم في التوقف والمعنى)
 *    Does NOT pause awkwardly at every minor comma; groups short clauses so meaning stays intact,
 *    and separates embedded Quranic verses ﴿...﴾ into standalone segments so recorded recitation
 *    plays cleanly before resuming the Urdu/Arabic book voice.
 */
export function segmentBlockIntoSentences(block, blockIndex = 0) {
  const rawText = String(block?.originalText || block?.text || "").trim();
  if (!rawText) return [];

  // First split out any inline Quranic verses enclosed in ﴿ ... ﴾ so they get their own dedicated segment
  const parts = [];
  let lastIdx = 0;
  const qRegex = /﴿([^﴾]{6,})﴾/g;
  let match;
  while ((match = qRegex.exec(rawText)) !== null) {
    if (match.index > lastIdx) {
      const before = rawText.slice(lastIdx, match.index).trim();
      if (before) parts.push({ text: before, forcedType: null });
    }
    parts.push({ text: `﴿${match[1].trim()}﴾`, forcedType: "quran" });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < rawText.length) {
    const tail = rawText.slice(lastIdx).trim();
    if (tail) parts.push({ text: tail, forcedType: null });
  }

  const sentences = [];
  for (const part of parts) {
    if (part.forcedType === "quran") {
      sentences.push({
        originalText: part.text,
        cleanedPronunciationText: normalizeUrduTextForPronunciation(part.text),
        segmentType: "quran",
        language: "ar",
        blockIndex,
        box2d: block.box2d || null,
        wordItems: block.wordItems || [],
      });
      continue;
    }

    // Split on major sentence terminators: Urdu full stop (۔), question mark (؟), exclamation (!), period (.)
    // Avoid splitting on commas (،) unless the clause exceeds 160 characters
    const rawChunks = part.text
      .split(/(?<=[۔؟!\.\n])\s+/)
      .map((c) => c.trim())
      .filter(Boolean);

    let buffer = "";
    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i];
      // Merge very short introductory clauses (e.g., "قال المؤلف:" or "فرمایا:") with the next clause to preserve meaning
      if (
        buffer.length > 0 &&
        buffer.length + chunk.length < 180 &&
        !(/[۔؟!]$/.test(buffer))
      ) {
        buffer = `${buffer} ${chunk}`;
      } else if (chunk.length < 22 && i < rawChunks.length - 1) {
        buffer = buffer ? `${buffer} ${chunk}` : chunk;
        continue;
      } else {
        if (buffer) {
          sentences.push(buildSentenceObject(buffer, block, blockIndex));
        }
        buffer = chunk;
      }
    }
    if (buffer) {
      sentences.push(buildSentenceObject(buffer, block, blockIndex));
    }
  }

  return sentences;
}

function buildSentenceObject(text, block, blockIndex) {
  const classification = classifyTextSegment(text, block?.blockType);
  const cleaned = normalizeUrduTextForPronunciation(text);
  const words = cleaned.split(/\s+/).filter(Boolean);

  return {
    originalText: text,
    cleanedPronunciationText: cleaned,
    language: block?.language || classification.language,
    segmentType:
      block?.blockType === "quran" ? "quran" : classification.segmentType,
    surahNumber: block?.surahNumber || 0,
    ayahNumber: block?.ayahNumber || 0,
    blockIndex,
    box2d: block?.box2d || null,
    words: words.map((w, idx) => ({
      word: w,
      wordIndex: idx,
      rect: null, // populated if PDF text layer has exact coordinates
    })),
  };
}

/**
 * 4. Extract native PDF text layer + coordinates and evaluate OCR quality (القسم 4)
 */
export async function extractAndProcessPdfPage({
  pdfDoc,
  pageNumber,
  bookId,
  autoOcrEnabled = true,
  forceOcr = false,
  reciterId = "ar.alafasy",
  bookMetadata = null,
}) {
  // Check cache first (only return cached data if not forcing fresh OCR and cached page has valid sentences)
  if (!forceOcr) {
    const cached = await getCachedPageOcr(bookId, pageNumber);
    if (cached?.data && cached.data.sentences?.length > 0) {
      return cached.data;
    }
  }

  // Check if book has embedded structured pages
  if (
    !forceOcr &&
    bookMetadata?.structured_pages &&
    Array.isArray(bookMetadata.structured_pages)
  ) {
    const structuredPage = bookMetadata.structured_pages.find(
      (p) => Number(p.pageNumber) === Number(pageNumber)
    );
    if (structuredPage && Array.isArray(structuredPage.blocks)) {
      const processed = await finalizeStructuredBlocks({
        blocks: structuredPage.blocks,
        pageNumber,
        bookId,
        extractionSource: "native-structured-layer",
        qualityScore: 99,
        hasOcrWarnings: false,
        ocrWarningMessage: "",
        detectedAnomalies: [],
        reciterId,
      });
      if (processed.sentences.length > 0) {
        await setCachedPageOcr(bookId, pageNumber, processed);
      }
      return processed;
    }
  }

  let nativeItems = [];
  let pageViewport = null;
  let pdfPage = null;

  if (pdfDoc) {
    try {
      pdfPage = await pdfDoc.getPage(pageNumber);
      pageViewport = pdfPage.getViewport({ scale: 1.0 });
      const textContent = await pdfPage.getTextContent();
      nativeItems = textContent?.items || [];
    } catch {
      nativeItems = [];
    }
  }

  // Analyze native PDF text layer quality & anomalies
  const analysis = analyzeNativePdfTextLayer(nativeItems, pageViewport);

  // Build blocks from native PDF text items with exact bounding-box coordinates
  const blocksFromNative = buildBlocksFromNativeItems(
    analysis.orderedLines,
    pageViewport
  );

  // CRITICAL RULE: Never consider a page empty before trying OCR!
  // Run OCR whenever:
  // 1) forceOcr is explicitly requested, OR
  // 2) Native PDF text layer yielded 0 blocks / < 20 chars (scanned image PDF), OR
  // 3) autoOcrEnabled is true and native layer has Nastaliq/glyph corruption (needsOcr or qualityScore < 65)
  const isNativeEmpty =
    blocksFromNative.length === 0 || analysis.rawText.trim().length < 20;
  const shouldRunOcr =
    pdfPage &&
    (forceOcr ||
      isNativeEmpty ||
      (autoOcrEnabled && (analysis.needsOcr || analysis.qualityScore < 65)));

  if (shouldRunOcr) {
    try {
      const ocrResult = await runGeminiVisionOcrOnPdfPage(
        pdfPage,
        pageNumber,
        analysis.rawText
      );
      if (
        ocrResult &&
        Array.isArray(ocrResult.blocks) &&
        ocrResult.blocks.length > 0
      ) {
        const processed = await finalizeStructuredBlocks({
          blocks: ocrResult.blocks,
          pageNumber,
          bookId,
          extractionSource: ocrResult.engine || "gemini-4-hydrogen-ocr",
          qualityScore: ocrResult.qualityScore ?? 92,
          hasOcrWarnings: Boolean(ocrResult.hasOcrWarnings),
          ocrWarningMessage: ocrResult.ocrWarningMessage || "",
          detectedAnomalies: ocrResult.detectedAnomalies || analysis.anomalies,
          rawPdfLayerText: analysis.rawText,
          reciterId,
        });
        if (processed.sentences.length > 0) {
          await setCachedPageOcr(bookId, pageNumber, processed);
        }
        return processed;
      }
    } catch (ocrErr) {
      console.warn("[DAR AL TAWHID OCR Error on page " + pageNumber + "]:", ocrErr);
    }
  }

  const processed = await finalizeStructuredBlocks({
    blocks: blocksFromNative,
    pageNumber,
    bookId,
    extractionSource: "pdf-text-layer",
    qualityScore: analysis.qualityScore,
    hasOcrWarnings: analysis.qualityScore < 70,
    ocrWarningMessage:
      analysis.qualityScore < 70
        ? "تنبيه: طبقة النص في هذه الصفحة قد تحتوي على تقطيع أو تحتاج إلى استخراج ذكي (OCR)."
        : "",
    detectedAnomalies: analysis.anomalies,
    rawPdfLayerText: analysis.rawText,
    reciterId,
  });

  if (processed.sentences.length > 0) {
    await setCachedPageOcr(bookId, pageNumber, processed);
  }
  return processed;
}

/**
 * 5. Analyze native PDF text layer for Nastaliq / RTL / OCR anomalies (القسم 4)
 */
function analyzeNativePdfTextLayer(items, viewport) {
  if (!items || items.length === 0) {
    return {
      needsOcr: true,
      qualityScore: 0,
      rawText: "",
      orderedLines: [],
      anomalies: ["صفحة مصورة بدون طبقة نصية — يتطلب تشغيل محرك OCR المتخصص"],
    };
  }

  const pageWidth = viewport?.width || 600;
  const pageHeight = viewport?.height || 850;

  // Group items into horizontal lines by Y coordinate (PDF Y goes bottom-to-top)
  const lineBuckets = [];
  for (const item of items) {
    const str = String(item.str || "");
    if (!str.trim()) continue;
    const tx = item.transform ? item.transform[4] : 0;
    const ty = item.transform ? item.transform[5] : 0;
    const w = item.width || str.length * 6;
    const h = item.height || Math.abs(item.transform?.[3] || 14);

    // Normalized top-down Y (0..1000) and left-right X (0..1000)
    const normY = Math.round(((pageHeight - ty - h) / pageHeight) * 1000);
    const normX = Math.round((tx / pageWidth) * 1000);
    const normW = Math.round((w / pageWidth) * 1000);
    const normH = Math.max(14, Math.round((h / pageHeight) * 1000));

    let bucket = lineBuckets.find((b) => Math.abs(b.normY - normY) <= 14);
    if (!bucket) {
      bucket = { normY, items: [] };
      lineBuckets.push(bucket);
    }
    bucket.items.push({
      str,
      normX: Math.max(0, Math.min(1000, normX)),
      normY: Math.max(0, Math.min(1000, normY)),
      normW: Math.max(10, Math.min(1000, normW)),
      normH,
    });
  }

  // Sort lines top to bottom
  lineBuckets.sort((a, b) => a.normY - b.normY);

  const orderedLines = [];
  const anomalies = [];
  let singleCharTokenCount = 0;
  let totalTokenCount = 0;
  let puaGlyphCount = 0;

  for (let idx = 0; idx < lineBuckets.length; idx++) {
    const b = lineBuckets[idx];
    // For RTL scripts (Urdu/Arabic), items on a line should be ordered right-to-left (descending X)
    // unless a single string already contains the whole RTL line
    const hasRtl = b.items.some((it) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(it.str));
    if (hasRtl && b.items.length > 1) {
      b.items.sort((x, y) => y.normX - x.normX);
    } else {
      b.items.sort((x, y) => x.normX - y.normX);
    }

    const lineText = b.items.map((it) => it.str.trim()).join(" ").replace(/\s+/g, " ").trim();
    if (!lineText) continue;

    // Skip isolated page number at very top or very bottom of page
    const isIsolatedPageNum =
      (idx === 0 || idx === lineBuckets.length - 1) &&
      /^[-–—\s]*[\d٠-٩۰-۹]{1,4}[-–—\s]*$/.test(lineText);
    if (isIsolatedPageNum) {
      anomalies.push("تم استبعاد رقم الصفحة من نص القراءة الصوتية");
      continue;
    }

    const tokens = lineText.split(/\s+/);
    totalTokenCount += tokens.length;
    for (const tk of tokens) {
      if (tk.length === 1 && /[\u0600-\u06FF]/.test(tk) && tk !== "و") {
        singleCharTokenCount++;
      }
      if (/[\uE000-\uF8FF\uFFFD]/.test(tk)) {
        puaGlyphCount++;
      }
    }

    const minX = Math.min(...b.items.map((i) => i.normX));
    const maxX = Math.max(...b.items.map((i) => i.normX + i.normW));
    const minY = Math.min(...b.items.map((i) => i.normY));
    const maxY = Math.max(...b.items.map((i) => i.normY + i.normH));

    orderedLines.push({
      text: lineText,
      items: b.items,
      box2d: [minY, minX, maxY, maxX],
      isFootnoteArea: minY > 830,
    });
  }

  const rawText = orderedLines.map((l) => l.text).join("\n");
  if (rawText.trim().length < 20) {
    return {
      needsOcr: true,
      qualityScore: 15,
      rawText,
      orderedLines,
      anomalies: ["نص الصفحة قصير جداً أو مصور — يتطلب تشغيل OCR"],
    };
  }

  let qualityScore = 95;
  if (puaGlyphCount > 0) {
    qualityScore -= Math.min(50, puaGlyphCount * 8);
    anomalies.push("تم اكتشاف رموز خطوط غير قياسية (Private Use Glyphs) في طبقة PDF");
  }
  if (totalTokenCount > 5 && singleCharTokenCount / totalTokenCount > 0.32) {
    qualityScore -= 40;
    anomalies.push("تم اكتشاف تقطيع في حروف نستعليق (تقسيم الكلمة الواحدة إلى حروف منفصلة)");
  }

  return {
    needsOcr: qualityScore < 65,
    qualityScore: Math.max(10, qualityScore),
    rawText,
    orderedLines,
    anomalies,
  };
}

function buildBlocksFromNativeItems(orderedLines) {
  if (!orderedLines || orderedLines.length === 0) return [];
  const blocks = [];
  let currentLines = [];

  const flushBlock = () => {
    if (currentLines.length === 0) return;
    const combinedText = currentLines.map((l) => l.text).join(" ");
    const minY = Math.min(...currentLines.map((l) => l.box2d[0]));
    const minX = Math.min(...currentLines.map((l) => l.box2d[1]));
    const maxY = Math.max(...currentLines.map((l) => l.box2d[2]));
    const maxX = Math.max(...currentLines.map((l) => l.box2d[3]));
    const isFootnote = currentLines.every((l) => l.isFootnoteArea);
    const isHeading =
      currentLines.length === 1 &&
      combinedText.length < 75 &&
      !/[۔.؟!]$/.test(combinedText);

    const cls = classifyTextSegment(
      combinedText,
      isFootnote ? "footnote" : isHeading ? "heading" : ""
    );

    blocks.push({
      blockType: cls.segmentType,
      language: cls.language,
      originalText: combinedText,
      cleanedPronunciationText: normalizeUrduTextForPronunciation(combinedText),
      box2d: [minY, minX, maxY, maxX],
      lineItems: currentLines.flatMap((l) => l.items || []),
    });
    currentLines = [];
  };

  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    const prev = currentLines[currentLines.length - 1];
    const verticalGap = prev ? line.box2d[0] - prev.box2d[2] : 0;

    if (
      prev &&
      (verticalGap > 24 ||
        line.isFootnoteArea !== prev.isFootnoteArea ||
        /[۔؟!]$/.test(prev.text))
    ) {
      flushBlock();
    }
    currentLines.push(line);
  }
  flushBlock();
  return blocks;
}

/**
 * 6. Render PDF page to offscreen Canvas and invoke server-side Gemini 4 Hydrogen OCR
 */
export async function runGeminiVisionOcrOnPdfPage(pdfPage, pageNumber, rawPdfTextHint = "") {
  if (typeof document === "undefined" || !pdfPage) return null;
  const viewport = pdfPage.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  // Fill opaque white background first so transparent PDF pages render with crisp dark text
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const imageBase64 = canvas.toDataURL("image/jpeg", 0.86);

  const res = await fetch("/api/reader/ocr-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64,
      mimeType: "image/jpeg",
      pageNumber,
      rawPdfTextHint,
    }),
  });
  if (!res.ok) {
    throw new Error(`OCR HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * 7. Finalize blocks into sentences and verify any detected Quranic verses against authentic recordings
 */
async function finalizeStructuredBlocks({
  blocks,
  pageNumber,
  bookId = "",
  extractionSource,
  qualityScore,
  hasOcrWarnings,
  ocrWarningMessage,
  detectedAnomalies = [],
  rawPdfLayerText = "",
  reciterId = "ar.alafasy",
}) {
  const allSentences = [];
  let sentenceCounter = 0;
  let totalWordsCount = 0;

  for (let bIdx = 0; bIdx < (blocks || []).length; bIdx++) {
    const block = blocks[bIdx];
    const blockSentences = segmentBlockIntoSentences(block, bIdx);

    for (const sent of blockSentences) {
      let quranMeta = null;
      if (sent.segmentType === "quran") {
        quranMeta = await verifyQuranVerseClient(
          sent.originalText,
          sent.surahNumber,
          sent.ayahNumber,
          reciterId
        );
        // Rule from Section 8: If not 100% verified, never guess a recording!
        if (!quranMeta?.verified) {
          sent.segmentType = "arabic_quote";
          sent.quranUnverifiedNotice = true;
        }
      }

      // Compute approximate word bounding boxes from block box2d or native lineItems
      const wordsWithCoords = assignWordCoordinates(
        sent.words,
        sent.box2d || block.box2d,
        block.lineItems
      );
      totalWordsCount += wordsWithCoords.length;

      allSentences.push({
        ...sent,
        sentenceIndex: sentenceCounter++,
        bookId,
        pageNumber,
        paragraphIndex: bIdx,
        words: wordsWithCoords,
        quranMeta,
      });
    }
  }

  return {
    bookId,
    pageNumber,
    extractionSource,
    qualityScore,
    hasOcrWarnings,
    ocrWarningMessage,
    detectedAnomalies,
    totalSentencesOnPage: allSentences.length,
    totalWordsOnPage: totalWordsCount,
    rawPdfLayerText:
      rawPdfLayerText ||
      (blocks || []).map((b) => b.originalText).join("\n\n"),
    blocks: blocks || [],
    sentences: allSentences,
  };
}

function assignWordCoordinates(words, box2d, lineItems) {
  if (!words || words.length === 0) return [];
  if (!Array.isArray(box2d) || box2d.length < 4) {
    // No page coordinates available — return words with rect: null so UI falls back to sentence highlight
    return words.map((w, idx) => ({ ...w, wordIndex: idx, rect: null }));
  }

  const [ymin, xmin, ymax, xmax] = box2d;
  const boxWidth = Math.max(40, xmax - xmin);
  const boxHeight = Math.max(18, ymax - ymin);

  // Estimate number of lines inside this paragraph box
  const approxLines = Math.max(1, Math.min(8, Math.round(boxHeight / 28)));
  const wordsPerLine = Math.ceil(words.length / approxLines);
  const lineHeight = boxHeight / approxLines;

  return words.map((w, idx) => {
    const lineIdx = Math.min(approxLines - 1, Math.floor(idx / wordsPerLine));
    const indexInLine = idx % wordsPerLine;
    const countInThisLine = Math.min(
      wordsPerLine,
      words.length - lineIdx * wordsPerLine
    );

    // RTL layout: word 0 starts at right edge (xmax) and progresses left toward xmin
    const slotWidth = boxWidth / Math.max(1, countInThisLine);
    const wordRight = xmax - indexInLine * slotWidth;
    const wordLeft = Math.max(xmin, wordRight - slotWidth * 0.92);
    const wordTop = ymin + lineIdx * lineHeight;
    const wordBottom = wordTop + lineHeight * 0.88;

    return {
      ...w,
      wordIndex: idx,
      rect: {
        topPct: Math.max(0, Math.min(98, wordTop / 10)),
        leftPct: Math.max(0, Math.min(98, wordLeft / 10)),
        widthPct: Math.max(2, Math.min(95, (wordRight - wordLeft) / 10)),
        heightPct: Math.max(1.6, Math.min(25, (wordBottom - wordTop) / 10)),
      },
    };
  });
}

export async function verifyQuranVerseClient(
  text,
  surahHint = 0,
  ayahHint = 0,
  reciterId = "ar.alafasy"
) {
  const cached = await getCachedQuranVerification(text, reciterId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/reader/verify-quran", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        surahHint,
        ayahHint,
        reciter: reciterId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await setCachedQuranVerification(text, reciterId, data);
      return data;
    }
  } catch {}
  return { verified: false };
}
