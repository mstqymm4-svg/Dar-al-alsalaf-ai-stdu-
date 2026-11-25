/**
 * DAR AL TAWHID — Server-Side Intelligent Book Reader API (v4)
 *
 * Provides:
 * 1. POST /api/reader/ocr-page       — Gemini Vision OCR + Server Tesseract.js (urd+ara with real bounding-box blocks)
 * 2. POST /api/reader/verify-quran   — Authentic Quranic verse verification + recorded recitation audio resolution
 * 3. POST /api/reader/tts            — Multi-provider Neural TTS (Microsoft Edge Neural TTS ur-PK-AsadNeural / ar-SA-HamedNeural with hardware WordBoundary timings + language-aware Unicode canonicalization)
 * 4. GET  /api/reader/quran-audio    — Proxy for authentic Quran verse MP3s (AlQuran.cloud / EveryAyah CDN) to avoid CORS issues
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import Tesseract from "tesseract.js";

export const intelligentReaderRouter = express.Router();

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
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
  {
    surahNumber: 39,
    surahNameAr: "سورة الزمر",
    ayahNumber: 2,
    globalAyahNumber: 4060,
    uthmaniText: "فَاعْبُدِ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ",
    normalizedKey: "فاعبد الله مخلصا له الدين",
  },
  {
    surahNumber: 25,
    surahNameAr: "سورة الفرقان",
    ayahNumber: 23,
    globalAyahNumber: 2878,
    uthmaniText: "وَقَدِمْنَا إِلَىٰ مَا عَمِلُوا مِنْ عَمَلٍ فَجَعَلْنَاهُ هَبَاءً مَّنثُورًا",
    normalizedKey: "وقدمنا الي ما عملوا من عمل فجعلناه هباء منثورا",
  },
  {
    surahNumber: 4,
    surahNameAr: "سورة النساء",
    ayahNumber: 125,
    globalAyahNumber: 618,
    uthmaniText: "وَمَنْ أَحْسَنُ دِينًا مِّمَّنْ أَسْلَمَ وَجْهَهُ لِلَّهِ وَهُوَ مُحْسِنٌ وَاتَّبَعَ مِلَّةَ إِبْرَاهِيمَ حَنِيفًا وَاتَّخَذَ اللَّهُ إِبْرَاهِيمَ خَلِيلًا",
    normalizedKey: "ومن احسن دينا ممن اسلم وجهه لله وهو محسن واتبع مله ابراهيم حنيفا واتخذ الله ابراهيم خليلا",
  },
  {
    surahNumber: 2,
    surahNameAr: "سورة البقرة",
    ayahNumber: 112,
    globalAyahNumber: 119,
    uthmaniText: "بَلَىٰ مَنْ أَسْلَمَ وَجْهَهُ لِلَّهِ وَهُوَ مُحْسِنٌ فَلَهُ أَجْرُهُ عِندَ رَبِّهِ وَلَا خَوْفٌ عَلَيْهِمْ وَلَا هُمْ يَحْزَنُونَ",
    normalizedKey: "بلي من اسلم وجهه لله وهو محسن فله اجره عند ربه ولا خوف عليهم ولا هم يحزنون",
  },
  {
    surahNumber: 98,
    surahNameAr: "سورة البينة",
    ayahNumber: 5,
    globalAyahNumber: 6135,
    uthmaniText: "وَمَا أُمِرُوا إِلَّا لِيَعْبُدُوا اللَّهَ مُخْلِصِينَ لَهُ الدِّينَ حُنَفَاءَ وَيُقِيمُوا الصَّلَاةَ وَيُؤْتُوا الزَّكَاةَ وَذَٰلِكَ دِينُ الْقَيِّمَةِ",
    normalizedKey: "وما امروا الا ليعبدوا الله مخلصين له الدين حنفاء ويقيموا الصلاه ويؤتوا الزكاه وذلك دين القيمه",
  },
  {
    surahNumber: 18,
    surahNameAr: "سورة الكهف",
    ayahNumber: 110,
    globalAyahNumber: 2250,
    uthmaniText: "فَمَن كَانَ يَرْجُو لِقَاءَ رَبِّهِ فَلْيَعْمَلْ عَمَلًا صَالِحًا وَلَا يُشْرِكْ بِعِبَادَةِ رَبِّهِ أَحَدًا",
    normalizedKey: "فمن كان يرجو لقاء ربه فليعمل عملا صالحا ولا يشرك بعباده ربه احدا",
  },
  {
    surahNumber: 67,
    surahNameAr: "سورة الملك",
    ayahNumber: 2,
    globalAyahNumber: 5243,
    uthmaniText: "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا وَهُوَ الْعَزِيزُ الْغَفُورُ",
    normalizedKey: "الذي خلق الموت والحياه ليبلوكم ايكم احسن عملا وهو العزيز الغفور",
  },
  {
    surahNumber: 11,
    surahNameAr: "سورة هود",
    ayahNumber: 15,
    globalAyahNumber: 1488,
    uthmaniText: "مَن كَانَ يُرِيدُ الْحَيَاةَ الدُّنْيَا وَزِينَتَهَا نُوَفِّ إِلَيْهِمْ أَعْمَالَهُمْ فِيهَا وَهُمْ فِيهَا لَا يُبْخَسُونَ",
    normalizedKey: "من كان يريد الحياه الدنيا وزينتها نوف اليهم اعمالهم فيها وهم فيها لا يبخسون",
  },
  {
    surahNumber: 11,
    surahNameAr: "سورة هود",
    ayahNumber: 16,
    globalAyahNumber: 1489,
    uthmaniText: "أُولَٰئِكَ الَّذِينَ لَيْسَ لَهُمْ فِي الْآخِرَةِ إِلَّا النَّارُ وَحَبِطَ مَا صَنَعُوا فِيهَا وَبَاطِلٌ مَّا كَانُوا يَعْمَلُونَ",
    normalizedKey: "اوليك الذين ليس لهم في الاخره الا النار وحبط ما صنعوا فيها وباطل ما كانوا يعملون",
  },
  {
    surahNumber: 39,
    surahNameAr: "سورة الزمر",
    ayahNumber: 3,
    globalAyahNumber: 4061,
    uthmaniText: "أَلَا لِلَّهِ الدِّينُ الْخَالِصُ",
    normalizedKey: "الا لله الدين الخالص",
  },
  {
    surahNumber: 39,
    surahNameAr: "سورة الزمر",
    ayahNumber: 11,
    globalAyahNumber: 4069,
    uthmaniText: "قُلْ إِنِّي أُمِرْتُ أَنْ أَعْبُدَ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ",
    normalizedKey: "قل اني امرت ان اعبد الله مخلصا له الدين",
  },
  {
    surahNumber: 39,
    surahNameAr: "سورة الزمر",
    ayahNumber: 14,
    globalAyahNumber: 4072,
    uthmaniText: "قُلِ اللَّهَ أَعْبُدُ مُخْلِصًا لَّهُ دِينِي",
    normalizedKey: "قل الله اعبد مخلصا له ديني",
  },
  {
    surahNumber: 39,
    surahNameAr: "سورة الزمر",
    ayahNumber: 65,
    globalAyahNumber: 4123,
    uthmaniText: "وَلَقَدْ أُوحِيَ إِلَيْكَ وَإِلَى الَّذِينَ مِن قَبْلِكَ لَئِنْ أَشْرَكْتَ لَيَحْبَطَنَّ عَمَلُكَ وَلَتَكُونَنَّ مِنَ الْخَاسِرِينَ",
    normalizedKey: "ولقد اوحي اليك والي الذين من قبلك لين اشركت ليحبطن عملك ولتكونن من الخاسرين",
  },
];

export function normalizeArabicForQuranMatch(text: string): string {
  return String(text || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\(\)\[\]\{\}]\s*[٠-٩۰-۹\d]+\s*[\(\)\[\]\{\}]/g, " ")
    .replace(/[﴿﴾«»"'\(\)\[\]\{\}۞٭،؛؟!۔.:—–\-]/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0610-\u061A\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ةۃہ]/g, "ه")
    .replace(/[ىیے]/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩۰-۹\d]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuranOrthographicNoSpace(normalizedText: string): string {
  return String(normalizedText || "")
    .replace(/\s+/g, "")
    .replace(/صلوه/g, "صلاه")
    .replace(/زكوه/g, "زكاه")
    .replace(/حيوه/g, "حياه")
    .replace(/مشكوه/g, "مشكاه")
    .replace(/غدوه/g, "غداه")
    .replace(/نجوه/g, "نجاه")
    .replace(/منوه/g, "مناه")
    .replace(/ربوا/g, "ربا")
    .replace(/اولائك|اوليك/g, "اوليك")
    .replace(/هولاء|هاولاء/g, "هولا")
    .replace(/ياايها|يايها/g, "يايها")
    .replace(/سماوات|سموات/g, "سموت")
    .replace(/عالمين|علمين/g, "علمين")
    .replace(/رحمان|رحمن/g, "رحمن")
    .replace(/ابراهيم|ابرهم/g, "ابراهيم")
    .replace(/اسماعيل|اسمعيل/g, "اسمعيل")
    .replace(/اسحاق|اسحق/g, "اسحق")
    .replace(/سليمان|سليمن/g, "سليمن")
    .replace(/هارون|هرون/g, "هرون")
    .replace(/شيطان|شيطن/g, "شيطن")
    .replace(/قران/g, "قران");
}

function buildEveryAyahUrl(
  surahNumber: number,
  ayahNumber: number,
  reciterFolder = "Saood_ash-Shuraym_128kbps"
): string {
  const s = String(surahNumber).padStart(3, "0");
  const a = String(ayahNumber).padStart(3, "0");
  return `https://everyayah.com/data/${reciterFolder}/${s}${a}.mp3`;
}

function buildIslamicNetworkAudioUrl(
  globalAyahNumber: number,
  edition = "ar.saoodshuraym"
): string {
  const bitrate = edition === "ar.saoodshuraym" ? 64 : 128;
  return `https://cdn.islamic.network/quran/audio/${bitrate}/${edition}/${globalAyahNumber}.mp3`;
}

const RECITER_FOLDER_MAP: Record<string, string> = {
  "ar.saoodshuraym": "Saood_ash-Shuraym_128kbps",
  "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
  "ar.alafasy": "Alafasy_128kbps",
  "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
  "ar.husary": "Husary_128kbps",
  "ar.minshawi": "Minshawy_Murattal_128kbps",
};

const RECITER_QURAN_COM_ID: Record<string, number> = {
  "ar.saoodshuraym": 10,
  "ar.abdurrahmaansudais": 3,
  "ar.alafasy": 7,
  "ar.abdulbasitmurattal": 2,
  "ar.husary": 6,
  "ar.minshawi": 9,
};

interface QuranComAyahSegmentsData {
  audioUrl: string;
  segments: Array<{ wordNum: number; startMs: number; endMs: number }>;
  maxWordNum: number;
}

const _quranComSegmentsCache = new Map<string, QuranComAyahSegmentsData | null>();

async function getQuranComAyahSegments(
  surahNumber: number,
  ayahNumber: number,
  reciter = "ar.saoodshuraym"
): Promise<QuranComAyahSegmentsData | null> {
  const qId = RECITER_QURAN_COM_ID[reciter] || 10;
  const cacheKey = `${qId}:${surahNumber}:${ayahNumber}`;
  if (_quranComSegmentsCache.has(cacheKey)) {
    return _quranComSegmentsCache.get(cacheKey) || null;
  }

  try {
    const url = `https://api.quran.com/api/v4/recitations/${qId}/by_ayah/${surahNumber}:${ayahNumber}?fields=segments`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) {
      _quranComSegmentsCache.set(cacheKey, null);
      return null;
    }
    const json: any = await res.json();
    const audioFile = Array.isArray(json?.audio_files) ? json.audio_files[0] : null;
    const rawRelUrl = String(audioFile?.url || "").trim();
    const rawSegs = Array.isArray(audioFile?.segments) ? audioFile.segments : [];
    if (!rawRelUrl || rawSegs.length === 0) {
      _quranComSegmentsCache.set(cacheKey, null);
      return null;
    }

    const segments: Array<{ wordNum: number; startMs: number; endMs: number }> = [];
    let maxWordNum = 0;
    for (const seg of rawSegs) {
      if (!Array.isArray(seg) || seg.length < 4) continue;
      const wordNum = Number(seg[1]);
      const startMs = Number(seg[2]);
      const endMs = Number(seg[3]);
      if (
        Number.isFinite(wordNum) &&
        wordNum >= 1 &&
        Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        endMs > startMs
      ) {
        segments.push({ wordNum, startMs, endMs });
        if (wordNum > maxWordNum) maxWordNum = wordNum;
      }
    }

    if (segments.length === 0 || maxWordNum === 0) {
      _quranComSegmentsCache.set(cacheKey, null);
      return null;
    }

    const fullAudioUrl = /^https?:\/\//i.test(rawRelUrl)
      ? rawRelUrl
      : `https://verses.quran.com/${rawRelUrl.replace(/^\/+/, "")}`;

    const parsed: QuranComAyahSegmentsData = {
      audioUrl: fullAudioUrl,
      segments,
      maxWordNum,
    };
    _quranComSegmentsCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

interface FullQuranEntry {
  surahNumber: number;
  surahNameAr: string;
  ayahNumber: number;
  globalAyahNumber: number;
  text: string;
  norm: string;
  normNoSpace: string;
  tokens: string[];
  rawTokens: string[];
}

interface FullQuranIndexStore {
  ayahs: FullQuranEntry[];
  byKey: Map<string, number>;
  surahMaxAyah: Map<number, number>;
  wordIndex: Map<string, number[]>;
  gram4Index: Map<string, number[]>;
}

const QURAN_INDEX_DISK_PATH = path.resolve(process.cwd(), "data-export", ".quran-full-index.json");
let _fullQuranStorePromise: Promise<FullQuranIndexStore> | null = null;
let _fullQuranStore: FullQuranIndexStore | null = null;

function buildStoreFromEntries(rawEntries: Array<{
  s: number;
  sn: string;
  a: number;
  g: number;
  t: string;
}>): FullQuranIndexStore {
  const ayahs: FullQuranEntry[] = [];
  const byKey = new Map<string, number>();
  const surahMaxAyah = new Map<number, number>();
  const wordIndex = new Map<string, number[]>();
  const gram4Index = new Map<string, number[]>();

  for (let i = 0; i < rawEntries.length; i++) {
    const raw = rawEntries[i];
    const cleanText = String(raw.t || "").replace(/\uFEFF/g, "").trim();
    const norm = normalizeArabicForQuranMatch(cleanText);
    const normNoSpace = normalizeQuranOrthographicNoSpace(norm);
    const rawTokens = norm.split(" ").filter(Boolean);
    const tokens = rawTokens.filter((w) => w.length >= 2);
    const entry: FullQuranEntry = {
      surahNumber: raw.s,
      surahNameAr: raw.sn,
      ayahNumber: raw.a,
      globalAyahNumber: raw.g,
      text: cleanText,
      norm,
      normNoSpace,
      tokens,
      rawTokens,
    };
    ayahs.push(entry);
    byKey.set(`${raw.s}:${raw.a}`, i);
    const prevMax = surahMaxAyah.get(raw.s) || 0;
    if (raw.a > prevMax) surahMaxAyah.set(raw.s, raw.a);

    const seenWords = new Set<string>();
    for (const tk of tokens) {
      if (tk.length >= 3 && !seenWords.has(tk)) {
        seenWords.add(tk);
        let list = wordIndex.get(tk);
        if (!list) {
          list = [];
          wordIndex.set(tk, list);
        }
        list.push(i);
      }
    }

    if (normNoSpace.length >= 4) {
      const seenGrams = new Set<string>();
      for (let k = 0; k <= normNoSpace.length - 4; k += 2) {
        const g4 = normNoSpace.slice(k, k + 4);
        if (!seenGrams.has(g4)) {
          seenGrams.add(g4);
          let gList = gram4Index.get(g4);
          if (!gList) {
            gList = [];
            gram4Index.set(g4, gList);
          }
          gList.push(i);
        }
      }
    }
  }

  return { ayahs, byKey, surahMaxAyah, wordIndex, gram4Index };
}

async function getFullQuranIndex(): Promise<FullQuranIndexStore> {
  if (_fullQuranStore) return _fullQuranStore;
  if (_fullQuranStorePromise) return _fullQuranStorePromise;

  _fullQuranStorePromise = (async () => {
    // 1. Try disk cache first (instant < 15ms startup)
    try {
      if (fs.existsSync(QURAN_INDEX_DISK_PATH)) {
        const rawJson = fs.readFileSync(QURAN_INDEX_DISK_PATH, "utf-8");
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length >= 6200) {
          _fullQuranStore = buildStoreFromEntries(parsed);
          return _fullQuranStore;
        }
      }
    } catch {
      // Rebuild from API if disk file corrupt
    }

    // 2. Fetch full 6,236-ayah Quran from api.alquran.cloud and persist locally
    try {
      const apiRes = await fetch("https://api.alquran.cloud/v1/quran/quran-simple-clean", {
        signal: AbortSignal.timeout(12000),
      });
      if (apiRes.ok) {
        const apiData: any = await apiRes.json();
        const surahs = Array.isArray(apiData?.data?.surahs) ? apiData.data.surahs : [];
        const compactEntries: Array<{ s: number; sn: string; a: number; g: number; t: string }> = [];
        for (const s of surahs) {
          const sNum = Number(s.number);
          const sName = String(s.name || `سورة ${sNum}`).trim();
          for (const ay of s.ayahs || []) {
            compactEntries.push({
              s: sNum,
              sn: sName,
              a: Number(ay.numberInSurah),
              g: Number(ay.number),
              t: String(ay.text || "").replace(/\uFEFF/g, "").trim(),
            });
          }
        }
        if (compactEntries.length >= 6200) {
          try {
            fs.mkdirSync(path.dirname(QURAN_INDEX_DISK_PATH), { recursive: true });
            fs.writeFileSync(QURAN_INDEX_DISK_PATH, JSON.stringify(compactEntries));
          } catch {}
          _fullQuranStore = buildStoreFromEntries(compactEntries);
          return _fullQuranStore;
        }
      }
    } catch (err: any) {
      console.warn("[DAR AL TAWHID Full Quran Loader Fallback]:", err?.message || err);
    }

    // 3. Emergency fallback to embedded canonical subset
    const fallbackEntries = CANONICAL_QURAN_INDEX.map((it) => ({
      s: it.surahNumber,
      sn: it.surahNameAr,
      a: it.ayahNumber,
      g: it.globalAyahNumber,
      t: it.uthmaniText,
    }));
    _fullQuranStore = buildStoreFromEntries(fallbackEntries);
    return _fullQuranStore;
  })();

  return _fullQuranStorePromise;
}

// Pre-warm Full 6,236-Ayah index silently on module load
setTimeout(() => {
  getFullQuranIndex().catch(() => {});
}, 250);

// ─── Helper: Server-side Presentation Forms Normalization, Visual LTR Reversal Fix & Letter Rejoiner ───
const STRICTLY_WORD_FINAL_SERVER = new Set(["ے", "ں", "ة", "ى", "ۃ"]);
const NON_CONNECTING_AFTER_SERVER = new Set([
  "ا", "آ", "أ", "إ", "ٱ", "د", "ڈ", "ذ", "ر", "ڑ", "ز", "ژ", "و", "ؤ", "ے", "ں", "ة", "ۃ", "ى",
]);

const KNOWN_WORDS_SERVER_LIST = [
  "کے", "کی", "کا", "کو", "سے", "نے", "پر", "میں", "ہے", "ہیں",
  "تھا", "تھے", "تھی", "اور", "یہ", "وہ", "اس", "ان", "اب", "جب",
  "تب", "سب", "رب", "دل", "دم", "غم", "کم", "ہم", "تم", "جو", "تو",
  "بھی", "ہی", "نہ", "نا", "کہ", "ہر", "اک", "ایک", "دو", "تین", "چار", "پانچ",
  "آپ", "خود", "کچھ", "کوئی", "کس", "کسی", "کون", "کیا", "کیوں", "کیسے",
  "کہاں", "جہاں", "وہاں", "یہاں", "اگر", "مگر", "لیکن", "بلکہ", "تاکہ",
  "کیونکہ", "چونکہ", "لہذا", "یعنی", "صرف", "فقط", "بالکل",
  "بہت", "زیادہ", "تھوڑا", "پورا", "سارا", "سارے", "ساری", "اپنا", "اپنے", "اپنی",
  "ہمارا", "ہمارے", "ہماری", "تمہارا", "تمہارے", "تمہاری", "جن", "جنہیں", "جس", "جسے",
  "اندر", "باہر", "اوپر", "نیچے", "آگے", "پیچھے", "پہلے", "بعد", "ساتھ", "بغیر", "لیے",
  "ہو", "ہوا", "ہوئے", "ہوئی", "ہوتا", "ہوتے", "ہوتی", "ہونا", "ہونے", "ہوگا", "ہوگی", "ہوں",
  "کر", "کرا", "کرے", "کریں", "کرتا", "کرتے", "کرتی", "کرنا", "کرنے", "کیے",
  "رہا", "رہے", "رہی", "رہنا", "رہتا", "رہتے", "رہتی", "جائے", "جائیں", "جاتا", "جاتے", "جاتی",
  "آیا", "آئے", "آئی", "آتا", "آتے", "آتی", "آنا", "آنے", "لانا", "لانے", "لاتا", "لاتے",
  "دیا", "دیے", "دیتا", "دیتے", "دیتی", "دینا", "دینے", "لیا", "لیتا", "لیتے", "لینا",
  "کہا", "کہتے", "کہتا", "کہتی", "کہنا", "فرمایا", "فرماتے", "سمجھنا", "سمجھتا", "سمجھتے",
  "چاہیے", "سکتا", "سکتے", "سکتی", "لگا", "لگے", "لگی", "پڑا", "پڑے", "پڑی", "پیدا",
  "وسوسہ", "وسوسے", "وساوس", "شیطان", "شیاطین", "انسان", "مسلمان", "مسلمانوں",
  "مومن", "مومنین", "ایمان", "اسلام", "قرآن", "حدیث", "سنت", "نماز", "روزہ", "زکوۃ", "حج",
  "علاج", "شفا", "ذکر", "اذکار", "دعا", "دعائیں", "توبہ", "استغفار", "اللہ", "تعالیٰ", "تعالی",
  "رسول", "نبی", "کریم", "صحابہ", "کرام", "رضی", "عنہ", "عنہم", "عنہا", "رحمہ",
  "ہتھیار", "ذریعے", "ذریعہ", "دلوں", "شکوک", "شبہات", "شک", "شبہ", "اتنا", "مضبوط",
  "متاثر", "نہیں", "کبھی", "ایسے", "ایسا", "ایسی", "خیالات", "خیال", "زبان", "گوارا",
  "عرض", "برا", "خوفزدہ", "خوف", "خالص", "علامت", "بات", "روشن", "دلیل", "طریقہ",
  "عقیدہ", "فائدہ", "قاعدہ", "مسئلہ", "مسائل", "حکم", "احکام", "علم", "علماء", "کتاب",
  "من", "عن", "في", "فى", "على", "إلى", "مع", "بين", "عند", "حتى", "قد", "لا", "ما", "هو", "هي", "هم",
  "ثم", "بل", "أن", "إن", "قال", "كان", "كانت", "ذلك", "ذلک", "هذا", "هذه", "الذي", "التي", "الذين",
  "الحمد", "للہ", "لله", "الله", "اللهم", "العالمین", "العالمين", "الرحمن", "الرحیم", "الرحيم",
  "صریح", "صريح", "الایمان", "الإيمان", "شر", "الوسواس", "الخناس", "یوسوس", "يوسوس",
  "صدور", "الناس", "اعوذ", "أعوذ", "برب", "كيف", "کیف", "تنقذ", "نفسك", "نفسک", "ورطة", "ورطۃ",
  "الوسوسة", "الوسوسۃ", "الشيطان", "واضع", "خطمه", "قلب", "ابن", "آدم", "حاشية", "حاشیہ",
  "نیت", "نیتوں", "نیتیں", "اخلاص", "اعمال", "عمل", "مقصد", "مقاصد", "بندہ", "بندے", "ثواب", "اجر", "ہجرت", "دنیا", "آخرت",
];

const KNOWN_WORDS_SERVER_SET = new Set(KNOWN_WORDS_SERVER_LIST);
const SORTED_KNOWN_WORDS_SERVER = [...KNOWN_WORDS_SERVER_LIST]
  .filter((w) => w.length >= 2)
  .sort((a, b) => b.length - a.length);

const DUAL_JOINING_SERVER_REGEX = /^[بپتٹثجچحخسشصضطظعغفقکكگلمنہهھیيئ]$/;
const SINGLE_LETTER_SERVER_REGEX = /^[\u0600-\u06FF\u0750-\u077F][\u064B-\u065F\u0670]*$/;

export function canonicalizeTextForLanguageServer(text: string, isArabic: boolean): string {
  if (!text) return "";
  const s = String(text);
  if (isArabic) {
    return s
      .replace(/\u06C1/g, "\u0647") // ہ -> ه
      .replace(/\u06A9/g, "\u0643") // ک -> ك
      .replace(/\u06CC/g, "\u064A") // ی -> ي
      .replace(/\u06D2/g, "\u0649") // ے -> ى
      .replace(/[\u06C2\u06C3]/g, "\u0629") // ۂ/ۃ -> ة
      .replace(/\u06D4/g, "."); // ۔ -> .
  }
  return s
    .replace(/\u0643/g, "\u06A9") // ك -> ک
    .replace(/[\u0649\u064A]/g, "\u06CC") // ى / ي -> ی (critical so ur-PK-AsadNeural never reads Alef Maksura ى as Fatha/Alif)
    .replace(/\u0647/g, "\u06C1"); // ه -> ہ
}

function scoreRtlPlausibilityServer(text: string): {
  score: number;
  recognizedWords: number;
  totalWords: number;
  initialFinalViolations: number;
} {
  const clean = String(text || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .trim();
  if (!clean) return { score: 0, recognizedWords: 0, totalWords: 0, initialFinalViolations: 0 };

  const words = clean
    .split(/\s+/)
    .map((w) => w.replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–-]/g, ""))
    .filter((w) => w.length >= 2);

  if (words.length === 0) {
    return { score: 0, recognizedWords: 0, totalWords: 0, initialFinalViolations: 0 };
  }

  let score = 0;
  let recognizedWords = 0;
  let initialFinalViolations = 0;

  for (const w of words) {
    const asAr = canonicalizeTextForLanguageServer(w, true);
    const asUr = canonicalizeTextForLanguageServer(w, false);

    if (KNOWN_WORDS_SERVER_SET.has(w) || KNOWN_WORDS_SERVER_SET.has(asAr) || KNOWN_WORDS_SERVER_SET.has(asUr)) {
      score += 4;
      recognizedWords++;
      continue;
    }

    if (/^[ےںةۃ]/.test(w)) {
      score -= 6;
      initialFinalViolations++;
      continue;
    }

    if (/^(?:ال|وال|بال|فال|كال|لل)[\u0621-\u06D3]{2,}$/.test(asAr)) {
      score += 3;
      recognizedWords++;
      continue;
    }

    if (/[ےںةۃى]$/.test(w) || /(?:وں|یں|ات|ان|ین|ين|ون|ہا|ها|ہم|هم|کم|كم|نا|تہ|نہ|یہ)$/.test(w)) {
      score += 2;
      recognizedWords++;
      continue;
    }

    if (w.length >= 4 && w.endsWith("لا") && !w.startsWith("ال")) {
      score -= 3;
    }
  }

  return { score, recognizedWords, totalWords: words.length, initialFinalViolations };
}

function detectAndFixVisualRtlReversalServer(lineText: string): string {
  const line = String(lineText || "").trim();
  if (!line || line.length < 3 || !/[\u0600-\u06FF\u0750-\u077F]/.test(line)) {
    return line;
  }

  const forwardStats = scoreRtlPlausibilityServer(line);
  // If there are no word-initial [ےںةۃ] violations, NEVER reverse tokens (which could turn "نیت" into "تین")
  if (forwardStats.initialFinalViolations === 0) {
    return line;
  }

  const wholeReversed = [...line].reverse().join("");
  const wholeRevStats = scoreRtlPlausibilityServer(wholeReversed);

  const perTokenReversed = line
    .split(/\s+/)
    .map((tk) => (/[\u0600-\u06FF\u0750-\u077F]/.test(tk) ? [...tk].reverse().join("") : tk))
    .join(" ");
  const tokenRevStats = scoreRtlPlausibilityServer(perTokenReversed);

  let bestText = line;
  let bestScore = forwardStats.score;

  if (
    wholeRevStats.initialFinalViolations === 0 &&
    wholeRevStats.score >= bestScore + 6 &&
    wholeRevStats.recognizedWords > forwardStats.recognizedWords
  ) {
    bestText = wholeReversed;
    bestScore = wholeRevStats.score;
  }
  if (
    tokenRevStats.initialFinalViolations === 0 &&
    tokenRevStats.score >= bestScore + 6 &&
    tokenRevStats.recognizedWords > forwardStats.recognizedWords
  ) {
    bestText = perTokenReversed;
  }

  return bestText;
}

function segmentLetterRunServer(letterTokens: string[]): string[] {
  const n = letterTokens.length;
  if (n === 0) return [];
  if (n === 1) return [letterTokens[0]];

  const bases = letterTokens.map((t) =>
    t.replace(/[\u064B-\u065F\u0670۔،؛؟!:"'«»﴿﴾\(\)\[\]]/g, "")
  );

  const matchKnownWordAt = (startIdx: number): number => {
    if (letterTokens.length - startIdx < 2) return 0;
    const sub = bases.slice(startIdx, Math.min(letterTokens.length, startIdx + 10)).join("");
    for (const kw of SORTED_KNOWN_WORDS_SERVER) {
      if (sub.startsWith(kw)) {
        const afterIdx = startIdx + kw.length;
        const nextTwo = bases.slice(afterIdx, afterIdx + 2).join("");
        if ((nextTwo === "وں" || nextTwo === "یں") && kw.length >= 3) {
          return kw.length + 2;
        }
        return kw.length;
      }
    }
    return 0;
  };

  const resultWords: string[] = [];
  let currentWord = "";
  let currentClean = "";
  let idx = 0;

  while (idx < letterTokens.length) {
    if (!currentWord) {
      const matchLen = matchKnownWordAt(idx);
      if (matchLen >= 2) {
        let built = "";
        for (let m = 0; m < matchLen; m++) {
          built += letterTokens[idx + m];
          if (/[۔،؛؟!:]$/.test(letterTokens[idx + m])) {
            idx += m + 1;
            resultWords.push(built);
            built = "";
            break;
          }
        }
        if (built) {
          resultWords.push(built);
          idx += matchLen;
        }
        continue;
      }
    }

    const piece = letterTokens[idx];
    const baseChar = bases[idx];
    const hasTrailingPunct = /[۔،؛؟!:]$/.test(piece);

    currentWord += piece;
    currentClean += baseChar;
    idx++;

    if (hasTrailingPunct) {
      resultWords.push(currentWord);
      currentWord = "";
      currentClean = "";
      continue;
    }

    if (STRICTLY_WORD_FINAL_SERVER.has(baseChar) && currentClean.length >= 2) {
      resultWords.push(currentWord);
      currentWord = "";
      currentClean = "";
      continue;
    }

    if (baseChar === "ہ" && currentClean.length >= 3) {
      resultWords.push(currentWord);
      currentWord = "";
      currentClean = "";
      continue;
    }

    if (KNOWN_WORDS_SERVER_SET.has(currentClean) && idx < letterTokens.length) {
      const nextTwo = bases.slice(idx, idx + 2).join("");
      if (nextTwo !== "وں" && nextTwo !== "یں") {
        resultWords.push(currentWord);
        currentWord = "";
        currentClean = "";
        continue;
      }
    }

    if (
      currentClean.length >= 2 &&
      idx < letterTokens.length &&
      (NON_CONNECTING_AFTER_SERVER.has(baseChar) || currentClean.length >= 3)
    ) {
      if (matchKnownWordAt(idx) >= 2) {
        resultWords.push(currentWord);
        currentWord = "";
        currentClean = "";
        continue;
      }
    }
  }

  if (currentWord) resultWords.push(currentWord);
  return resultWords;
}

export function rejoinFragmentedUrduArabicLettersServer(rawText: string): string {
  if (!rawText) return "";
  const s = String(rawText)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\uFBA6-\uFBA9]/g, "ہ")
    .replace(/[\uFBAA-\uFBAD]/g, "ھ")
    .replace(/[\uFBFC-\uFBFF]/g, "ی")
    .replace(/[\uFBAE\uFBAF]/g, "ے")
    .replace(/[\uFB8E-\uFB91]/g, "ک")
    .replace(/[\uFB92-\uFB95]/g, "گ")
    .replace(/[\uFB9E\uFB9F]/g, "ں")
    .replace(/[\uFB66-\uFB69]/g, "ٹ")
    .replace(/[\uFB88\uFB89]/g, "ڈ")
    .replace(/[\uFB8C\uFB8D]/g, "ڑ")
    .replace(/[\uFB56-\uFB59]/g, "پ")
    .replace(/[\uFB7A-\uFB7D]/g, "چ")
    .replace(/[\uFB8A\uFB8B]/g, "ژ")
    .replace(/[\uFB50-\uFDF9\uFDFC\uFDFE-\uFDFF\uFE70-\uFEFF]+/g, (m) =>
      m.normalize("NFKC")
    );

  const lines = s.split(/\n+/);
  return lines
    .map((rawLine) => {
      const line = detectAndFixVisualRtlReversalServer(rawLine.trim());
      const rawTokens = line.split(/\s+/).filter(Boolean);
      if (rawTokens.length < 2) return line;
      const isSingle = (tk: string) =>
        SINGLE_LETTER_SERVER_REGEX.test(tk.replace(/[۔،؛؟!:"'«»﴿﴾\(\)\[\]]/g, ""));
      if (rawTokens.filter(isSingle).length < 2) {
        return detectAndFixVisualRtlReversalServer(rawTokens.join(" "));
      }

      const out: string[] = [];
      let i = 0;
      while (i < rawTokens.length) {
        if (isSingle(rawTokens[i])) {
          let j = i;
          while (j < rawTokens.length && isSingle(rawTokens[j])) j++;
          if (j - i === 1) {
            const ch = rawTokens[i];
            if (
              ch !== "و" &&
              out.length > 0 &&
              DUAL_JOINING_SERVER_REGEX.test(out[out.length - 1].slice(-1))
            ) {
              out[out.length - 1] += ch;
            } else {
              out.push(ch);
            }
            i++;
            continue;
          }
          const reconstructed = segmentLetterRunServer(rawTokens.slice(i, j));
          out.push(...reconstructed);
          i = j;
        } else {
          out.push(rawTokens[i]);
          i++;
        }
      }
      return detectAndFixVisualRtlReversalServer(out.join(" "));
    })
    .join("\n")
    .trim();
}

export function detectIsUrduScriptServer(text: string): boolean {
  const s = rejoinFragmentedUrduArabicLettersServer(text);
  if (!s) return false;
  const sUrNorm = s
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u0647/g, "\u06C1");
  const strictUrduChars = (s.match(/[ٹڈڑںےھپچژگ]/g) || []).length;
  const exclusiveUrduWords = (
    sUrNorm.match(
      /(?:^|\s)(?:کے|کی|کا|میں|ہے|ہیں|تھا|تھے|تھی|تھیں|اور|پر|سے|کو|نے|بھی|کیونکہ|لیکن|تاکہ|ہوتا|ہوتی|ہوتے|ہوئی|ہوئے|ہوگا|ہوگی|ہوں|کرتا|کرتے|کرتی|کیا|کیے|کئے|گیا|گئی|گئے|رہا|رہی|رہے|جائے|والا|والے|والی|لیے|لئے|ساتھ|بغیر|ذریعہ|ذریعے|تحت|متعلق|اندر|باہر|پہلے|فرمایا|فرماتے|وسوسے|آپ|اپنے|اپنی|اپنا|نہیں|کبھی|ایسے|جنہیں|سمجھنا|ہونا|چاہیے|چاہئے|سکتا|سکتے|سکتی|کیوں|کیسے|کہاں|یہاں|وہاں|معلومات|وضاحت|تعریف|رہنمائیاں|نشانیاں|بیماریاں|طریقے)(?=\s|$|[۔،؟!:])/g
    ) || []
  ).length;

  const arabicAlMatches = (
    s.match(/(?:^|\s)(?:ال|وال|بال|كال|فال|لل)[\u0621-\u064A\u0671-\u06D3]{2,}/g) || []
  ).length;
  const arabicMarkers = (
    s.match(
      /(?:^|\s)(?:الحمد|لله|للہ|رب|العالمين|العالمین|قال|رسول|النبي|صلى|صلی|وسلم|رضي|رضی|اللهم|أعوذ|اعوذ|بالله|باللہ|من|في|على|إلى|عن|مع|بين|عند|حتى|أن|إن|قد|لم|لن|لا|ما|هو|هي|هم|كان|كانت|ذلك|ذَلِكَ|ذلک|هذا|هذه|الذي|التي|الذين|صريح|صَرِيحُ|الإيمان|الْإِيمَانِ|كيف|کیف|تنقذ|نفسك|نفسک|ورطة|ورطۃ|الوسوسة|الوسوسۃ|إغاثة|القاعدة|الفقهية|الدعاء)(?=\s|$|[۔.،؛؟!:"'»﴾])/g
    ) || []
  ).length;
  const strictArabicChars = (s.match(/[ةإأؤئ]/g) || []).length;
  const tashkeelCount = (s.match(/[\u064B-\u0652\u0670]/g) || []).length;

  const urduScore = strictUrduChars * 2.5 + exclusiveUrduWords * 3.5;
  const arabicScore =
    arabicMarkers * 2.5 +
    arabicAlMatches * 2.5 +
    strictArabicChars * 1.5 +
    (tashkeelCount >= 3 ? 3 : 0);

  if (urduScore === 0) return false;
  if (exclusiveUrduWords >= 1 && strictUrduChars >= 1 && tashkeelCount < 4) {
    return true;
  }
  if (exclusiveUrduWords >= 2 && arabicAlMatches <= 1 && tashkeelCount < 4) {
    return true;
  }
  return urduScore >= arabicScore;
}

// Persistent Tesseract Worker Pool for fast server-side visual OCR with bounding boxes
let _tesseractWorkerPromise: Promise<any> | null = null;
async function getTesseractWorker() {
  if (!_tesseractWorkerPromise) {
    _tesseractWorkerPromise = Tesseract.createWorker("urd+ara").catch((err) => {
      _tesseractWorkerPromise = null;
      throw err;
    });
  }
  return _tesseractWorkerPromise;
}

// ─── 1. POST /api/reader/ocr-page — Nastaliq & Multilingual OCR via Gemini Vision + Tesseract.js Bounding-Box OCR ───
intelligentReaderRouter.post("/ocr-page", express.json({ limit: "18mb" }), async (req, res) => {
  try {
    const {
      imageBase64,
      mimeType = "image/jpeg",
      pageNumber = 1,
      imageWidth = 1190,
      imageHeight = 1684,
      rawPdfTextHint = "",
    } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 payload" });
    }

    const repairedHint = rejoinFragmentedUrduArabicLettersServer(String(rawPdfTextHint || ""));
    const cleanBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    // 1. Primary Vision Engine: Gemini Vision OCR (when GEMINI_API_KEY is configured)
    const ai = getAiClient();
    if (ai) {
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
6. قيّم جودة الاستخراج من 0 إلى 100.`;

      const ocrSchema = {
        type: Type.OBJECT,
        properties: {
          pageNumber: { type: Type.INTEGER },
          primaryLanguage: { type: Type.STRING },
          qualityScore: { type: Type.INTEGER },
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
                blockType: { type: Type.STRING },
                language: { type: Type.STRING },
                originalText: { type: Type.STRING },
                cleanedPronunciationText: { type: Type.STRING },
                surahNumber: { type: Type.INTEGER },
                ayahNumber: { type: Type.INTEGER },
                box2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
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
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
      ];
      let parsed: any = null;
      let usedModel = candidateModels[0];

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
          if (candidateJson && Array.isArray(candidateJson.blocks) && candidateJson.blocks.length > 0) {
            parsed = candidateJson;
            usedModel = modelName;
            break;
          }
        } catch {
          // Try next model
        }
      }

      if (parsed) {
        return res.json({
          ok: true,
          engine: usedModel,
          pageNumber,
          ...parsed,
        });
      }
    }

    // 2. Primary Local Visual OCR Engine: Server-side Tesseract.js (urd+ara) with Real Bounding Boxes
    try {
      const imgBuffer = Buffer.from(cleanBase64, "base64");
      const imgW = Math.max(100, Number(imageWidth) || 1190);
      const imgH = Math.max(100, Number(imageHeight) || 1684);

      const worker = await getTesseractWorker();
      const tessResult = await worker.recognize(imgBuffer, {}, { blocks: true, tsv: true });

      const structuredBlocks: any[] = [];
      const rawBlocks = Array.isArray(tessResult?.data?.blocks) ? tessResult.data.blocks : [];

      for (const blk of rawBlocks) {
        const paragraphs = Array.isArray(blk?.paragraphs) ? blk.paragraphs : [blk];
        for (const para of paragraphs) {
          const rawParaText = rejoinFragmentedUrduArabicLettersServer(para?.text || "")
            .replace(/[~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (rawParaText.length < 4 || !/[\u0600-\u06FF\u0750-\u077F]/.test(rawParaText)) {
            continue;
          }

          const bbox = para?.bbox || blk?.bbox;
          const ymin = bbox ? Math.max(0, Math.min(980, Math.round((bbox.y0 / imgH) * 1000))) : 80;
          const xmin = bbox ? Math.max(0, Math.min(980, Math.round((bbox.x0 / imgW) * 1000))) : 70;
          const ymax = bbox ? Math.max(ymin + 25, Math.min(995, Math.round((bbox.y1 / imgH) * 1000))) : 200;
          const xmax = bbox ? Math.max(xmin + 40, Math.min(995, Math.round((bbox.x1 / imgW) * 1000))) : 930;

          // Extract exact per-word bounding boxes from Tesseract lines -> words
          const lineItems: any[] = [];
          const paraLines = Array.isArray(para?.lines) ? para.lines : [];
          for (const ln of paraLines) {
            const lnWords = Array.isArray(ln?.words) ? ln.words : [];
            for (const wObj of lnWords) {
              const wStr = rejoinFragmentedUrduArabicLettersServer(wObj?.text || "").trim();
              if (!wStr || !/[\u0600-\u06FF\u0750-\u077F\w]/.test(wStr)) continue;
              const wb = wObj?.bbox;
              if (wb) {
                lineItems.push({
                  str: wStr,
                  normX: Math.max(0, Math.min(985, Math.round((wb.x0 / imgW) * 1000))),
                  normY: Math.max(0, Math.min(985, Math.round((wb.y0 / imgH) * 1000))),
                  normW: Math.max(12, Math.min(950, Math.round(((wb.x1 - wb.x0) / imgW) * 1000))),
                  normH: Math.max(16, Math.min(250, Math.round(((wb.y1 - wb.y0) / imgH) * 1000))),
                });
              }
            }
          }

          const isUr = detectIsUrduScriptServer(rawParaText);
          const cleanText = canonicalizeTextForLanguageServer(rawParaText, !isUr);

          structuredBlocks.push({
            blockType:
              structuredBlocks.length === 0 && cleanText.length < 75
                ? "heading"
                : ymin > 830
                ? "footnote"
                : isUr
                ? "urdu_body"
                : "arabic_quote",
            language: isUr ? "ur" : "ar",
            originalText: cleanText,
            cleanedPronunciationText: cleanText,
            surahNumber: 0,
            ayahNumber: 0,
            box2d: [ymin, xmin, ymax, xmax],
            lineItems: lineItems.length > 0 ? lineItems : undefined,
          });
        }
      }

      // If `data.blocks` was empty, fall back to splitting `tessResult.data.text`
      if (structuredBlocks.length === 0 && tessResult?.data?.text) {
        const rawOcrText = rejoinFragmentedUrduArabicLettersServer(tessResult.data.text || "");
        const ocrParagraphs = rawOcrText
          .split(/\n{2,}|\r\n{2,}/)
          .map((p) =>
            p
              .replace(/[~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          )
          .filter((p) => p.length > 3 && /[\u0600-\u06FF\u0750-\u077F]/.test(p));

        ocrParagraphs.forEach((para, idx) => {
          const isUr = detectIsUrduScriptServer(para);
          const cleanPara = canonicalizeTextForLanguageServer(para, !isUr);
          const yStart = Math.min(900, 70 + idx * Math.floor(820 / Math.max(1, ocrParagraphs.length)));
          const yEnd = Math.min(960, yStart + Math.max(45, Math.floor(780 / Math.max(1, ocrParagraphs.length))));
          structuredBlocks.push({
            blockType: idx === 0 && cleanPara.length < 75 ? "heading" : isUr ? "urdu_body" : "arabic_quote",
            language: isUr ? "ur" : "ar",
            originalText: cleanPara,
            cleanedPronunciationText: cleanPara,
            surahNumber: 0,
            ayahNumber: 0,
            box2d: [yStart, 70, yEnd, 930],
          });
        });
      }

      if (structuredBlocks.length > 0) {
        const urCount = structuredBlocks.filter((b) => b.language === "ur").length;
        return res.json({
          ok: true,
          engine: "tesseract-urd-ara-ocr",
          pageNumber,
          primaryLanguage: urCount >= structuredBlocks.length / 2 ? "ur" : "ar",
          qualityScore: Math.max(75, Math.round(tessResult?.data?.confidence || 84)),
          hasOcrWarnings: false,
          ocrWarningMessage: "",
          detectedAnomalies: [],
          blocks: structuredBlocks,
        });
      }
    } catch (tessErr: any) {
      console.warn("[DAR AL TAWHID Tesseract Fallback Warning]:", tessErr?.message || tessErr);
    }

    // 3. Last-resort fallback: Reconstruct from repaired PDF hint lines ONLY if image OCR yielded 0 blocks
    const hintLines = repairedHint
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 1 && scoreRtlPlausibilityServer(l).score >= 0);

    if (hintLines.length > 0) {
      const blocks = hintLines.map((line, idx) => {
        const isUr = detectIsUrduScriptServer(line);
        const cleanLine = canonicalizeTextForLanguageServer(line, !isUr);
        const yStart = Math.min(900, 80 + idx * Math.floor(800 / Math.max(1, hintLines.length)));
        const yEnd = Math.min(960, yStart + Math.max(40, Math.floor(750 / Math.max(1, hintLines.length))));
        return {
          blockType: idx === 0 && cleanLine.length < 70 ? "heading" : isUr ? "urdu_body" : "arabic_quote",
          language: isUr ? "ur" : "ar",
          originalText: cleanLine,
          cleanedPronunciationText: cleanLine,
          surahNumber: 0,
          ayahNumber: 0,
          box2d: [yStart, 70, yEnd, 930],
        };
      });
      const urCount = blocks.filter((b) => b.language === "ur").length;
      return res.json({
        ok: true,
        engine: "server-hint-recovery",
        pageNumber,
        primaryLanguage: urCount >= blocks.length / 2 ? "ur" : "ar",
        qualityScore: 82,
        hasOcrWarnings: false,
        ocrWarningMessage: "",
        detectedAnomalies: [],
        blocks,
      });
    }

    return res.json({
      pageNumber,
      primaryLanguage: "ar",
      qualityScore: 0,
      hasOcrWarnings: false,
      fallbackToRawText: true,
      blocks: [],
    });
  } catch (err: any) {
    console.error("[DAR AL TAWHID OCR Error]:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "OCR processing failed",
    });
  }
});

function charBigramDiceNoSpace(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const gramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    gramsA.set(g, (gramsA.get(g) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = gramsA.get(g) || 0;
    if (c > 0) {
      overlap++;
      gramsA.set(g, c - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function scoreNoSpaceMatch(inputNS: string, candNS: string): {
  score: number;
  containment: number;
  dice: number;
} {
  if (!inputNS || !candNS) return { score: 0, containment: 0, dice: 0 };
  if (inputNS === candNS) return { score: 1.0, containment: 1.0, dice: 1.0 };

  if (candNS.includes(inputNS) && inputNS.length >= 12) {
    const lenRatio = inputNS.length / Math.max(1, candNS.length);
    return {
      score: Math.min(0.99, 0.86 + 0.13 * lenRatio),
      containment: 1.0,
      dice: charBigramDiceNoSpace(inputNS, candNS),
    };
  }
  if (inputNS.includes(candNS) && candNS.length >= 12) {
    const lenRatio = candNS.length / Math.max(1, inputNS.length);
    return {
      score: Math.min(0.99, 0.84 + 0.15 * lenRatio),
      containment: 1.0,
      dice: charBigramDiceNoSpace(inputNS, candNS),
    };
  }

  const dice = charBigramDiceNoSpace(inputNS, candNS);
  const shorterLen = Math.min(inputNS.length, candNS.length);
  const longerLen = Math.max(inputNS.length, candNS.length);
  // Check ordered bigram containment of shorter string inside longer string
  const gramsLong = new Map<string, number>();
  const longer = inputNS.length >= candNS.length ? inputNS : candNS;
  const shorter = inputNS.length < candNS.length ? inputNS : candNS;
  for (let i = 0; i < longer.length - 1; i++) {
    const g = longer.slice(i, i + 2);
    gramsLong.set(g, (gramsLong.get(g) || 0) + 1);
  }
  let shortHits = 0;
  for (let i = 0; i < shorter.length - 1; i++) {
    const g = shorter.slice(i, i + 2);
    const c = gramsLong.get(g) || 0;
    if (c > 0) {
      shortHits++;
      gramsLong.set(g, c - 1);
    }
  }
  const containment = shorterLen >= 4 ? shortHits / Math.max(1, shorterLen - 1) : 0;
  const lengthBalance = shorterLen / Math.max(1, longerLen);
  const score =
    lengthBalance >= 0.6
      ? dice * 0.72 + containment * 0.28
      : containment >= 0.86 && shorterLen >= 16
      ? containment * 0.78 + dice * 0.22
      : dice * 0.65 + containment * 0.35;

  return { score, containment, dice };
}

function alignWrittenTokensToEntries(
  entries: FullQuranEntry[],
  normInputNS: string
): Array<{
  entry: FullQuranEntry;
  startWord0: number;
  endWord0: number;
  totalWords: number;
  isPartial: boolean;
}> {
  if (!entries || entries.length === 0) return [];
  const tokenFormsList = entries.map((e) => {
    const raw = e.rawTokens && e.rawTokens.length > 0 ? e.rawTokens : e.norm.split(" ").filter(Boolean);
    return raw.map((tk) => normalizeQuranOrthographicNoSpace(tk));
  });

  // Skip alignment if input text is empty or contains undecoded QCF PUA glyphs
  if (!normInputNS || normInputNS.length < 8 || /[\uFB50-\uFDCFڎڈژ]/.test(normInputNS)) {
    return entries.map((e, i) => {
      const total = tokenFormsList[i].length;
      return {
        entry: e,
        startWord0: 0,
        endWord0: Math.max(0, total - 1),
        totalWords: total,
        isPartial: false,
      };
    });
  }

  // Case 1: Single Ayah — detect strict partial prefix, suffix, or mid-ayah excerpt
  if (entries.length === 1) {
    const forms = tokenFormsList[0];
    const N = forms.length;
    if (N <= 1 || normInputNS.length >= entries[0].normNoSpace.length * 0.9) {
      return [
        {
          entry: entries[0],
          startWord0: 0,
          endWord0: Math.max(0, N - 1),
          totalWords: N,
          isPartial: false,
        },
      ];
    }

    // Cumulative char lengths for O(1) slice length checks
    const cumLens = new Array<number>(N + 1).fill(0);
    for (let i = 0; i < N; i++) {
      cumLens[i + 1] = cumLens[i] + forms[i].length;
    }

    let bestS = 0;
    let bestE = N - 1;
    let bestSc = -1;
    const minLen = Math.max(5, Math.floor(normInputNS.length * 0.65));
    const maxLen = Math.ceil(normInputNS.length * 1.45);

    for (let s = 0; s < N; s++) {
      for (let e = s; e < N; e++) {
        const spanCharLen = cumLens[e + 1] - cumLens[s];
        if (spanCharLen < minLen) continue;
        if (spanCharLen > maxLen) break;

        const spanNS = forms.slice(s, e + 1).join("");
        const m = scoreNoSpaceMatch(normInputNS, spanNS);
        const lenMatch =
          1 - Math.min(0.4, Math.abs(normInputNS.length - spanNS.length) / Math.max(12, normInputNS.length));
        const sc = m.score * 0.85 + lenMatch * 0.15;
        if (sc > bestSc) {
          bestSc = sc;
          bestS = s;
          bestE = e;
        }
      }
    }

    const isPartial =
      bestSc >= 0.78 &&
      (bestS > 0 || bestE < N - 1) &&
      bestE - bestS + 1 < N;

    return [
      {
        entry: entries[0],
        startWord0: isPartial ? bestS : 0,
        endWord0: isPartial ? bestE : Math.max(0, N - 1),
        totalWords: N,
        isPartial,
      },
    ];
  }

  // Case 2: Multi-Ayah Span — check if first ayah starts mid-ayah and/or last ayah ends mid-ayah
  const firstForms = tokenFormsList[0];
  const N0 = firstForms.length;
  let firstStart = 0;
  let firstScore = -1;
  let firstTailLen = entries[0].normNoSpace.length;

  for (let s = 0; s < N0; s++) {
    const tailNS = firstForms.slice(s).join("");
    if (tailNS.length < 4) break;
    if (tailNS.length > normInputNS.length + 6) continue;
    const prefixTarget = normInputNS.slice(0, Math.min(normInputNS.length, tailNS.length));
    const m = scoreNoSpaceMatch(prefixTarget, tailNS);
    const sc = m.score;
    if (sc > firstScore + 0.005) {
      firstScore = sc;
      firstStart = s;
      firstTailLen = tailNS.length;
    }
  }
  const firstIsPartial = firstScore >= 0.78 && firstStart > 0;
  const effectiveFirstStart = firstIsPartial ? firstStart : 0;
  const consumedFirstLen = firstIsPartial ? firstTailLen : entries[0].normNoSpace.length;

  const midLen = entries
    .slice(1, entries.length - 1)
    .reduce((acc, e) => acc + e.normNoSpace.length, 0);

  const lastIdx = entries.length - 1;
  const lastForms = tokenFormsList[lastIdx];
  const NL = lastForms.length;
  const estRemainStart = Math.max(0, consumedFirstLen + midLen);
  const remainNS = normInputNS.slice(Math.max(0, estRemainStart - 2));

  let lastEnd = NL - 1;
  let lastScore = -1;

  if (remainNS.length >= 4 && remainNS.length < entries[lastIdx].normNoSpace.length * 0.92) {
    for (let e = 0; e < NL; e++) {
      const headNS = lastForms.slice(0, e + 1).join("");
      if (headNS.length < 4) continue;
      if (headNS.length > remainNS.length + 8) break;
      const m = scoreNoSpaceMatch(remainNS, headNS);
      const lenMatch =
        1 - Math.min(0.4, Math.abs(remainNS.length - headNS.length) / Math.max(10, remainNS.length));
      const sc = m.score * 0.85 + lenMatch * 0.15;
      if (sc > lastScore) {
        lastScore = sc;
        lastEnd = e;
      }
    }
  }
  const lastIsPartial = lastScore >= 0.78 && lastEnd < NL - 1;
  const effectiveLastEnd = lastIsPartial ? lastEnd : Math.max(0, NL - 1);

  return entries.map((e, i) => {
    const N = tokenFormsList[i].length;
    if (i === 0) {
      return {
        entry: e,
        startWord0: effectiveFirstStart,
        endWord0: Math.max(0, N - 1),
        totalWords: N,
        isPartial: firstIsPartial,
      };
    }
    if (i === lastIdx) {
      return {
        entry: e,
        startWord0: 0,
        endWord0: effectiveLastEnd,
        totalWords: N,
        isPartial: lastIsPartial,
      };
    }
    return {
      entry: e,
      startWord0: 0,
      endWord0: Math.max(0, N - 1),
      totalWords: N,
      isPartial: false,
    };
  });
}

async function buildAyahPayload(
  entry: FullQuranEntry,
  reciter: string,
  everyAyahFolder: string,
  partialSpan?: { startWord0: number; endWord0: number; totalWords: number; isPartial: boolean }
) {
  let directUrl = buildEveryAyahUrl(entry.surahNumber, entry.ayahNumber, everyAyahFolder);
  const backupUrl = entry.globalAyahNumber
    ? buildIslamicNetworkAudioUrl(entry.globalAyahNumber, reciter)
    : directUrl;

  let isPartialClip = false;
  let clipStartMs = 0;
  let clipEndMs = 0;
  let partialWordCount = partialSpan?.isPartial
    ? Math.max(1, partialSpan.endWord0 - partialSpan.startWord0 + 1)
    : entry.rawTokens?.length || entry.tokens.length;
  let wordTimings: Array<{ wordIndex: number; startMs: number; endMs: number; confidence: string }> | undefined;

  if (partialSpan?.isPartial && partialSpan.totalWords > 0) {
    const qSegData = await getQuranComAyahSegments(entry.surahNumber, entry.ayahNumber, reciter);
    if (qSegData && qSegData.segments.length > 0 && qSegData.maxWordNum > 0) {
      const N = partialSpan.totalWords;
      const M = qSegData.maxWordNum;
      const mappedStart1 =
        M === N
          ? partialSpan.startWord0 + 1
          : Math.max(1, Math.min(M, Math.floor((partialSpan.startWord0 / N) * M) + 1));
      const mappedEnd1 =
        M === N
          ? partialSpan.endWord0 + 1
          : Math.max(
              mappedStart1,
              Math.min(M, Math.ceil(((partialSpan.endWord0 + 1) / N) * M))
            );

      const segByWord = new Map<number, { startMs: number; endMs: number }>();
      for (const s of qSegData.segments) {
        const prev = segByWord.get(s.wordNum);
        if (!prev) {
          segByWord.set(s.wordNum, { startMs: s.startMs, endMs: s.endMs });
        } else {
          segByWord.set(s.wordNum, {
            startMs: Math.min(prev.startMs, s.startMs),
            endMs: Math.max(prev.endMs, s.endMs),
          });
        }
      }

      const sliceSegs: Array<{ startMs: number; endMs: number }> = [];
      for (let w1 = mappedStart1; w1 <= mappedEnd1; w1++) {
        const found = segByWord.get(w1);
        if (found) sliceSegs.push(found);
      }

      if (sliceSegs.length > 0) {
        directUrl = qSegData.audioUrl;
        isPartialClip = true;
        clipStartMs =
          partialSpan.startWord0 === 0
            ? 0
            : Math.max(0, sliceSegs[0].startMs - 55);
        clipEndMs =
          partialSpan.endWord0 >= N - 1
            ? 0
            : sliceSegs[sliceSegs.length - 1].endMs + 115;

        const targetTokenSlice = (entry.rawTokens || []).slice(
          partialSpan.startWord0,
          partialSpan.endWord0 + 1
        );
        if (targetTokenSlice.length > 0) {
          wordTimings = targetTokenSlice.map((_, i) => {
            const segIdx = Math.min(
              sliceSegs.length - 1,
              Math.floor((i / targetTokenSlice.length) * sliceSegs.length)
            );
            return {
              wordIndex: i,
              startMs: sliceSegs[segIdx].startMs,
              endMs: sliceSegs[segIdx].endMs,
              confidence: "quran-com-segments",
            };
          });
        }
      }
    }
  }

  return {
    surahNumber: entry.surahNumber,
    surahName: entry.surahNameAr,
    ayahNumber: entry.ayahNumber,
    globalAyahNumber: entry.globalAyahNumber,
    uthmaniText: entry.text,
    normalizedWordCount: partialWordCount,
    partialWordCount,
    isPartialClip,
    clipStartMs,
    clipEndMs,
    wordTimings,
    reciterId: reciter,
    audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
    directAudioUrl: directUrl,
    backupAudioUrl: backupUrl,
  };
}

async function buildVerifiedResponseFromEntries(
  entries: FullQuranEntry[],
  reciter: string,
  everyAyahFolder: string,
  confidence: number,
  normInputNS = ""
) {
  const first = entries[0];
  const last = entries[entries.length - 1];
  const spans = alignWrittenTokensToEntries(entries, normInputNS);
  const ayahList = await Promise.all(
    entries.map((e, idx) => buildAyahPayload(e, reciter, everyAyahFolder, spans[idx]))
  );
  const primary = ayahList[0];
  return {
    verified: true,
    confidence: Number(confidence.toFixed(3)),
    surahNumber: first.surahNumber,
    surahName: first.surahNameAr,
    ayahNumber: first.ayahNumber,
    endAyahNumber: last.ayahNumber,
    globalAyahNumber: first.globalAyahNumber,
    uthmaniText: entries.map((e) => e.text).join(" ۝ "),
    reciterId: reciter,
    audioUrl: primary.audioUrl,
    directAudioUrl: primary.directAudioUrl,
    backupAudioUrl: primary.backupAudioUrl,
    ayahList,
  };
}

function maybeFlipRtlDigits(num: number, maxAllowed: number): number[] {
  if (!num || num <= 0) return [];
  const candidates = [num];
  if (num >= 10 && num <= 999) {
    const rev = Number(String(num).split("").reverse().join(""));
    if (rev > 0 && rev !== num && rev <= maxAllowed) {
      candidates.push(rev);
    }
  }
  return candidates.filter((n) => n >= 1 && n <= maxAllowed);
}

async function verifySingleQuranVerse(params: {
  text?: string;
  surahHint?: number;
  ayahHint?: number;
  endAyahHint?: number;
  hasQuranBrackets?: boolean;
  isQcfMushaf?: boolean;
  reciter?: string;
}) {
  const reciter = String(params.reciter || "ar.saoodshuraym");
  const everyAyahFolder =
    RECITER_FOLDER_MAP[reciter] || "Saood_ash-Shuraym_128kbps";

  const store = await getFullQuranIndex();
  const rawText = String(params.text || "").trim();
  const rawNoTash = rawText.replace(/[\u064B-\u065F\u0670]/g, "");
  const hasBrackets =
    Boolean(params.hasQuranBrackets) ||
    rawText.includes("﴿") ||
    rawText.includes("﴾");
  const isQcfMushaf = Boolean(params.isQcfMushaf);

  // Guard unbracketed quotes so author duas, Hadiths, TOC & bibliography items are NEVER misclassified as Quran
  if (!hasBrackets && !isQcfMushaf) {
    const isExcludedNonQuran =
      /[«»]/.test(rawText) ||
      /^\s*[٠-٩۰-۹\d]{1,3}\s*[-–—۔.]/.test(rawNoTash) ||
      /(?:وآخر\s+دعوانا|وصلى\s+الله\s+وسلم\s+على\s+نبينا|الصلاة\s+والسلام\s+على|أشرف\s+الأنبياء\s+والمرسلين|مدارج\s+السالكين|الناشر\s*:|عدد\s+الأجزاء)/.test(
        rawNoTash
      ) ||
      /^(?:حدثنا|أخبرنا|عن\s|رواه|أخرجه|متفق\s+عليه|قال\s+رسول\s+الله|قال\s+النبي|اللهم)/.test(
        rawNoTash
      );
    if (isExcludedNonQuran) {
      return {
        verified: false,
        confidence: 0,
        reason: "Excluded non-Quranic quote (Hadith, Dua, TOC, or Bibliography).",
      };
    }
  }

  const normInput = normalizeArabicForQuranMatch(rawText);
  const normInputNS = normalizeQuranOrthographicNoSpace(normInput);
  const sHint = Number(params.surahHint || 0);
  const aHintRaw = Number(params.ayahHint || 0);
  const eHintRaw = Number(params.endAyahHint || 0);

  // 1. If Footnote Citation or Inline [Surah: Ayah] provided:
  if (sHint >= 1 && sHint <= 114 && aHintRaw >= 1) {
    const maxAy = store.surahMaxAyah.get(sHint) || 300;
    const startCandidates = maybeFlipRtlDigits(aHintRaw, maxAy);

    // For undecoded King Fahd Mushaf QCF glyphs (e.g., P24 [غافر: ٦٥]), resolve directly to authentic Uthmani verse(s)
    if (isQcfMushaf) {
      const qcfStart = startCandidates[0] || aHintRaw;
      const qcfEnd =
        eHintRaw > qcfStart && eHintRaw <= maxAy && eHintRaw - qcfStart <= 10
          ? eHintRaw
          : qcfStart;
      const qcfSlice: FullQuranEntry[] = [];
      for (let a = qcfStart; a <= qcfEnd; a++) {
        const idx = store.byKey.get(`${sHint}:${a}`);
        if (idx !== undefined) qcfSlice.push(store.ayahs[idx]);
      }
      if (qcfSlice.length > 0) {
        return await buildVerifiedResponseFromEntries(
          qcfSlice,
          reciter,
          everyAyahFolder,
          0.99,
          ""
        );
      }
    }

    let bestHintSlice: FullQuranEntry[] | null = null;
    let bestHintScore = -1;

    for (const st of startCandidates) {
      const ends = [st];
      if (eHintRaw > 0 && eHintRaw !== aHintRaw) {
        const endCandidates = maybeFlipRtlDigits(eHintRaw, maxAy);
        for (const en of endCandidates) {
          if (en >= st && en - st <= 10 && !ends.includes(en)) {
            ends.push(en);
          }
        }
      }

      for (const en of ends) {
        const slice: FullQuranEntry[] = [];
        for (let a = st; a <= en; a++) {
          const idx = store.byKey.get(`${sHint}:${a}`);
          if (idx !== undefined) slice.push(store.ayahs[idx]);
        }
        if (slice.length === 0) continue;

        if (!normInputNS || normInputNS.length < 8) {
          if (bestHintSlice === null) {
            bestHintSlice = slice;
            bestHintScore = 0.92;
          }
          continue;
        }

        const joinedNS = slice.map((e) => e.normNoSpace).join("");
        const m = scoreNoSpaceMatch(normInputNS, joinedNS);
        const lenDiffBonus =
          1 - Math.min(0.4, Math.abs(normInputNS.length - joinedNS.length) / Math.max(20, normInputNS.length, joinedNS.length));
        const sc = m.score * 0.88 + lenDiffBonus * 0.12;
        if (sc > bestHintScore) {
          bestHintScore = sc;
          bestHintSlice = slice;
        }
      }
    }

    const bestHintJoinedLen = bestHintSlice
      ? bestHintSlice.reduce((acc, e) => acc + e.normNoSpace.length, 0)
      : 0;
    const hintCoversFullInput =
      bestHintJoinedLen === 0 || normInputNS.length <= bestHintJoinedLen * 1.22;
    const hintThreshold =
      normInputNS.length < 18 ? (hasBrackets ? 0.45 : 0.65) : 0.86;
    if (bestHintSlice && bestHintScore >= hintThreshold && hintCoversFullInput) {
      return await buildVerifiedResponseFromEntries(
        bestHintSlice,
        reciter,
        everyAyahFolder,
        Math.min(1.0, Math.max(0.9, bestHintScore)),
        normInputNS
      );
    }
  }

  if (!normInputNS || normInputNS.length < 8) {
    return { verified: false, confidence: 0, reason: "Text too short for strict Quran verification" };
  }

  // 2. Full 6,236-Ayah Local Inverted-Token + Character-4gram Search
  const candidateScores = new Map<number, number>();
  const inputTokens = normInput.split(" ").filter((w) => w.length >= 3);

  for (const tk of inputTokens) {
    const list = store.wordIndex.get(tk);
    if (!list) continue;
    // Rare words weigh much higher than common words ("الله", "الذين", "من")
    const weight = list.length <= 5 ? 6 : list.length <= 30 ? 3.5 : list.length <= 150 ? 1.5 : 0.4;
    for (const ayIdx of list) {
      candidateScores.set(ayIdx, (candidateScores.get(ayIdx) || 0) + weight);
    }
  }

  // 4-gram fallback for PDFs with split Arabic words (e.g. "السيِ ئات", "ذ لِك")
  if (normInputNS.length >= 8) {
    const step = normInputNS.length > 90 ? 4 : 2;
    for (let k = 0; k <= normInputNS.length - 4; k += step) {
      const g4 = normInputNS.slice(k, k + 4);
      const list = store.gram4Index.get(g4);
      if (!list || list.length > 180) continue;
      const gWeight = list.length <= 12 ? 1.8 : 0.6;
      for (const ayIdx of list) {
        candidateScores.set(ayIdx, (candidateScores.get(ayIdx) || 0) + gWeight);
      }
    }
  }

  // Rank top 40 candidate Ayah positions (+ prioritize sHint surah if given)
  const rankedStartIndices = [...candidateScores.entries()]
    .map(([idx, rawSc]) => {
      const bonus = sHint > 0 && store.ayahs[idx]?.surahNumber === sHint ? 4.0 : 0;
      return { idx, sc: rawSc + bonus };
    })
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 40)
    .map((x) => x.idx);

  // Also include exact `normNoSpace` containment scan when short/partial verse wasn't caught cleanly by tokens
  if (rankedStartIndices.length === 0 && normInputNS.length >= 12) {
    for (let i = 0; i < store.ayahs.length; i++) {
      const aNS = store.ayahs[i].normNoSpace;
      if (aNS.includes(normInputNS) || normInputNS.includes(aNS)) {
        rankedStartIndices.push(i);
        if (rankedStartIndices.length >= 15) break;
      }
    }
  }

  let bestSlice: FullQuranEntry[] | null = null;
  let bestCombinedScore = 0;
  let bestContainment = 0;

  for (const startIdx of rankedStartIndices) {
    const startEntry = store.ayahs[startIdx];
    if (!startEntry) continue;

    // Try single ayah AND multi-ayah spans (1..6 consecutive ayahs in the same Surah)
    let accumNS = "";
    const span: FullQuranEntry[] = [];
    for (let k = 0; k < 6; k++) {
      const curr = store.ayahs[startIdx + k];
      if (!curr || curr.surahNumber !== startEntry.surahNumber) break;
      span.push(curr);
      accumNS += curr.normNoSpace;

      const m = scoreNoSpaceMatch(normInputNS, accumNS);

      // True minimal multi-ayah span check: e.g. end of ayah N + start/all of ayah N+1 (like 39:2-3 or 76:11-12)
      let isMinimalMultiAyahContainment = false;
      if (k > 0 && accumNS.includes(normInputNS)) {
        const firstTail = span[0].normNoSpace.slice(-Math.min(6, span[0].normNoSpace.length));
        const lastHead = curr.normNoSpace.slice(0, Math.min(6, curr.normNoSpace.length));
        const withoutLast = accumNS.slice(0, accumNS.length - curr.normNoSpace.length);
        const withoutFirst = accumNS.slice(span[0].normNoSpace.length);
        if (
          !withoutLast.includes(normInputNS) &&
          !withoutFirst.includes(normInputNS) &&
          normInputNS.includes(firstTail) &&
          normInputNS.includes(lastHead)
        ) {
          isMinimalMultiAyahContainment = true;
        }
      }

      // Penalize adding extra ayahs that go well beyond normInputNS length (unless truly minimal contiguous span)
      const overshootPenalty = isMinimalMultiAyahContainment
        ? 0
        : k > 0 && accumNS.length > normInputNS.length * 1.25
        ? Math.min(0.25, (accumNS.length - normInputNS.length * 1.25) / Math.max(40, accumNS.length))
        : 0;
      const multiAyahBonus = isMinimalMultiAyahContainment ? 0.06 : 0;
      const finalScore = isMinimalMultiAyahContainment
        ? Math.max(m.score, 0.975)
        : m.score - overshootPenalty + multiAyahBonus;

      if (finalScore > bestCombinedScore) {
        bestCombinedScore = finalScore;
        bestContainment = m.containment;
        bestSlice = [...span];
      }

      // Stop extending span once accumulated text is well past the input text length (after checking at least 2 consecutive ayahs for cross-ayah excerpts like 65:2-3)
      if (k >= 1 && accumNS.length >= normInputNS.length * 1.35 && !accumNS.includes(normInputNS)) break;
      if (isMinimalMultiAyahContainment) break;
    }
  }

  // Strict precision gate:
  // - Inside explicit Quran brackets ﴿...﴾: accept >= 0.64 (handles OCR noise / split cross-page fragments / multi-ayah spans)
  // - Unbracketed Arabic quote candidate: require very strict >= 0.86 AND at least 18 chars so Hadiths NEVER match falsely!
  const threshold = hasBrackets ? 0.64 : 0.86;
  const minChars = hasBrackets ? 8 : 18;

  if (
    bestSlice &&
    normInputNS.length >= minChars &&
    (bestCombinedScore >= threshold || (hasBrackets && bestContainment >= 0.86 && normInputNS.length >= 12))
  ) {
    const conf = Math.min(0.999, Math.max(bestCombinedScore, bestContainment * 0.96));
    return await buildVerifiedResponseFromEntries(bestSlice, reciter, everyAyahFolder, conf, normInputNS);
  }

  // 3. Final live fallback via AlQuran.cloud search API ONLY when offline index didn't resolve & input has >= 3 words
  try {
    const searchWords = normInput
      .split(" ")
      .filter((w) => w.length >= 3)
      .slice(0, 5)
      .join(" ");
    if (searchWords.length >= 8) {
      const searchUrl = `https://api.alquran.cloud/v1/search/${encodeURIComponent(searchWords)}/all/quran-simple-clean`;
      const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4500) });
      if (sRes.ok) {
        const sData: any = await sRes.json();
        const matches = sData?.data?.matches || [];
        for (const m of matches) {
          const normMatch = normalizeArabicForQuranMatch(m.text || "");
          const normMatchNS = normalizeQuranOrthographicNoSpace(normMatch);
          const sc = scoreNoSpaceMatch(normInputNS, normMatchNS);
          if (sc.score >= 0.74 || (hasBrackets && sc.containment >= 0.85)) {
            const sNum = Number(m.surah?.number);
            const aNum = Number(m.numberInSurah);
            const gNum = Number(m.number);
            if (sNum && aNum) {
              const rawTokens = normMatch.split(" ").filter(Boolean);
              const entry: FullQuranEntry = {
                surahNumber: sNum,
                surahNameAr: m.surah?.name || `سورة ${sNum}`,
                ayahNumber: aNum,
                globalAyahNumber: gNum || 0,
                text: m.text,
                norm: normMatch,
                normNoSpace: normMatchNS,
                tokens: rawTokens.filter((w) => w.length >= 2),
                rawTokens,
              };
              return await buildVerifiedResponseFromEntries([entry], reciter, everyAyahFolder, 0.93, normInputNS);
            }
          }
        }
      }
    }
  } catch {
    // Ignore network search failure
  }

  return {
    verified: false,
    confidence: Number(bestCombinedScore.toFixed(3)),
    reason: "Ayah not verified with 100% certainty; refusing to guess recording.",
  };
}

// ─── 2. POST /api/reader/verify-quran — Authentic Quranic Verse Verification (Full 6,236-Ayah Engine) ───
intelligentReaderRouter.post("/verify-quran", express.json({ limit: "512kb" }), async (req, res) => {
  try {
    const {
      text,
      surahHint,
      ayahHint,
      endAyahHint,
      hasQuranBrackets,
      isQcfMushaf,
      reciter = "ar.saoodshuraym",
    } = req.body || {};

    const result = await verifySingleQuranVerse({
      text,
      surahHint,
      ayahHint,
      endAyahHint,
      hasQuranBrackets,
      isQcfMushaf,
      reciter,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ verified: false, error: err?.message || "Verification error" });
  }
});

// ─── 2b. POST /api/reader/verify-quran-batch — Single-Round-Trip Batch Verification for Entire Page ───
intelligentReaderRouter.post("/verify-quran-batch", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { items = [], reciter = "ar.saoodshuraym" } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: "Expected items array" });
    }
    const capped = items.slice(0, 60);
    const results = await Promise.all(
      capped.map(async (item: any, idx: number) => {
        const verified = await verifySingleQuranVerse({
          text: item?.text,
          surahHint: item?.surahHint,
          ayahHint: item?.ayahHint,
          endAyahHint: item?.endAyahHint,
          hasQuranBrackets: item?.hasQuranBrackets,
          isQcfMushaf: Boolean(item?.isQcfMushaf),
          reciter: item?.reciter || reciter,
        });
        return {
          id: item?.id ?? idx,
          ...verified,
        };
      })
    );
    return res.json({ ok: true, results });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Batch verification error" });
  }
});

// ─── 3. GET /api/reader/quran-audio — Cached & CORS-Safe Sudais Quran Recitation Proxy ───
const quranAudioLruCache = new Map<string, { contentType: string; buf: Buffer }>();
const MAX_QURAN_AUDIO_LRU = 120;

intelligentReaderRouter.get("/quran-audio", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl || !/^https:\/\/(everyayah\.com|cdn\.islamic\.network|verses\.quran\.com|audio\.qurancdn\.com)\//i.test(rawUrl)) {
      return res.status(400).send("Invalid Quran audio CDN URL");
    }

    const cached = quranAudioLruCache.get(rawUrl);
    if (cached) {
      // Refresh LRU position
      quranAudioLruCache.delete(rawUrl);
      quranAudioLruCache.set(rawUrl, cached);
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.setHeader("X-Audio-Cache", "HIT");
      return res.send(cached.buf);
    }

    const upstream = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Upstream audio unavailable");
    }
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 256) {
      if (quranAudioLruCache.size >= MAX_QURAN_AUDIO_LRU) {
        const oldestKey = quranAudioLruCache.keys().next().value;
        if (oldestKey) quranAudioLruCache.delete(oldestKey);
      }
      quranAudioLruCache.set(rawUrl, { contentType, buf });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Audio-Cache", "MISS");
    return res.send(buf);
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
    const wavHeader = Buffer.alloc(44);
    const byteRate = effectiveSampleRate * 2;
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36 + pcmBuf.length, 4);
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(effectiveSampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write("data", 36);
    wavHeader.writeUInt32LE(pcmBuf.length, 40);
    wavBuf = Buffer.concat([wavHeader, pcmBuf]);
  }

  const frameSamples = Math.floor(effectiveSampleRate * 0.02);
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

  const weights = words.map((w) => {
    const clean = w.replace(/[^\u0600-\u06FF\u0750-\u077F\w]/g, "");
    const longVowels = (clean.match(/[اويىےآ]/g) || []).length;
    const hasPausePunct = /[،؛,.؟!۔:]/.test(w);
    return Math.max(1.2, clean.length * 0.85 + longVowels * 0.55 + (hasPausePunct ? 2.4 : 0));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const wordTimings: Array<{ word: string; wordIndex: number; startMs: number; endMs: number; confidence: string }> = [];
  let cursorMs = speechStartMs;
  let accWeight = 0;

  for (let i = 0; i < words.length; i++) {
    accWeight += weights[i];
    const targetEndMs =
      i === words.length - 1
        ? speechEndMs
        : speechStartMs + Math.round((accWeight / totalWeight) * activeDurationMs);

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

export interface TtsProsodyOptions {
  preset?: "scholarly" | "measured" | "narrative" | string;
  enabled?: boolean;
  arabicTashkeel?: boolean;
  urduProofread?: boolean;
  hadithRateDelta?: number;
  pitchDeltaHz?: number;
}

function canonicalizeShaddaOrderServer(text: string): string {
  return String(text || "")
    .replace(/\s+([\u064B-\u065F\u0670]+)/g, "$1")
    .replace(/([\u064B-\u0650\u0652\u0670]+)\u0651/g, "\u0651$1")
    .replace(/([\u064B-\u0652\u0670])\1+/g, "$1")
    .replace(/ا([\u064B-\u0652]*)\u0654/g, "أ$1")
    .replace(/ا([\u064B-\u0652]*)\u0655/g, "إ$1");
}

/**
 * Arabic Tashkeel Normalization & Scholarly Vocalization Proofreading for TTS:
 * - Preserves author wording while fixing decomposed/misordered diacritics and expanding honorifics
 *   with complete Classical Arabic vocalization (tashkeel) so `ar-SA-HamedNeural` articulates clearly.
 */
