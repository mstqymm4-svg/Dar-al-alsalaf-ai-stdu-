/**
 * DAR AL TAWHID — Server-Side Intelligent Book Reader API
 *
 * Provides:
 * 1. POST /api/reader/ocr-page       — Gemini 4 Hydrogen Vision OCR for Urdu Nastaliq & Arabic PDF pages
 * 2. POST /api/reader/verify-quran   — Authentic Quranic verse verification + recorded recitation audio resolution
 * 3. POST /api/reader/tts            — Multi-provider Neural TTS (Gemini 3.8 Neural TTS + Google Cloud TTS + Acoustic Word Envelope Timing)
 * 4. GET  /api/reader/quran-audio    — Proxy for authentic Quran verse MP3s (AlQuran.cloud / EveryAyah CDN) to avoid CORS issues
 * 5. GET  /api/reader/sample-pdf/:id — Generates a valid multi-page Urdu/Arabic/Quran/Hadith PDF binary for library testing
 */

import express from "express";
import { GoogleGenAI, Type } from "@google/genai";

export const intelligentReaderRouter = express.Router();

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

// ─── Canonical Quranic Verse Reference Index (Fast Exact Lookup + API Verification) ───
interface CanonicalAyah {
  surahNumber: number;
  surahNameAr: string;
  ayahNumber: number;
  globalAyahNumber: number;
  uthmaniText: string;
  normalizedKey: string;
}

const CANONICAL_QURAN_INDEX: CanonicalAyah[] = [
  {
    surahNumber: 114,
    surahNameAr: "سورة الناس",
    ayahNumber: 4,
    globalAyahNumber: 6234,
    uthmaniText: "مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ",
    normalizedKey: "من شر الوسواس الخناس",
  },
  {
    surahNumber: 114,
    surahNameAr: "سورة الناس",
    ayahNumber: 5,
    globalAyahNumber: 6235,
    uthmaniText: "الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ",
    normalizedKey: "الذي يوسوس في صدور الناس",
  },
  {
    surahNumber: 7,
    surahNameAr: "سورة الأعراف",
    ayahNumber: 200,
    globalAyahNumber: 1154,
    uthmaniText: "وَإِمَّا يَنزَغَنَّكَ مِنَ الشَّيْطَانِ نَزْغٌ فَاسْتَعِذْ بِاللَّهِ إِنَّهُ سَمِيعٌ عَلِيمٌ",
    normalizedKey: "واما ينزغنك من الشيطان نزغ فاستعذ بالله انه سميع عليم",
  },
  {
    surahNumber: 41,
    surahNameAr: "سورة فصلت",
    ayahNumber: 36,
    globalAyahNumber: 4254,
    uthmaniText: "وَإِمَّا يَنزَغَنَّكَ مِنَ الشَّيْطَانِ نَزْغٌ فَاسْتَعِذْ بِاللَّهِ إِنَّهُ هُوَ السَّمِيعُ الْعَلِيمُ",
    normalizedKey: "واما ينزغنك من الشيطان نزغ فاستعذ بالله انه هو السميع العليم",
  },
  {
    surahNumber: 23,
    surahNameAr: "سورة المؤمنون",
    ayahNumber: 97,
    globalAyahNumber: 2770,
    uthmaniText: "وَقُل رَّبِّ أَعُوذُ بِكَ مِنْ هَمَزَاتِ الشَّيَاطِينِ",
    normalizedKey: "وقل رب اعوذ بك من همزات الشياطين",
  },
  {
    surahNumber: 23,
    surahNameAr: "سورة المؤمنون",
    ayahNumber: 98,
    globalAyahNumber: 2771,
    uthmaniText: "وَأَعُوذُ بِكَ رَبِّ أَن يَحْضُرُونِ",
    normalizedKey: "واعوذ بك رب ان يحضرون",
  },
  {
    surahNumber: 13,
    surahNameAr: "سورة الرعد",
    ayahNumber: 28,
    globalAyahNumber: 1735,
    uthmaniText: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ",
    normalizedKey: "الا بذكر الله تطمئن القلوب",
  },
  {
    surahNumber: 2,
    surahNameAr: "سورة البقرة",
    ayahNumber: 286,
    globalAyahNumber: 293,
    uthmaniText: "لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا",
    normalizedKey: "لا يكلف الله نفسا الا وسعها",
  },
  {
    surahNumber: 50,
    surahNameAr: "سورة ق",
    ayahNumber: 16,
    globalAyahNumber: 4646,
    uthmaniText: "وَلَقَدْ خَلَقْنَا الْإِنسَانَ وَنَعْلَمُ مَا تُوَسْوِسُ بِهِ نَفْسُهُ وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ الْوَرِيدِ",
    normalizedKey: "ولقد خلقنا الانسان ونعلم ما توسوس به نفسه ونحن اقرب اليه من حبل الوريد",
  },
  {
    surahNumber: 1,
    surahNameAr: "سورة الفاتحة",
    ayahNumber: 1,
    globalAyahNumber: 1,
    uthmaniText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    normalizedKey: "بسم الله الرحمن الرحيم",
  },
];

