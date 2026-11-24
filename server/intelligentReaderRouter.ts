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
    .replace(/[\(\)\[\]\{\}]\s*[٠-٩۰-۹\d]+\s*[\(\)\[\]\{\}]/g, " ")
    .replace(/[﴿﴾«»"'\(\)\[\]\{\}۞٭]/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ةۃہ]/g, "ه")
    .replace(/[ىیے]/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEveryAyahUrl(
  surahNumber: number,
  ayahNumber: number,
  reciterFolder = "Abdurrahmaan_As-Sudais_192kbps"
): string {
  const s = String(surahNumber).padStart(3, "0");
  const a = String(ayahNumber).padStart(3, "0");
  return `https://everyayah.com/data/${reciterFolder}/${s}${a}.mp3`;
}

function buildIslamicNetworkAudioUrl(
  globalAyahNumber: number,
  edition = "ar.abdurrahmaansudais"
): string {
  return `https://cdn.islamic.network/quran/audio/128/${edition}/${globalAyahNumber}.mp3`;
}

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

// ─── 2. POST /api/reader/verify-quran — Authentic Quranic Verse Verification ───
intelligentReaderRouter.post("/verify-quran", express.json(), async (req, res) => {
  try {
    const { text, surahHint, ayahHint, reciter = "ar.abdurrahmaansudais" } = req.body || {};
    const reciterFolderMap: Record<string, string> = {
      "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
      "ar.alafasy": "Alafasy_128kbps",
      "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
      "ar.husary": "Husary_128kbps",
      "ar.minshawi": "Minshawy_Murattal_128kbps",
    };
    const everyAyahFolder = reciterFolderMap[reciter] || "Abdurrahmaan_As-Sudais_192kbps";

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
        // Fall through
      }
    }

    const normInput = normalizeArabicForQuranMatch(text || "");
    const normInputNoSpace = normInput.replace(/\s+/g, "");
    if (!normInput || normInput.length < 8) {
      return res.json({ verified: false, reason: "Text too short for strict Quran verification" });
    }

    for (const item of CANONICAL_QURAN_INDEX) {
      const keyNoSpace = item.normalizedKey.replace(/\s+/g, "");
      if (
        normInput.includes(item.normalizedKey) ||
        (item.normalizedKey.includes(normInput) && normInput.length >= 14) ||
        normInputNoSpace.includes(keyNoSpace) ||
        (keyNoSpace.includes(normInputNoSpace) && normInputNoSpace.length >= 14)
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
          reciterId: reciter,
          audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
          directAudioUrl: directUrl,
          backupAudioUrl: buildIslamicNetworkAudioUrl(item.globalAyahNumber, reciter),
        });
      }
    }

    try {
      const searchWords = normInput
        .split(" ")
        .filter((w) => w.length >= 3)
        .slice(0, 5)
        .join(" ");
      const searchUrl = `https://api.alquran.cloud/v1/search/${encodeURIComponent(searchWords)}/all/quran-simple-clean`;
      const sRes = await fetch(searchUrl);
      if (sRes.ok) {
        const sData: any = await sRes.json();
        const matches = sData?.data?.matches || [];
        for (const m of matches) {
          const normMatch = normalizeArabicForQuranMatch(m.text || "");
          const normMatchNoSpace = normMatch.replace(/\s+/g, "");
          if (
            normMatch &&
            (normInput.includes(normMatch) ||
              normMatch.includes(normInput) ||
              normInputNoSpace.includes(normMatchNoSpace) ||
              normMatchNoSpace.includes(normInputNoSpace) ||
              tokenOverlapRatio(normInput, normMatch) >= 0.72)
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

/**
 * Primary High-Fidelity Male Neural TTS Engine: Microsoft Edge Neural TTS (`msedge-tts`)
 *
 * - Provides studio-quality 24kHz 96kbps male Pakistani Urdu (`ur-PK-AsadNeural`, `ur-IN-SalmanNeural`)
 *   and Saudi/Egyptian Classical Arabic (`ar-SA-HamedNeural`, `ar-EG-ShakirNeural`) voices without API keys.
 * - Canonicalizes codepoints for the target language (`ar-SA` vs `ur-PK`) so `ar-SA-HamedNeural` never drops
 *   Indo-Pak characters (`ک`, `ی`, `ہ`, `ۃ`) and `ur-PK-AsadNeural` never stumbles on Arabic variants.
 * - Captures real hardware `WordBoundary` metadata events (`Offset` & `Duration` in 100ns ticks)
 *   and aligns them 1-to-1 with the client sentence `words` array for exact word highlight synchronization.
 */
async function synthesizeEdgeNeuralTts(
  cleanText: string,
  isArabicSegment: boolean,
  voiceId: string,
  targetWords: string[]
): Promise<{
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  wordTimings: Array<{ word: string; wordIndex: number; startMs: number; endMs: number; confidence: string }>;
  neuralVoice: string;
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

  const selectedCfg = isArabicSegment
    ? edgeVoiceMap[voiceId]?.voice?.startsWith("ar-")
      ? edgeVoiceMap[voiceId]
      : { voice: "ar-SA-HamedNeural", rate: "-5%", pitch: "-1Hz" }
    : edgeVoiceMap[voiceId]?.voice?.startsWith("ur-")
    ? edgeVoiceMap[voiceId]
    : { voice: "ur-PK-AsadNeural", rate: "-4%", pitch: "-1Hz" };

  // Canonicalize script codepoints for the target voice engine (Standard Arabic vs Standard Urdu)
  const scriptCanonicalText = canonicalizeTextForLanguageServer(cleanText, isArabicSegment);

  // Escape XML special characters so SSML inside MsEdgeTTS never fails on quotes or symbols
  const ssmlSafeText = scriptCanonicalText
    .replace(/&/g, " ")
    .replace(/</g, " ")
    .replace(/>/g, " ")
    .replace(/"/g, " ")
    .replace(/'/g, " ")
    .replace(/[«»﴿﴾“”]/g, " ")
    .replace(/ﷺ/g, isArabicSegment ? "صلى الله عليه وسلم" : "صلی اللہ علیہ وسلم")
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
      rate: selectedCfg.rate || "-3%",
      pitch: selectedCfg.pitch || "+0Hz",
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
      const spokenCounts = targetWords.map((w) => (w.includes("ﷺ") ? 4 : 1));
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

    const cleanText = canonicalizeTextForLanguageServer(rawCleanText, isArabicSegment);

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

    // 1. Primary Provider: Microsoft Edge Neural Male TTS (ur-PK-AsadNeural / ar-SA-HamedNeural) with Hardware WordBoundaries
    try {
      const edgeAudio = await synthesizeEdgeNeuralTts(
        cleanText,
        isArabicSegment,
        resolvedVoiceId,
        words
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
        });
      }
    }

    // 3. Optional Google Cloud TTS API if GOOGLE_CLOUD_TTS_KEY is configured
    if (provider === "google-cloud-tts" && process.env.GOOGLE_CLOUD_TTS_KEY) {
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