export function proofreadArabicTashkeelForTts(text: string, segmentType = "arabic_quote"): string {
  if (!text) return "";
  let s = canonicalizeShaddaOrderServer(canonicalizeTextForLanguageServer(text, true));

  // Normalize common unvocalized or typoed Islamic honorifics, Hadith chains & scholarly expressions
  s = s
    .replace(/ﷺ/g, " صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ ")
    .replace(/ﷻ/g, " جَلَّ جَلَالُهُ ")
    .replace(/(?:^|\s)صلى\s+الله\s+عليه\s+وسلم(?=\s|$|[۔.،؛؟!:])/g, " صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ")
    .replace(/(?:^|\s)عز\s+وجل(?=\s|$|[۔.،؛؟!:])/g, " عَزَّ وَجَلَّ")
    .replace(/(?:^|\s)رضي\s+الله\s+عنهما(?=\s|$|[۔.،؛؟!:])/g, " رَضِيَ اللَّهُ عَنْهُمَا")
    .replace(/(?:^|\s)رضي\s+الله\s+عنهم(?=\s|$|[۔.،؛؟!:])/g, " رَضِيَ اللَّهُ عَنْهُمْ")
    .replace(/(?:^|\s)رضي\s+الله\s+عنها(?=\s|$|[۔.،؛؟!:])/g, " رَضِيَ اللَّهُ عَنْهَا")
    .replace(/(?:^|\s)رضي\s+الله\s+عنه(?=\s|$|[۔.،؛؟!:])/g, " رَضِيَ اللَّهُ عَنْهُ")
    .replace(/(?:^|\s)رحمه\s+الله(?=\s|$|[۔.،؛؟!:])/g, " رَحِمَهُ اللَّهُ")
    .replace(/(?:^|\s)رحمهم\s+الله(?=\s|$|[۔.،؛؟!:])/g, " رَحِمَهُمُ اللَّهُ")
    .replace(/(?:^|\s)عليه\s+السلام(?=\s|$|[۔.،؛؟!:])/g, " عَلَيْهِ السَّلَامُ")
    .replace(/(?:^|\s)عليها\s+السلام(?=\s|$|[۔.،؛؟!:])/g, " عَلَيْهَا السَّلَامُ")
    .replace(/(?:^|\s)عليهم\s+السلام(?=\s|$|[۔.،؛؟!:])/g, " عَلَيْهِمُ السَّلَامُ")
    .replace(/(?:^|\s)سبحانه\s+وتعالى(?=\s|$|[۔.،؛؟!:])/g, " سُبْحَانَهُ وَتَعَالَى")
    .replace(/(?:^|\s)أما\s+بعد(?=\s|$|[۔.،؛؟!:])/g, " أَمَّا بَعْدُ")
    .replace(/وآخر\s+دعوانا\s+أن\s+الحمد\s+لله\s+رب\s+العالمين/g, "وَآخِرُ دَعْوَانَا أَنِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ")
    .replace(/وصلى\s+الله\s+(?:وسلم\s+)?على\s+نبينا\s+محمد/g, "وَصَلَّى اللَّهُ وَسَلَّمَ عَلَى نَبِيِّنَا مُحَمَّدٍ")
    .replace(/إن\s+شاء\s+الله/g, "إِنْ شَاءَ اللَّهُ")
    .replace(/بسم\s+الله\s+الرحمن\s+الرحيم/g, "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ")
    .replace(/الحمد\s+لله\s+رب\s+العالمين/g, "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ")
    .replace(/إنما\s+الأعمال\s+بالنيات/g, "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ")
    .replace(/(?:^|\s)متفق\s+عليه(?=\s|$|[۔.،؛؟!:])/g, " مُتَّفَقٌ عَلَيْهِ")
    .replace(/(?:^|\s)رواه\s+البخاري(?=\s|$|[۔.،؛؟!:])/g, " رَوَاهُ الْبُخَارِيُّ")
    .replace(/(?:^|\s)رواه\s+مسلم(?=\s|$|[۔.،؛؟!:])/g, " رَوَاهُ مُسْلِمٌ")
    .replace(/(?:^|\s)أخرجه\s+البخاري(?=\s|$|[۔.،؛؟!:])/g, " أَخْرَجَهُ الْبُخَارِيُّ")
    .replace(/(?:^|\s)أخرجه\s+مسلم(?=\s|$|[۔.،؛؟!:])/g, " أَخْرَجَهُ مُسْلِمٌ")
    .replace(/سبحان\s+الله/g, "سُبْحَانَ اللَّهِ")
    .replace(/أعوذ\s+بالله/g, "أَعُوذُ بِاللَّهِ")
    .replace(/بإذن\s+الله/g, "بِإِذْنِ اللَّهِ")
    .replace(/في\s+سبيل\s+الله/g, "فِي سَبِيلِ اللَّهِ")
    .replace(/(?:^|\s)صريح\s+الإيمان(?=\s|$|[۔.،؛؟!:])/g, " صَرِيحُ الْإِيمَانِ")
    .replace(/(?:^|\s)الوسوسة(?=\s|$|[۔.،؛؟!:])/g, " الْوَسْوَسَة");

  if (segmentType === "heading") {
    s = s.replace(/^([٠-٩\d]+)\s*[-–—.]\s*/g, "$1، ");
  }

  // Add subtle prosodic comma pause after prophetic attribution / colon in Hadith, Quran & Dua segments
  if (segmentType === "hadith" || segmentType === "dua" || segmentType === "quran") {
    s = s.replace(/\s*[:：]\s*/g, "، ");
  }

  return s.replace(/\s+/g, " ").replace(/\s+([،؛.؟!])/g, "$1").trim();
}