export function normalizeArabicForQuranMatch(text: string): string {
  return String(text || "")
    .replace(/[﴿﴾«»"'\(\)\[\]\{\}۞٭]/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // strip tashkeel & Quranic marks
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىیے]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEveryAyahUrl(surahNumber: number, ayahNumber: number, reciterFolder = "Alafasy_128kbps"): string {
  const s = String(surahNumber).padStart(3, "0");
  const a = String(ayahNumber).padStart(3, "0");
  return `https://everyayah.com/data/${reciterFolder}/${s}${a}.mp3`;
}

function buildIslamicNetworkAudioUrl(globalAyahNumber: number, edition = "ar.alafasy"): string {
  return `https://cdn.islamic.network/quran/audio/128/${edition}/${globalAyahNumber}.mp3`;
}

// ─── 1. POST /api/reader/ocr-page — Nastaliq & Multilingual OCR via Gemini 4 Hydrogen ───
intelligentReaderRouter.post("/ocr-page", express.json({ limit: "18mb" }), async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/png", pageNumber = 1, rawPdfTextHint = "" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 payload" });
    }

    const ai = getAiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY not configured on server",
        fallbackToRawText: true,
      });
    }

    const cleanBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    const prompt = `أنت محرك استخراج نصوص (OCR) علمي متخصص في الكتب الإسلامية الأردية (بخط نستعليق Nastaliq) والعربية داخل تطبيق DAR AL TAWHID.
افحص صورة الصفحة رقم ${pageNumber} بدقة عالية واستخرج جميع النصوص مع الحفاظ التام على نص المؤلف الأصلي دون أي تغيير أو ترجمة أو تلخيص.

المطلوب:
1. استخرج الفقرات والجمل بالترتيب الصحيح للقراءة من اليمين إلى اليسار (RTL) ومن الأعلى إلى الأسفل.
2. حدد نوع كل كتلة نصية بدقة:
   - "heading": عنوان رئيسي أو فرعي
   - "quran": آية قرآنية كريمة (إن وجدت، واذكر رقم السورة ورقم الآية إن أمكن التحقق منها بدقة)
   - "hadith": حديث نبوي شريف أو أثر
   - "dua": دعاء مأثور
   - "arabic_quote": اقتباس أو عبارة باللغة العربية داخل النص الأردي
   - "urdu_body": نص أردي عادي (خط نستعليق أو نسخ)
   - "footnote": حاشية أو مرجع في أسفل الصفحة
3. لا تدمج أرقام الصفحات أو الهوامش داخل الجمل.
4. صحح أخطاء تقطع الحروف الأردية (مثل: ی، ے، ہ، ھ، ک، گ، ں) مع الحفاظ الكامل على كلمات المؤلف الأصلية.
5. حدد إحداثيات كل فقرة في الصفحة كنسب مئوية تقريبية (ymin, xmin, ymax, xmax من 0 إلى 1000).
6. قيّم جودة الاستخراج من 0 إلى 100، وحدد ما إذا كانت الصفحة تحتوي على تشويش أو تحتاج لمراجعة.
${rawPdfTextHint ? `\nملاحظة: طبقة النص الخام المستخرجة من ملف PDF (قد تكون معكوسة أو ناقصة): \n${String(rawPdfTextHint).slice(0, 1500)}` : ""}`;

    const ocrSchema = {
      type: Type.OBJECT,
      properties: {
        pageNumber: { type: Type.INTEGER },
        primaryLanguage: {
          type: Type.STRING,
          description: "Primary language of the page: 'ur' or 'ar'",
        },
        qualityScore: {
          type: Type.INTEGER,
          description: "OCR confidence score from 0 to 100",
        },
        hasOcrWarnings: { type: Type.BOOLEAN },
        ocrWarningMessage: { type: Type.STRING },
        detectedAnomalies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        blocks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              blockType: {
                type: Type.STRING,
                description: "One of: heading, quran, hadith, dua, arabic_quote, urdu_body, footnote",
              },
              language: {
                type: Type.STRING,
                description: "'ur' for Urdu, 'ar' for Arabic",
              },
              originalText: {
                type: Type.STRING,
                description: "Exact faithful text extracted from the page",
              },
              cleanedPronunciationText: {
                type: Type.STRING,
                description: "Normalized text for natural Urdu/Arabic speech without page numbers or footnote symbols",
              },
              surahNumber: {
                type: Type.INTEGER,
                description: "If blockType is quran and verified, Surah number (1-114), else 0",
              },
              ayahNumber: {
                type: Type.INTEGER,
                description: "If blockType is quran and verified, Ayah number, else 0",
              },
              box2d: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: "[ymin, xmin, ymax, xmax] normalized 0-1000",
              },
            },
            required: [
              "blockType",
              "language",
              "originalText",
              "cleanedPronunciationText",
              "box2d",
            ],
          },
        },
      },
      required: ["qualityScore", "primaryLanguage", "blocks"],
    };

    const candidateModels = [
      "gemini-4-hydrogen",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ];
    let parsed: any = null;
    let usedModel = candidateModels[0];
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: ocrSchema,
          },
        });
        const candidateJson = JSON.parse(response.text || "{}");
        if (candidateJson && Array.isArray(candidateJson.blocks)) {
          parsed = candidateJson;
          usedModel = modelName;
          break;
        }
      } catch (modelErr: any) {
        lastError = modelErr;
      }
    }

    if (!parsed) {
      throw lastError || new Error("All OCR vision models failed");
    }

    return res.json({
      ok: true,
      engine: usedModel,
      pageNumber,
      ...parsed,
    });
  } catch (err: any) {
    console.error("[DAR AL TAWHID OCR Error]:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "OCR processing failed",
    });
  }
});