/**
 * Urdu Linguistic Proofreading for TTS:
 * - Fixes canonical Pakistani Urdu glyphs (ک/ی/ہ + preserves diacritics like کِبر / لُغت / ذکرِ الٰہی),
 *   expands honorifics cleanly in Pakistani Urdu articulation, and adds rhythmic comma phrasing.
 */
export function proofreadUrduLinguisticForTts(text: string): string {
  if (!text) return "";
  let s = canonicalizeShaddaOrderServer(canonicalizeTextForLanguageServer(text, false));

  s = s
    .replace(/^([٠-٩۰-۹\d]+)\s*[۔.]\s*/g, "$1، ")
    .replace(/ا(اللہ|الله)/g, "اللہ")
    .replace(/ﷺ/g, " صلی اللہ علیہ وسلم ")
    .replace(/ﷻ/g, " جل جلالہ ")
    .replace(/صلى\s+الله\s+عليه\s+وسلم/g, "صلی اللہ علیہ وسلم")
    .replace(/رضي\s+الله\s+عنهم/g, "رضی اللہ عنہم")
    .replace(/رضي\s+الله\s+عنها/g, "رضی اللہ عنہا")
    .replace(/رضي\s+الله\s+عنه/g, "رضی اللہ عنہ")
    .replace(/رحمه\s+الله/g, "رحمہ اللہ")
    .replace(/عليه\s+السلام/g, "علیہ السلام")
    .replace(/(^|\s)تعالی(?=\s|$|[۔.،؛؟!:])/g, "$1تعالیٰ")
    .replace(/(^|\s)لہذا(?=\s|$|[۔.،؛؟!:])/g, "$1لہٰذا")
    .replace(/(^|\s)مثلا(?=\s|$|[۔.،؛؟!:])/g, "$1مثلاً")
    .replace(/(^|\s)عموما(?=\s|$|[۔.،؛؟!:])/g, "$1عموماً")
    .replace(/(^|\s)خصوصا(?=\s|$|[۔.،؛؟!:])/g, "$1خصوصاً")
    .replace(/(^|\s)فورا(?=\s|$|[۔.،؛؟!:])/g, "$1فوراً")
    .replace(/(^|\s)تقریبا(?=\s|$|[۔.،؛؟!:])/g, "$1تقریباً")
    .replace(/(^|\s)یقینا(?=\s|$|[۔.،؛؟!:])/g, "$1یقیناً")
    .replace(/(^|\s)ان\s+شاء\s+اللہ(?=\s|$|[۔.،؛؟!:])/g, "$1ان شاء اللہ")
    .replace(/(^|\s)ما\s+شاء\s+اللہ(?=\s|$|[۔.،؛؟!:])/g, "$1ما شاء اللہ")
    .replace(/(^|\s)پیش\s+اب(?=\s|$|[۔.،؛؟!:])/g, "$1پیشاب")
    .replace(/(^|\s)کے\s+لئے(?=\s|$|[۔.،؛؟!:])/g, "$1کے لیے")
    .replace(/\s*[:：]\s*/g, "، ");

  return s.replace(/\s+/g, " ").replace(/\s+([۔،؛.؟!])/g, "$1").trim();
}

function parsePercentDelta(val?: string): number {
  const m = String(val || "0%").match(/([+-]?\d+)/);
  return m ? Number(m[1]) : 0;
}

function parseHzDelta(val?: string): number {
  const m = String(val || "0Hz").match(/([+-]?\d+)/);
  return m ? Number(m[1]) : 0;
}

export function resolveSegmentProsodyConfig(
  baseCfg: { voice: string; rate?: string; pitch?: string },
  segmentType: string,
  prosody?: TtsProsodyOptions
): {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  preset: string;
  ratePercent: number;
  pitchHz: number;
} {
  let rateNum = parsePercentDelta(baseCfg.rate);
  let pitchNum = parseHzDelta(baseCfg.pitch);
  const enabled = prosody?.enabled !== false;
  const preset =
    prosody?.preset === "measured" || prosody?.preset === "narrative"
      ? prosody.preset
      : "scholarly";

  const customHadithRate = Number(prosody?.hadithRateDelta);
  const customPitchHz = Number(prosody?.pitchDeltaHz);
  const hasCustomHadithRate = Number.isFinite(customHadithRate);
  const hasCustomPitch = Number.isFinite(customPitchHz);

  if (enabled) {
    if (segmentType === "hadith") {
      rateNum += hasCustomHadithRate ? Math.max(-10, Math.min(4, customHadithRate)) : -3;
      pitchNum += hasCustomPitch ? Math.max(-4, Math.min(2, customPitchHz)) : -1;
    } else if (segmentType === "quran") {
      rateNum += hasCustomHadithRate ? Math.max(-10, Math.min(4, customHadithRate)) - 3 : -6;
      pitchNum += hasCustomPitch ? Math.max(-4, Math.min(2, customPitchHz)) : -1;
    } else if (segmentType === "dua") {
      rateNum += hasCustomHadithRate ? Math.max(-10, Math.min(4, customHadithRate)) - 2 : -5;
      pitchNum += hasCustomPitch ? Math.max(-4, Math.min(2, customPitchHz)) : -1;
    } else if (segmentType === "arabic_quote") {
      rateNum -= 1;
      if (hasCustomPitch) pitchNum += Math.round(Math.max(-4, Math.min(2, customPitchHz)) / 2);
    } else if (segmentType === "heading") {
      rateNum += 1;
      pitchNum += 1;
    } else if (hasCustomPitch) {
      pitchNum += Math.round(Math.max(-4, Math.min(2, customPitchHz)) / 2);
    }

    if (preset === "measured") {
      rateNum -= 5;
      pitchNum -= 1;
    } else if (preset === "narrative") {
      rateNum += 5;
      pitchNum += 0;
    }
  } else {
    rateNum = 0;
    pitchNum = 0;
  }

  const clampedRate = Math.max(-25, Math.min(15, rateNum));
  const clampedPitch = Math.max(-7, Math.min(4, pitchNum));

  return {
    voice: baseCfg.voice,
    rate: `${clampedRate >= 0 ? "+" : ""}${clampedRate}%`,
    pitch: `${clampedPitch >= 0 ? "+" : ""}${clampedPitch}Hz`,
    volume: "+0%",
    preset: enabled ? preset : "flat",
    ratePercent: clampedRate,
    pitchHz: clampedPitch,
  };
}