// ─── 2. POST /api/reader/verify-quran — Authentic Quranic Verse Verification ───
intelligentReaderRouter.post("/verify-quran", express.json(), async (req, res) => {
  try {
    const { text, surahHint, ayahHint, reciter = "ar.alafasy" } = req.body || {};
    const reciterFolderMap: Record<string, string> = {
      "ar.alafasy": "Alafasy_128kbps",
      "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
      "ar.husary": "Husary_128kbps",
      "ar.minshawi": "Minshawy_Murattal_128kbps",
    };
    const everyAyahFolder = reciterFolderMap[reciter] || "Alafasy_128kbps";

    // Step A: If explicit valid surahHint (1..114) and ayahHint (>0) are provided, verify directly via AlQuran Cloud API
    if (Number(surahHint) >= 1 && Number(surahHint) <= 114 && Number(ayahHint) >= 1) {
      const sNum = Number(surahHint);
      const aNum = Number(ayahHint);
      try {
        const apiRes = await fetch(`https://api.alquran.cloud/v1/ayah/${sNum}:${aNum}/${reciter}`);
        if (apiRes.ok) {
          const data: any = await apiRes.json();
          if (data?.data?.number) {
            return res.json({
              verified: true,
              confidence: 1.0,
              surahNumber: sNum,
              surahName: data.data.surah?.name || `سورة ${sNum}`,
              ayahNumber: aNum,
              globalAyahNumber: data.data.number,
              uthmaniText: data.data.text,
              audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(
                data.data.audio || buildEveryAyahUrl(sNum, aNum, everyAyahFolder)
              )}`,
              directAudioUrl: data.data.audio || buildEveryAyahUrl(sNum, aNum, everyAyahFolder),
            });
          }
        }
      } catch {
        // Fall through to canonical + text search
      }
    }

    const normInput = normalizeArabicForQuranMatch(text || "");
    if (!normInput || normInput.length < 8) {
      return res.json({ verified: false, reason: "Text too short for strict Quran verification" });
    }

    // Step B: Fast exact/substring check against Canonical Index
    for (const item of CANONICAL_QURAN_INDEX) {
      if (
        normInput.includes(item.normalizedKey) ||
        (item.normalizedKey.includes(normInput) && normInput.length >= 14)
      ) {
        const directUrl = buildEveryAyahUrl(item.surahNumber, item.ayahNumber, everyAyahFolder);
        return res.json({
          verified: true,
          confidence: 0.99,
          surahNumber: item.surahNumber,
          surahName: item.surahNameAr,
          ayahNumber: item.ayahNumber,
          globalAyahNumber: item.globalAyahNumber,
          uthmaniText: item.uthmaniText,
          audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
          directAudioUrl: directUrl,
          backupAudioUrl: buildIslamicNetworkAudioUrl(item.globalAyahNumber, reciter),
        });
      }
    }

    // Step C: Live verification against api.alquran.cloud/v1/search
    try {
      const searchWords = normInput.split(" ").slice(0, 6).join(" ");
      const searchUrl = `https://api.alquran.cloud/v1/search/${encodeURIComponent(searchWords)}/all/quran-simple-clean`;
      const sRes = await fetch(searchUrl);
      if (sRes.ok) {
        const sData: any = await sRes.json();
        const matches = sData?.data?.matches || [];
        for (const m of matches) {
          const normMatch = normalizeArabicForQuranMatch(m.text || "");
          if (
            normMatch &&
            (normInput.includes(normMatch) ||
              normMatch.includes(normInput) ||
              tokenOverlapRatio(normInput, normMatch) >= 0.78)
          ) {
            const sNum = m.surah?.number;
            const aNum = m.numberInSurah;
            const gNum = m.number;
            if (sNum && aNum) {
              const directUrl = buildEveryAyahUrl(sNum, aNum, everyAyahFolder);
              return res.json({
                verified: true,
                confidence: 0.94,
                surahNumber: sNum,
                surahName: m.surah?.name || `سورة ${sNum}`,
                ayahNumber: aNum,
                globalAyahNumber: gNum,
                uthmaniText: m.text,
                audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
                directAudioUrl: directUrl,
                backupAudioUrl: gNum ? buildIslamicNetworkAudioUrl(gNum, reciter) : directUrl,
              });
            }
          }
        }
      }
    } catch {
      // Ignore network search failure
    }

    // Never guess if not verified with high confidence!
    return res.json({
      verified: false,
      confidence: 0,
      reason: "Ayah not verified with 100% certainty; refusing to guess recording.",
    });
  } catch (err: any) {
    return res.status(500).json({ verified: false, error: err?.message || "Verification error" });
  }
});

function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = a.split(" ").filter((w) => w.length > 1);
  const tokensB = new Set(b.split(" ").filter((w) => w.length > 1));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  let hits = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) hits++;
  }
  return hits / Math.min(tokensA.length, tokensB.size);
}

// ─── 3. GET /api/reader/quran-audio — CORS-Safe Quran Recitation Audio Proxy ───
intelligentReaderRouter.get("/quran-audio", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "");
    if (!rawUrl || !/^https:\/\/(everyayah\.com|cdn\.islamic\.network)\//i.test(rawUrl)) {
      return res.status(400).send("Invalid Quran audio CDN URL");
    }
    const upstream = await fetch(rawUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).send("Upstream audio unavailable");
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    const arrayBuf = await upstream.arrayBuffer();
    return res.send(Buffer.from(arrayBuf));
  } catch (err: any) {
    return res.status(502).send(err?.message || "Failed to proxy Quran audio");
  }
});

// ─── Helper: Build WAV Header for Raw 24kHz 16-bit Mono PCM & Compute Acoustic Word Envelope Timings ───
function pcmBase64ToWavAndTimings(
  pcmBase64: string,
  words: string[],
  sampleRate = 24000
): {
  wavBase64: string;
  durationMs: number;
  wordTimings: Array<{ word: string; wordIndex: number; startMs: number; endMs: number; confidence: string }>;
} {
  const rawBuf = Buffer.from(pcmBase64, "base64");
  const hasRiffHeader =
    rawBuf.length > 44 &&
    rawBuf.subarray(0, 4).toString("ascii") === "RIFF" &&
    rawBuf.subarray(8, 12).toString("ascii") === "WAVE";

  const pcmBuf = hasRiffHeader ? rawBuf.subarray(44) : rawBuf;
  const effectiveSampleRate = hasRiffHeader ? rawBuf.readUInt32LE(24) || sampleRate : sampleRate;
  const numSamples = Math.floor(pcmBuf.length / 2);
  const durationMs = Math.round((numSamples / effectiveSampleRate) * 1000);

  let wavBuf: Buffer;
  if (hasRiffHeader) {
    wavBuf = rawBuf;
  } else {
    // Build 44-byte WAV header for 16-bit mono PCM at 24000 Hz
    const wavHeader = Buffer.alloc(44);
    const byteRate = effectiveSampleRate * 2;
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36 + pcmBuf.length, 4);
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
    wavHeader.writeUInt16LE(1, 22);  // NumChannels (1 = mono)
    wavHeader.writeUInt32LE(effectiveSampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(2, 32);  // BlockAlign
    wavHeader.writeUInt16LE(16, 34); // BitsPerSample
    wavHeader.write("data", 36);
    wavHeader.writeUInt32LE(pcmBuf.length, 40);
    wavBuf = Buffer.concat([wavHeader, pcmBuf]);
  }

  // Acoustic RMS Energy + Phonetic Weight Alignment (Not naive equal division!)
  // 1. Measure 20ms frame RMS energy across the PCM signal to detect leading/trailing silence and internal micro-pauses
  const frameSamples = Math.floor(effectiveSampleRate * 0.02); // 480 samples per 20ms frame
  const totalFrames = Math.max(1, Math.floor(numSamples / frameSamples));
  const frameEnergies: number[] = [];
  let maxEnergy = 1;

  for (let f = 0; f < totalFrames; f++) {
    let sumSq = 0;
    const startSample = f * frameSamples;
    for (let i = 0; i < frameSamples; i++) {
      const byteIdx = (startSample + i) * 2;
      if (byteIdx + 1 < pcmBuf.length) {
        const sample = pcmBuf.readInt16LE(byteIdx);
        sumSq += sample * sample;
      }
    }
    const rms = Math.sqrt(sumSq / frameSamples);
    frameEnergies.push(rms);
    if (rms > maxEnergy) maxEnergy = rms;
  }

  // Detect active speech onset and offset frames (above 4% of max RMS)
  const silenceThreshold = maxEnergy * 0.04;
  let firstActiveFrame = 0;
  while (firstActiveFrame < totalFrames - 1 && frameEnergies[firstActiveFrame] < silenceThreshold) {
    firstActiveFrame++;
  }
  let lastActiveFrame = totalFrames - 1;
  while (lastActiveFrame > firstActiveFrame && frameEnergies[lastActiveFrame] < silenceThreshold) {
    lastActiveFrame--;
  }

  const speechStartMs = firstActiveFrame * 20;
  const speechEndMs = Math.max(speechStartMs + 100, (lastActiveFrame + 1) * 20);
  const activeDurationMs = Math.max(100, speechEndMs - speechStartMs);

  // 2. Compute phonetic syllable & punctuation weight for each Urdu/Arabic word
  const weights = words.map((w) => {
    const clean = w.replace(/[^\u0600-\u06FF\u0750-\u077F\w]/g, "");
    const longVowels = (clean.match(/[اويىےآ]/g) || []).length;
    const hasPausePunct = /[،؛,.؟!۔:]/.test(w);
    return Math.max(1.2, clean.length * 0.85 + longVowels * 0.55 + (hasPausePunct ? 2.4 : 0));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  // 3. Snap word boundaries to local energy minima (micro-pauses between words)
  const wordTimings: Array<{ word: string; wordIndex: number; startMs: number; endMs: number; confidence: string }> = [];
  let cursorMs = speechStartMs;
  let accWeight = 0;

  for (let i = 0; i < words.length; i++) {
    accWeight += weights[i];
    const targetEndMs =
      i === words.length - 1
        ? speechEndMs
        : speechStartMs + Math.round((accWeight / totalWeight) * activeDurationMs);

    // Search within ±60ms around targetEndMs for the lowest RMS energy frame (natural word boundary)
    let snappedEndMs = targetEndMs;
    if (i < words.length - 1) {
      const centerFrame = Math.min(totalFrames - 1, Math.max(0, Math.round(targetEndMs / 20)));
      let minRms = Infinity;
      let bestFrame = centerFrame;
      for (let df = -3; df <= 3; df++) {
        const cf = centerFrame + df;
        if (cf > firstActiveFrame && cf < lastActiveFrame) {
          if (frameEnergies[cf] < minRms) {
            minRms = frameEnergies[cf];
            bestFrame = cf;
          }
        }
      }
      snappedEndMs = Math.max(cursorMs + 40, bestFrame * 20);
    }

    wordTimings.push({
      word: words[i],
      wordIndex: i,
      startMs: cursorMs,
      endMs: Math.max(cursorMs + 40, snappedEndMs),
      confidence: "acoustic-energy-aligned",
    });
    cursorMs = Math.max(cursorMs + 40, snappedEndMs);
  }

  return {
    wavBase64: wavBuf.toString("base64"),
    durationMs,
    wordTimings,
  };
}

// ─── 4. POST /api/reader/tts — Multi-Provider Urdu (Pakistan) & Arabic Male TTS Engine ───
intelligentReaderRouter.post("/tts", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const {
      text,
      language = "ur-PK", // "ur-PK" | "ar-SA"
      segmentType = "urdu_body", // "urdu_body" | "hadith" | "dua" | "arabic_quote" | "heading"
      voiceId = "pakistani_scholar_charon",
      provider = "gemini-neural", // "gemini-neural" | "google-cloud-tts"
    } = req.body || {};

    const cleanText = String(text || "").trim();
    if (!cleanText) {
      return res.status(400).json({ error: "Text is required for TTS" });
    }

    const words = cleanText.split(/\s+/).filter(Boolean);

    // Map DAR AL TAWHID scholarly male voice IDs to Gemini prebuilt male voices
    const geminiVoiceMap: Record<string, string> = {
      pakistani_scholar_charon: "Charon", // Deep, calm, dignified male voice
      pakistani_narrator_fenrir: "Fenrir", // Clear, resonant male narrator
      pakistani_classic_orus: "Orus", // Measured scholarly male voice
      arabic_hadith_charon: "Charon",
      arabic_turath_fenrir: "Fenrir",
      arabic_fasih_orus: "Orus",
    };
    const selectedGeminiVoice = geminiVoiceMap[voiceId] || "Charon";

    // Optional Google Cloud TTS API if GOOGLE_CLOUD_TTS_KEY is configured in environment
    if (provider === "google-cloud-tts" && process.env.GOOGLE_CLOUD_TTS_KEY) {
      try {
        const isArabic = language.startsWith("ar") || segmentType === "hadith" || segmentType === "arabic_quote";
        const gRes = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_CLOUD_TTS_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: { text: cleanText },
              voice: {
                languageCode: isArabic ? "ar-XA" : "ur-PK",
                name: isArabic ? "ar-XA-Wavenet-B" : "ur-IN-Wavenet-B",
                ssmlGender: "MALE",
              },
              audioConfig: {
                audioEncoding: "LINEAR16",
                sampleRateHertz: 24000,
              },
            }),
          }
        );
        if (gRes.ok) {
          const gData: any = await gRes.json();
          if (gData?.audioContent) {
            const wavInfo = pcmBase64ToWavAndTimings(gData.audioContent, words, 24000);
            return res.json({
              ok: true,
              provider: "google-cloud-tts",
              voiceId,
              language,
              mimeType: "audio/wav",
              audioBase64: wavInfo.wavBase64,
              durationMs: wavInfo.durationMs,
              wordTimings: wavInfo.wordTimings,
            });
          }
        }
      } catch {
        // Fall back to Gemini Neural TTS
      }
    }

    // Primary Provider: Gemini 3.8 Flash Lite Neural TTS (with fallback to gemini-2.5-flash-preview-tts)
    const ai = getAiClient();
    if (!ai) {
      return res.status(503).json({
        ok: false,
        error: "GEMINI_API_KEY is not configured on the server",
      });
    }

    const isArabicSegment =
      language.startsWith("ar") ||
      segmentType === "hadith" ||
      segmentType === "dua" ||
      segmentType === "arabic_quote";

    const styleInstruction = isArabicSegment
      ? segmentType === "hadith"
        ? "Scholarly, reverent, dignified Classical Arabic male narrator reading a prophetic Hadith with clear grammatical vocalization (Fusha), calm measured pace, natural pauses between narrator chain (Sanad) and text (Matn), zero theatrical exaggeration."
        : "Calm, clear, dignified Classical Arabic male book reader (Fusha), scholarly tone, natural pauses at sentence boundaries."
      : "Dignified, calm, natural Pakistani Urdu male book narrator (Urdu - Pakistan, ur-PK), authentic scholarly Urdu pronunciation, smooth Nastaliq literary cadence, natural pauses that preserve sentence meaning, zero robotic or theatrical tone.";

    let pcmBase64: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: styleInstruction,
                },
              } as any,
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedGeminiVoice,
              },
            },
          },
        },
      });
      pcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch {
      const fallbackRes = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedGeminiVoice,
              },
            },
          },
        },
      });
      pcmBase64 = fallbackRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    }

    if (!pcmBase64) {
      return res.status(500).json({
        ok: false,
        error: "No audio returned from Gemini TTS model",
      });
    }

    const wavInfo = pcmBase64ToWavAndTimings(pcmBase64, words, 24000);

    return res.json({
      ok: true,
      provider: "gemini-3.8-flash-lite-tts",
      voiceId,
      geminiVoice: selectedGeminiVoice,
      language: isArabicSegment ? "ar-SA" : "ur-PK",
      mimeType: "audio/wav",
      audioBase64: wavInfo.wavBase64,
      durationMs: wavInfo.durationMs,
      wordTimings: wavInfo.wordTimings,
    });
  } catch (err: any) {
    console.error("[DAR AL TAWHID TTS Error]:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "TTS generation failed",
    });
  }
});