/**
 * Primary High-Fidelity Male Neural TTS Engine: Microsoft Edge Neural TTS (`msedge-tts`)
 *
 * - Provides studio-quality 24kHz 96kbps male Pakistani Urdu (`ur-PK-AsadNeural`, `ur-IN-SalmanNeural`)
 *   and Saudi/Egyptian Classical Arabic (`ar-SA-HamedNeural`, `ar-EG-ShakirNeural`) voices without API keys.
 * - Canonicalizes codepoints & diacritics for the target language (`ar-SA` vs `ur-PK`), applies scholarly
 *   segment-aware prosody (`hadith`, `dua`, `arabic_quote`, `heading`, `urdu_body`), and captures
 *   hardware `WordBoundary` metadata events 1-to-1 with client `targetWords`.
 */
async function synthesizeEdgeNeuralTts(
  cleanText: string,
  isArabicSegment: boolean,
  voiceId: string,
  targetWords: string[],
  options: { segmentType?: string; prosody?: TtsProsodyOptions } = {}
): Promise<{
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  wordTimings: Array<{ word: string; wordIndex: number; startMs: number; endMs: number; confidence: string }>;
  neuralVoice: string;
  appliedProsody: { preset: string; rate: string; pitch: string };
}> {
  const edgeVoiceMap: Record<string, { voice: string; rate?: string; pitch?: string }> = {
    pakistani_scholar_charon: { voice: "ur-PK-AsadNeural", rate: "-4%", pitch: "-1Hz" },
    pakistani_narrator_fenrir: { voice: "ur-IN-SalmanNeural", rate: "-2%", pitch: "+0Hz" },
    pakistani_classic_orus: { voice: "ur-PK-AsadNeural", rate: "-8%", pitch: "-3Hz" },
    "urdu-scholar": { voice: "ur-PK-AsadNeural", rate: "-4%", pitch: "-1Hz" },
    "urdu-clear": { voice: "ur-IN-SalmanNeural", rate: "-2%", pitch: "+0Hz" },
    "islamic-calm": { voice: "ur-PK-AsadNeural", rate: "-5%", pitch: "-2Hz" },
    arabic_hadith_charon: { voice: "ar-SA-HamedNeural", rate: "-5%", pitch: "-1Hz" },
    arabic_turath_fenrir: { voice: "ar-EG-ShakirNeural", rate: "-4%", pitch: "-1Hz" },
    arabic_fasih_orus: { voice: "ar-SA-HamedNeural", rate: "-8%", pitch: "-3Hz" },
    "arabic-reciter": { voice: "ar-SA-HamedNeural", rate: "-5%", pitch: "-1Hz" },
  };

  const baseCfg = isArabicSegment
    ? edgeVoiceMap[voiceId]?.voice?.startsWith("ar-")
      ? edgeVoiceMap[voiceId]
      : { voice: "ar-SA-HamedNeural", rate: "-5%", pitch: "-1Hz" }
    : edgeVoiceMap[voiceId]?.voice?.startsWith("ur-")
    ? edgeVoiceMap[voiceId]
    : { voice: "ur-PK-AsadNeural", rate: "-4%", pitch: "-1Hz" };

  const segmentType = options.segmentType || (isArabicSegment ? "arabic_quote" : "urdu_body");
  const selectedCfg = resolveSegmentProsodyConfig(baseCfg, segmentType, options.prosody);

  // Canonicalize script codepoints & diacritics for the target voice engine (Standard Arabic vs Standard Urdu)
  const scriptCanonicalText = canonicalizeShaddaOrderServer(
    canonicalizeTextForLanguageServer(cleanText, isArabicSegment)
  );

  // Escape XML special characters so SSML inside MsEdgeTTS never fails on quotes or symbols
  const ssmlSafeText = scriptCanonicalText
    .replace(/&/g, " ")
    .replace(/</g, " ")
    .replace(/>/g, " ")
    .replace(/"/g, " ")
    .replace(/'/g, " ")
    .replace(/[«»﴿﴾“”]/g, " ")
    .replace(/ﷺ/g, isArabicSegment ? "صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ" : "صلی اللہ علیہ وسلم")
    .replace(/ﷻ/g, isArabicSegment ? "جَلَّ جَلَالُهُ" : "جل جلالہ")
    .replace(/\s+/g, " ")
    .trim();

  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 8000,
    synthesisTimeoutMs: 15000,
  });

  try {
    await tts.setMetadata(
      selectedCfg.voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
      {
        wordBoundaryEnabled: true,
      }
    );

    const { audioStream, metadataStream } = tts.toStream(ssmlSafeText, {
      rate: selectedCfg.rate,
      pitch: selectedCfg.pitch,
      volume: selectedCfg.volume,
    });

    const audioChunks: Buffer[] = [];
    const rawBoundaries: Array<{ text: string; startMs: number; endMs: number }> = [];

    if (metadataStream) {
      metadataStream.on("data", (d: Buffer) => {
        try {
          const json = JSON.parse(Buffer.from(d).toString("utf-8"));
          const items = Array.isArray(json?.Metadata) ? json.Metadata : [];
          for (const item of items) {
            if (item?.Type === "WordBoundary" && item?.Data) {
              const offsetMs = Math.round(Number(item.Data.Offset || 0) / 10000);
              const durMs = Math.max(40, Math.round(Number(item.Data.Duration || 0) / 10000));
              const wText = String(item.Data?.text?.Text || "").trim();
              rawBoundaries.push({
                text: wText,
                startMs: offsetMs,
                endMs: offsetMs + durMs,
              });
            }
          }
        } catch {
          // Ignore malformed metadata packet
        }
      });
    }

    for await (const chunk of audioStream) {
      audioChunks.push(Buffer.from(chunk));
    }

    const combinedMp3 = Buffer.concat(audioChunks);
    if (combinedMp3.length < 128) {
      throw new Error("Edge Neural TTS returned empty audio stream");
    }

    // 96 kbps CBR MP3 = 12,000 bytes per second
    const streamDurationMs = Math.round((combinedMp3.length / 12000) * 1000);
    const lastBoundaryEndMs =
      rawBoundaries.length > 0 ? rawBoundaries[rawBoundaries.length - 1].endMs + 120 : 0;
    const durationMs = Math.max(500, streamDurationMs || lastBoundaryEndMs);

    // Map hardware WordBoundary timestamps 1-to-1 onto `targetWords` (client sentence.words)
    const wordTimings: Array<{
      word: string;
      wordIndex: number;
      startMs: number;
      endMs: number;
      confidence: string;
    }> = [];

    if (rawBoundaries.length > 0 && targetWords.length > 0) {
      const spokenCounts = targetWords.map((w) =>
        w.includes("ﷺ") ? 4 : w.includes("ﷻ") ? 2 : 1
      );
      const totalExpectedSpoken = spokenCounts.reduce((a, b) => a + b, 0);

      if (Math.abs(rawBoundaries.length - totalExpectedSpoken) <= 2) {
        let bCursor = 0;
        for (let i = 0; i < targetWords.length; i++) {
          const spanCount = spokenCounts[i];
          const startBIdx = Math.min(rawBoundaries.length - 1, bCursor);
          const endBIdx = Math.min(
            rawBoundaries.length - 1,
            bCursor + spanCount - 1
          );
          const sMs = rawBoundaries[startBIdx].startMs;
          const nextStartBIdx = Math.min(rawBoundaries.length - 1, endBIdx + 1);
          const eMs =
            i < targetWords.length - 1 && nextStartBIdx > endBIdx
              ? Math.max(
                  rawBoundaries[endBIdx].endMs,
                  rawBoundaries[nextStartBIdx].startMs - 10
                )
              : Math.max(rawBoundaries[endBIdx].endMs, durationMs - 60);

          wordTimings.push({
            word: targetWords[i],
            wordIndex: i,
            startMs: sMs,
            endMs: Math.max(sMs + 45, eMs),
            confidence: "neural-word-boundary",
          });
          bCursor += spanCount;
        }
      } else {
        const firstStart = rawBoundaries[0].startMs;
        const lastEnd = Math.max(
          firstStart + 200,
          rawBoundaries[rawBoundaries.length - 1].endMs
        );
        let accSpoken = 0;
        for (let i = 0; i < targetWords.length; i++) {
          const bIdx = Math.min(
            rawBoundaries.length - 1,
            Math.floor((accSpoken / totalExpectedSpoken) * rawBoundaries.length)
          );
          accSpoken += spokenCounts[i];
          const nextBIdx = Math.min(
            rawBoundaries.length - 1,
            Math.max(
              bIdx,
              Math.floor((accSpoken / totalExpectedSpoken) * rawBoundaries.length) - 1
            )
          );
          const sMs =
            i === 0
              ? firstStart
              : Math.max(wordTimings[i - 1].endMs, rawBoundaries[bIdx].startMs);
          const eMs =
            i === targetWords.length - 1
              ? lastEnd
              : Math.max(sMs + 50, rawBoundaries[nextBIdx].endMs);
          wordTimings.push({
            word: targetWords[i],
            wordIndex: i,
            startMs: sMs,
            endMs: eMs,
            confidence: "neural-word-boundary",
          });
        }
      }
    } else {
      const weights = targetWords.map((w) => Math.max(1.2, w.length * 0.85));
      const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
      let cursor = 60;
      const activeSpan = Math.max(200, durationMs - 120);
      for (let i = 0; i < targetWords.length; i++) {
        const span = Math.round((weights[i] / totalWeight) * activeSpan);
        wordTimings.push({
          word: targetWords[i],
          wordIndex: i,
          startMs: cursor,
          endMs: cursor + span,
          confidence: "phonetic-syllable-aligned",
        });
        cursor += span;
      }
    }

    return {
      audioBase64: combinedMp3.toString("base64"),
      mimeType: "audio/mpeg",
      durationMs,
      wordTimings,
      neuralVoice: selectedCfg.voice,
      appliedProsody: {
        preset: selectedCfg.preset,
        rate: selectedCfg.rate,
        pitch: selectedCfg.pitch,
      },
    };
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

// ─── 4. POST /api/reader/tts — Multi-Provider Urdu (Pakistan) & Arabic Male TTS Engine ───
intelligentReaderRouter.post("/tts", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const {
      text,
      language = "auto",
      segmentType = "urdu_body",
      voiceId = "pakistani_scholar_charon",
      provider = "edge-neural",
      words: clientWords = null,
      prosody = {},
    } = req.body || {};

    const rawCleanText = rejoinFragmentedUrduArabicLettersServer(String(text || ""))
      .replace(/\[\d+\]|\(\d+\)|\[[٠-٩۰-۹]+\]|\([٠-٩۰-۹]+\)/g, " ")
      .replace(/[~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([۔.،؛؟!:])/g, "$1")
      .trim();

    if (!rawCleanText) {
      return res.status(400).json({
        ok: false,
        errorCode: "INVALID_TEXT",
        error: "النص المطلوب نطقه فارغ أو غير صالح.",
      });
    }

    // Automatically detect true script language from the text itself so Urdu is always spoken by ur-PK-AsadNeural
    // and Arabic is always spoken by ar-SA-HamedNeural
    const isUrduDetected = detectIsUrduScriptServer(rawCleanText);
    const isArabicSegment =
      !isUrduDetected &&
      (language === "ar" ||
        language === "ar-SA" ||
        language === "auto" ||
        segmentType === "hadith" ||
        segmentType === "dua" ||
        segmentType === "arabic_quote" ||
        segmentType === "quran" ||
        !isUrduDetected);

    const prosodyOpts: TtsProsodyOptions = {
      preset: typeof prosody?.preset === "string" ? prosody.preset : "scholarly",
      enabled: prosody?.enabled !== false,
      arabicTashkeel: prosody?.arabicTashkeel !== false,
      urduProofread: prosody?.urduProofread !== false,
      hadithRateDelta: Number.isFinite(Number(prosody?.hadithRateDelta))
        ? Number(prosody.hadithRateDelta)
        : undefined,
      pitchDeltaHz: Number.isFinite(Number(prosody?.pitchDeltaHz))
        ? Number(prosody.pitchDeltaHz)
        : undefined,
    };

    const cleanText = isArabicSegment
      ? prosodyOpts.arabicTashkeel
        ? proofreadArabicTashkeelForTts(rawCleanText, segmentType)
        : canonicalizeShaddaOrderServer(canonicalizeTextForLanguageServer(rawCleanText, true))
      : prosodyOpts.urduProofread
      ? proofreadUrduLinguisticForTts(rawCleanText)
      : canonicalizeShaddaOrderServer(canonicalizeTextForLanguageServer(rawCleanText, false));

    const words: string[] =
      Array.isArray(clientWords) && clientWords.length > 0
        ? clientWords.map((w) => String(w?.word || w || "").trim()).filter(Boolean)
        : cleanText.split(/\s+/).filter(Boolean);

    const resolvedVoiceId = isArabicSegment
      ? voiceId.startsWith("arabic_")
        ? voiceId
        : "arabic_hadith_charon"
      : !voiceId.startsWith("arabic_")
      ? voiceId
      : "pakistani_scholar_charon";

    const fallbackProsodyCfg = resolveSegmentProsodyConfig(
      { voice: resolvedVoiceId, rate: isArabicSegment ? "-5%" : "-4%", pitch: "-1Hz" },
      segmentType,
      prosodyOpts
    );

    // 1. Primary Provider: Microsoft Edge Neural Male TTS (ur-PK-AsadNeural / ar-SA-HamedNeural) with Hardware WordBoundaries
    try {
      const edgeAudio = await synthesizeEdgeNeuralTts(
        cleanText,
        isArabicSegment,
        resolvedVoiceId,
        words,
        { segmentType, prosody: prosodyOpts }
      );
      return res.json({
        ok: true,
        provider: "edge-neural-tts",
        voiceId: resolvedVoiceId,
        neuralVoice: edgeAudio.neuralVoice,
        language: isArabicSegment ? "ar-SA" : "ur-PK",
        mimeType: edgeAudio.mimeType,
        audioBase64: edgeAudio.audioBase64,
        durationMs: edgeAudio.durationMs,
        wordTimings: edgeAudio.wordTimings,
        appliedProsody: edgeAudio.appliedProsody,
      });
    } catch (edgeErr: any) {
      console.warn("[DAR AL TAWHID Edge Neural TTS Fallback]:", edgeErr?.message || edgeErr);
    }

    // 2. Secondary Provider: Gemini Neural TTS (when GEMINI_API_KEY is available)
    const ai = getAiClient();
    if (ai) {
      const geminiVoiceMap: Record<string, string> = {
        pakistani_scholar_charon: "Charon",
        pakistani_narrator_fenrir: "Fenrir",
        pakistani_classic_orus: "Puck",
        arabic_hadith_charon: "Charon",
        arabic_turath_fenrir: "Fenrir",
        arabic_fasih_orus: "Puck",
      };
      const selectedGeminiVoice = geminiVoiceMap[resolvedVoiceId] || "Charon";

      let pcmBase64: string | undefined;
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [
            {
              role: "user",
              parts: [{ text: cleanText }],
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
        // Fall through
      }

      if (pcmBase64) {
        const wavInfo = pcmBase64ToWavAndTimings(pcmBase64, words, 24000);
        return res.json({
          ok: true,
          provider: "gemini-neural-tts",
          voiceId: resolvedVoiceId,
          geminiVoice: selectedGeminiVoice,
          language: isArabicSegment ? "ar-SA" : "ur-PK",
          mimeType: "audio/wav",
          audioBase64: wavInfo.wavBase64,
          durationMs: wavInfo.durationMs,
          wordTimings: wavInfo.wordTimings,
          appliedProsody: {
            preset: fallbackProsodyCfg.preset,
            rate: fallbackProsodyCfg.rate,
            pitch: fallbackProsodyCfg.pitch,
          },
        });
      }
    }

    // 3. Optional Google Cloud TTS API if GOOGLE_CLOUD_TTS_KEY is configured
    if (provider === "google-cloud-tts" && process.env.GOOGLE_CLOUD_TTS_KEY) {
      const speakingRate = Math.max(0.7, Math.min(1.25, 1 + fallbackProsodyCfg.ratePercent / 100));
      const gPitch = Math.max(-6, Math.min(4, fallbackProsodyCfg.pitchHz * 0.5));
      const gRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_CLOUD_TTS_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: cleanText },
            voice: {
              languageCode: isArabicSegment ? "ar-XA" : "ur-PK",
              name: isArabicSegment ? "ar-XA-Wavenet-B" : "ur-IN-Wavenet-B",
              ssmlGender: "MALE",
            },
            audioConfig: {
              audioEncoding: "LINEAR16",
              sampleRateHertz: 24000,
              speakingRate,
              pitch: gPitch,
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
            voiceId: resolvedVoiceId,
            language: isArabicSegment ? "ar-SA" : "ur-PK",
            mimeType: "audio/wav",
            audioBase64: wavInfo.wavBase64,
            durationMs: wavInfo.durationMs,
            wordTimings: wavInfo.wordTimings,
            appliedProsody: {
              preset: fallbackProsodyCfg.preset,
              rate: fallbackProsodyCfg.rate,
              pitch: fallbackProsodyCfg.pitch,
            },
          });
        }
      }
    }

    return res.status(503).json({
      ok: false,
      errorCode: "TTS_FAILED",
      error: "تعذر الاتصال بمحرك النطق العصبي. يرجى التحقق من اتصال الشبكة وإعادة المحاولة.",
    });
  } catch (err: any) {
    console.error("[DAR AL TAWHID TTS Error]:", err?.message || err);
    return res.status(500).json({
      ok: false,
      errorCode: "TTS_FAILED",
      error: err?.message || "TTS generation failed",
    });
  }
});
