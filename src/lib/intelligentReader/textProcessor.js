/**
 * DAR AL TAWHID — Intelligent Multilingual & Nastaliq Text Processor (v4)
 *
 * Pipeline Architecture:
 * 1. PDF Extraction (with safe RTL glyph coalescing that never glues separate multi-letter words & automatic Visual LTR reversal recovery)
 * 2. OCR Quality, Font-Encoding Gibberish & Nastaliq Fragmentation Detector + Gemini Vision / Server Tesseract OCR Client
 * 3. Unicode Normalization (Presentation Forms NFKC decoding + language-aware Arabic vs Urdu character canonicalization)
 * 4. Urdu & Arabic Text Validation + Lookahead Disconnected Letter Rejoiner (prevents letter-by-letter TTS reading & word-gluing)
 * 5. Segment-Level Language & Islamic Category Classifier (Urdu ur-PK vs Arabic ar-SA, Hadith, Dua, Quran, Heading, Footnote)
 * 6. Context-Preserving Sentence & Inline Mixed-Language Segmenter
 * 7. Authentic Quranic Verse Verifier (Never uses TTS for verified Quranic verses; never guesses unverified recordings)
 */

import {
  getCachedPageOcr,
  setCachedPageOcr,
  getCachedQuranVerification,
  setCachedQuranVerification,
} from "./cacheManager";
import { WASWASA_STRUCTURED_PAGES } from "./sampleUrduBook";

// ─── Structured Error Taxonomy ────────────────────────────────────────────────
export const READER_ERROR_CODES = {
  PDF_LOAD_FAILED: {
    code: "PDF_LOAD_FAILED",
    titleAr: "فشل تحميل PDF",
    messageAr: "تعذر تحميل ملف الكتاب (PDF). يرجى التحقق من الملف أو إعادة المحاولة.",
  },
  TEXT_EXTRACTION_FAILED: {
    code: "TEXT_EXTRACTION_FAILED",
    titleAr: "فشل استخراج النص",
    messageAr: "تعذر استخراج النص من هذه الصفحة. يمكنك تشغيل الاستخراج الذكي (OCR).",
  },
  OCR_FAILED: {
    code: "OCR_FAILED",
    titleAr: "فشل OCR",
    messageAr: "تعذر إتمام المسح الضوئي الذكي (OCR) للصفحة. يرجى إعادة المحاولة.",
  },
  INVALID_TEXT: {
    code: "INVALID_TEXT",
    titleAr: "النص غير صالح",
    messageAr: "النص المستخرج يحتوي على رموز تالفة أو حروف مقطعة غير صالحة للقراءة الصوتية.",
  },
  UNSUPPORTED_LANGUAGE: {
    code: "UNSUPPORTED_LANGUAGE",
    titleAr: "اللغة غير مدعومة",
    messageAr: "لغة النص في هذا المقطع غير مدعومة حالياً في محرك القراءة.",
  },
  TTS_FAILED: {
    code: "TTS_FAILED",
    titleAr: "فشل TTS",
    messageAr: "تعذر توليد الصوت من محرك النطق (TTS). يرجى إعادة المحاولة.",
  },
  AUDIO_LOAD_FAILED: {
    code: "AUDIO_LOAD_FAILED",
    titleAr: "فشل تحميل الصوت",
    messageAr: "تعذر تحميل أو تشغيل المقطع الصوتي.",
  },
  SYNC_FAILED: {
    code: "SYNC_FAILED",
    titleAr: "فشل المزامنة",
    messageAr: "حدث خلل في مزامنة تظليل الكلمات مع الصوت.",
  },
  NETWORK_OFFLINE: {
    code: "NETWORK_OFFLINE",
    titleAr: "انقطاع الاتصال",
    messageAr: "لا يوجد اتصال بالشبكة لتوليد الصوت أو تحميل التلاوة.",
  },
  POSITION_SAVE_FAILED: {
    code: "POSITION_SAVE_FAILED",
    titleAr: "فشل حفظ الموضع",
    messageAr: "تعذر حفظ موضع القراءة الحالي في ذاكرة المتصفح.",
  },
};

// ─── Urdu vs Arabic Script Character Sets ─────────────────────────────────────
// STRICT Urdu-only characters (10 letters that NEVER occur in the Arabic alphabet)
// Excludes ہ U+06C1, ی U+06CC, ک U+06A9 which are also used in Indo-Pak Arabic typesetting
const STRICT_URDU_ONLY_CHARS_REGEX = /[ٹڈڑںےھپچژگ]/g;

// 100% Exclusive Urdu functional words (excludes any words shared with Arabic such as ان، بعد، تم، طرح، اس)
const EXCLUSIVE_URDU_WORDS_REGEX =
  /(?:^|\s)(?:کے|کی|کا|میں|ہے|ہیں|تھا|تھے|تھی|اور|پر|سے|کو|نے|بھی|کیونکہ|لیکن|تاکہ|ہوتا|ہوتی|ہوتے|کرتا|کرتے|کرتی|رہا|رہی|رہے|جائے|جائیں|جاتا|جاتے|جاتی|والا|والے|والی|لیے|ساتھ|اندر|باہر|پہلے|فرمایا|فرماتے|وسوسے|آپ|اپنے|اپنی|اپنا|نہیں|کبھی|ایسے|ایسا|ایسی|جنہیں|سمجھنا|ہونا|چاہیے|سکتا|سکتے|سکتی|کیا|کیوں|کیسے|کہاں|یہاں|وہاں|بہت|زیادہ|تھوڑا|ہمارا|ہمارے|ہماری|تمہارا|تمہارے)(?=\s|$|[۔،؟!:])/g;

// Classical Arabic definite articles, prepositions, pronouns & morphological markers
const ARABIC_DEFINITE_AND_MARKERS_REGEX =
  /(?:^|\s)(?:الحمد|لله|للہ|رب|العالمين|العالمین|الرحمن|الرحيم|الرحیم|قال|قالت|قالوا|يقول|رسول|النبي|النبی|صلى|صلی|وسلم|رضي|رضی|عنه|عنہ|عنهم|عنہم|عنها|اللهم|اللَّهُمَّ|أعوذ|اعوذ|بالله|باللہ|من|في|فى|على|إلى|عن|مع|بين|عند|حتى|أن|إن|قد|لقد|لم|لن|سوف|لا|ما|هو|هي|هم|أنت|أنتم|نحن|كان|كانت|يكون|ذلك|ذَلِكَ|ذلک|هذا|هذه|هؤلاء|الذي|التي|الذين|صريح|صَرِيحُ|صریح|الإيمان|الْإِيمَانِ|الایمان|الشيطان|الناس|القلوب|سبحان|ربنا|كيف|کیف|تنقذ|نفسك|نفسک|ورطة|ورطۃ|الوسوسة|الوسوسۃ|إغاثة|الباب|الأول|حقيقة|القاعدة|الفقهية|الكبرى|اليقين|يزول|بالشك|الدعاء|النبوي|وصلى|نبينا|أجمعين)(?=\s|$|[۔.،؛؟!:"'»﴾])/g;

// Comprehensive lexicon of standalone Urdu & Arabic words for accurate boundary segmentation & plausibility scoring
const KNOWN_URDU_ARABIC_WORDS_LIST = [
  // Urdu grammatical particles, pronouns, auxiliaries
  "کے", "کی", "کا", "کو", "سے", "نے", "پر", "میں", "ہے", "ہیں",
  "تھا", "تھے", "تھی", "اور", "یہ", "وہ", "اس", "ان", "اب", "جب",
  "تب", "سب", "رب", "دل", "دم", "غم", "کم", "ہم", "تم", "جو", "تو",
  "بھی", "ہی", "نہ", "نا", "کہ", "ہر", "اک", "ایک", "دو", "تین", "چار", "پانچ",
  "آپ", "خود", "کچھ", "کوئی", "کس", "کسی", "کون", "کیا", "کیوں", "کیسے",
  "کہاں", "جہاں", "وہاں", "یہاں", "اگر", "مگر", "لیکن", "بلکہ", "تاکہ",
  "کیونکہ", "چونکہ", "لہذا", "یعنی", "مثلاً", "صرف", "فقط", "بالکل",
  "بہت", "زیادہ", "تھوڑا", "پورا", "سارا", "سارے", "ساری", "اپنا", "اپنے", "اپنی",
  "ہمارا", "ہمارے", "ہماری", "تمہارا", "تمہارے", "تمہاری", "جن", "جنہیں", "جس", "جسے",
  "اندر", "باہر", "اوپر", "نیچے", "آگے", "پیچھے", "پہلے", "بعد", "ساتھ", "بغیر", "لیے",
  // Common Urdu verbs & auxiliaries
  "ہو", "ہوا", "ہوئے", "ہوئی", "ہوتا", "ہوتے", "ہوتی", "ہونا", "ہونے", "ہوگا", "ہوگی", "ہوں",
  "کر", "کرا", "کرے", "کریں", "کرتا", "کرتے", "کرتی", "کرنا", "کرنے", "کیے",
  "رہا", "رہے", "رہی", "رہنا", "رہتا", "رہتے", "رہتی", "جائے", "جائیں", "جاتا", "جاتے", "جاتی",
  "آیا", "آئے", "آئی", "آتا", "آتے", "آتی", "آنا", "آنے", "لانا", "لانے", "لاتا", "لاتے",
  "دیا", "دیے", "دیتا", "دیتے", "دیتی", "دینا", "دینے", "لیا", "لیتا", "لیتے", "لینا",
  "کہا", "کہتے", "کہتا", "کہتی", "کہنا", "فرمایا", "فرماتے", "سمجھنا", "سمجھتا", "سمجھتے",
  "چاہیے", "سکتا", "سکتے", "سکتی", "لگا", "لگے", "لگی", "پڑا", "پڑے", "پڑی", "پیدا",
  // Key Islamic, scholarly & literary Urdu vocabulary
  "وسوسہ", "وسوسے", "وساوس", "شیطان", "شیاطین", "انسان", "مسلمان", "مسلمانوں",
  "مومن", "مومنین", "ایمان", "اسلام", "قرآن", "حدیث", "سنت", "نماز", "روزہ", "زکوۃ", "حج",
  "علاج", "شفا", "ذکر", "اذکار", "دعا", "دعائیں", "توبہ", "استغفار", "اللہ", "تعالیٰ", "تعالی",
  "رسول", "نبی", "کریم", "صحابہ", "کرام", "رضی", "عنہ", "عنہم", "عنہا", "رحمہ",
  "ہتھیار", "ذریعے", "ذریعہ", "دلوں", "شکوک", "شبہات", "شک", "شبہ", "اتنا", "مضبوط",
  "متاثر", "نہیں", "کبھی", "ایسے", "ایسا", "ایسی", "خیالات", "خیال", "زبان", "گوارا",
  "عرض", "برا", "خوفزدہ", "خوف", "خالص", "علامت", "بات", "روشن", "دلیل", "طریقہ",
  "عقیدہ", "فائدہ", "قاعدہ", "مسئلہ", "مسائل", "حکم", "احکام", "علم", "علماء", "کتاب",
  "باب", "فصل", "صفحہ", "نمبر", "ترجمہ", "تفسیر", "شرح", "متن", "سند", "روایت",
  "بخاری", "مسلم", "ترمذی", "ابوداؤد", "نسائی", "احمد", "آیت", "آیات", "سورۃ", "سورة",
  "پناہ", "نجات", "حفاظت", "طاقت", "کمزور", "غفلت", "عبادت", "تقویٰ", "اخلاص", "یقین",
  "طہارت", "وضو", "پانی", "مرتبہ", "بیماری", "مریض", "لازم", "توجہ", "مکمل", "اطمینان",
  "پریشانی", "پریشانیوں", "صبح", "شام", "مسنون", "پابندی", "قلعہ", "تلاوت", "سونے", "فرض",
  "محفوظ", "اصول", "پہلا", "دوسرا", "تیسرا", "بحث", "نظر", "انداز", "اعراض", "صحبت", "اوقات",
  // Common Arabic words & particles
  "من", "عن", "في", "فى", "على", "إلى", "مع", "بين", "عند", "حتى", "قد", "لقد", "لم", "لن",
  "لا", "ما", "هو", "هي", "هم", "ثم", "بل", "أن", "إن", "إذ", "إذا", "أو", "كل", "بعض", "غير",
  "قال", "قالت", "قالوا", "كان", "كانت", "ذلك", "ذلک", "هذا", "هذه", "الذي", "التي", "الذين",
  "الحمد", "للہ", "لله", "الله", "اللهم", "العالمین", "العالمين", "الرحمن", "الرحیم", "الرحيم",
  "صریح", "صريح", "الایمان", "الإيمان", "شر", "الوسواس", "الخناس", "یوسوس", "يوسوس",
  "صدور", "الناس", "اعوذ", "أعوذ", "برب", "كيف", "کیف", "تنقذ", "نفسك", "نفسک", "ورطة", "ورطۃ",
  "الوسوسة", "الوسوسۃ", "الشيطان", "واضع", "خطمه", "قلب", "ابن", "آدم", "فإن", "ذكر", "خنس",
  "وإن", "نسي", "التقم", "قلبه", "حاشية", "حاشیہ", "إغاثة", "اللهفان", "مصايد", "للإمام",
  "قيم", "الجوزية", "الباب", "الأول", "حقيقة", "أبي", "هريرة", "رضي", "عنه", "جاء", "ناس",
  "أصحاب", "النبي", "فسألوه", "إنا", "نجد", "أنفسنا", "يتعاظم", "أحدنا", "يتكلم", "به",
  "أوقد", "وجدتموه", "قالوا", "نعم", "ذاك", "رواه", "القاعدة", "الفقهية", "الكبرى", "اليقين",
  "يزول", "بالشك", "وكثرة", "الشكوك", "يلتفت", "إليها", "الدعاء", "النبوي", "لدفع", "والهم",
  "إني", "بك", "الهم", "والحزن", "وأعوذ", "العجز", "والكسل", "وصلى", "وسلم", "نبينا", "محمد",
  "وعلى", "آله", "وصحبه", "أجمعين", "والحمد",
];

const KNOWN_WORDS_SET = new Set(KNOWN_URDU_ARABIC_WORDS_LIST);
const SORTED_KNOWN_WORDS = [...KNOWN_URDU_ARABIC_WORDS_LIST]
  .filter((w) => w.length >= 2)
  .sort((a, b) => b.length - a.length);

// Letters in Urdu/Arabic that are strictly word-final in standard orthography
const STRICTLY_WORD_FINAL_CHARS = new Set(["ے", "ں", "ة", "ى", "ۃ"]);

// Right-only joining letters (cannot connect to a following letter in cursive script)
const NON_CONNECTING_AFTER_CHARS = new Set([
  "ا", "آ", "أ", "إ", "ٱ", "د", "ڈ", "ذ", "ر", "ڑ", "ز", "ژ", "و", "ؤ", "ے", "ں", "ة", "ۃ", "ى",
]);

// Dual-joining Arabic/Urdu letters that connect to a following letter inside a word
const DUAL_JOINING_LETTERS_REGEX =
  /^[بپتٹثجچحخسشصضطظعغفقکكگلمنہهھیيئ]$/;

// Single-character Arabic/Urdu letter check (ignoring diacritics)
const SINGLE_AR_UR_LETTER_REGEX =
  /^[\u0600-\u06FF\u0750-\u077F][\u064B-\u065F\u0670]*$/;

// Arabic Hadith markers
const HADITH_ARABIC_MARKER_REGEX =
  /(?:قال رسول الله|قال رسول اللہ|قال النبي|قال النبی|صلى الله عليه وسلم|صلی اللہ علیہ وسلم|ﷺ|رواه البخاري|رواه مسلم|متفق عليه|حدثنا|أخبرنا|عن أبي هريرة|عن ابن عباس|عن عائشة|عن أنس|أخرجه البخاري|أخرجه مسلم|في الصحيحين|ذَلِكَ صَرِيحُ الْإِيمَانِ|ذلك صريح الإيمان|ذاك صريح الإيمان)/i;

// Urdu Hadith intro markers (used to split an Urdu intro from a following Arabic Hadith)
const HADITH_URDU_INTRO_REGEX =
  /(?:نبی کریم ﷺ نے فرمایا|رسول اللہ ﷺ نے فرمایا|رسول اللہ ﷺ کا ارشاد ہے|آپ ﷺ نے فرمایا|فرمایا|ارشاد فرمایا|ارشاد ہے|حدیث شریف میں ہے|حدیث میں آتا ہے|حدیث میں ہے|دعا سکھائی)\s*[:：]?\s*/i;

// Dua markers
const DUA_MARKER_REGEX =
  /(?:اللَّهُمَّ|اللهم إني أعوذ بك|أعوذ بالله من الشيطان الرجيم|أعوذ باللہ من الشیطان الرجیم|رب أعوذ بك من همزات الشياطين|سبحانك اللهم|ربنا آتنا|لا إله إلا أنت سبحانك|الدعاء النبوي)/i;

/**
 * Helper: Check whether a book is specifically the built-in sample Waswasa book
 */
export function isSampleWaswasaBook(bookId, bookMetadata) {
  const idStr = String(bookId || bookMetadata?.id || "").toLowerCase();
  const titleStr = String(bookMetadata?.title || "").toLowerCase();
  const urlStr = String(bookMetadata?.file_url || bookMetadata?.pdf_url || "").toLowerCase();
  return (
    urlStr.startsWith("daraltawhid://") ||
    idStr.includes("waswasa") ||
    idStr.includes("sample-urdu") ||
    titleStr.includes("وسوسہ اور اس کا علاج") ||
    titleStr.includes("وسوسه اور اس كا علاج") ||
    titleStr.includes("ورطة الوسوسة")
  );
}

/**
 * Helper: Canonicalize codepoints for the target speech language so the TTS neural model
 * never encounters alien codepoints from the other script's Unicode block!
 *
 * CRITICAL DIAGNOSTIC FIX:
 * - `ar-SA-HamedNeural` drops Indo-Pak `ک` (U+06A9), `ی` (U+06CC), `ہ` (U+06C1), `ۃ` (U+06C3)
 *   unless converted to Standard Arabic `ك` (U+0643), `ي` (U+064A), `ه` (U+0647), `ة` (U+0629)!
 * - `ur-PK-AsadNeural` expects Standard Urdu `ک` (U+06A9), `ی` (U+06CC), `ہ` (U+06C1)!
 */
export function canonicalizeTextForLanguage(text, language = "ur") {
  if (!text) return "";
  const s = String(text);
  const isArabic = language === "ar" || String(language).startsWith("ar");

  if (isArabic) {
    return s
      .replace(/\u06C1/g, "\u0647") // ہ (Heh Goal) -> ه (Arabic Heh)
      .replace(/\u06A9/g, "\u0643") // ک (Keheh) -> ك (Arabic Kaf)
      .replace(/\u06CC/g, "\u064A") // ی (Farsi Yeh) -> ي (Arabic Yeh)
      .replace(/\u06D2/g, "\u0649") // ے (Bari Ye) -> ى (Alef Maksura)
      .replace(/[\u06C2\u06C3]/g, "\u0629") // ۂ / ۃ -> ة (Teh Marbuta)
      .replace(/\u06D4/g, "."); // ۔ (Urdu full stop) -> .
  }

  return s
    .replace(/\u0643/g, "\u06A9") // ك -> ک
    .replace(/\u064A/g, "\u06CC") // ي -> ی
    .replace(/\u0647/g, "\u06C1"); // ه -> ہ
}

/**
 * Stage 3A: Decode Arabic/Persian Presentation Forms (\uFB50-\uFDFF, \uFE70-\uFEFF)
 * and strip invisible directional control characters.
 */
export function normalizePresentationFormsAndUrduChars(rawText) {
  if (!rawText) return "";
  let s = String(rawText);

  // Strip zero-width & directional control characters that corrupt word boundaries in TTS
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");

  // Map specific Urdu presentation forms BEFORE generic NFKC so Heh Goal (ہ) vs Do-Chashmi Heh (ھ) distinction is preserved
  s = s
    .replace(/[\uFBA6-\uFBA9]/g, "ہ") // Heh goal presentation forms
    .replace(/[\uFBAA-\uFBAD]/g, "ھ") // Do-chashmi heh presentation forms
    .replace(/[\uFBFC-\uFBFF]/g, "ی") // Farsi Yeh presentation forms
    .replace(/[\uFBAE\uFBAF]/g, "ے") // Yeh barree presentation forms
    .replace(/[\uFB8E-\uFB91]/g, "ک") // Keheh presentation forms
    .replace(/[\uFB92-\uFB95]/g, "گ") // Gaf presentation forms
    .replace(/[\uFB9E\uFB9F]/g, "ں") // Noon ghunna presentation forms
    .replace(/[\uFB66-\uFB69]/g, "ٹ") // Tteh presentation forms
    .replace(/[\uFB88\uFB89]/g, "ڈ") // Ddal presentation forms
    .replace(/[\uFB8C\uFB8D]/g, "ڑ") // Rreh presentation forms
    .replace(/[\uFB56-\uFB59]/g, "پ") // Peh presentation forms
    .replace(/[\uFB7A-\uFB7D]/g, "چ") // Tcheh presentation forms
    .replace(/[\uFB8A\uFB8B]/g, "ژ"); // Jeh presentation forms

  // Decode any remaining Arabic Presentation Forms-A and Forms-B via NFKC,
  // while preserving single-character Islamic honorific ligatures ﷺ (\uFDFA) and ﷻ (\uFDFB)
  // so visual word tokens match originalText 1-to-1
  s = s.replace(
    /[\uFB50-\uFDF9\uFDFC\uFDFE-\uFDFF\uFE70-\uFEFF]+/g,
    (match) => match.normalize("NFKC")
  );

  return s;
}

/**
 * Helper: Score logical RTL orthographic & lexical plausibility of a line of Urdu/Arabic text.
 * Used to detect and automatically repair Visual LTR (reversed character order) PDF text layers,
 * and to identify non-Unicode font-encoding gibberish layers.
 */
export function scoreRtlPlausibility(text) {
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
    const asAr = canonicalizeTextForLanguage(w, "ar");
    const asUr = canonicalizeTextForLanguage(w, "ur");

    // 1. Direct lexicon hit
    if (KNOWN_WORDS_SET.has(w) || KNOWN_WORDS_SET.has(asAr) || KNOWN_WORDS_SET.has(asUr)) {
      score += 4;
      recognizedWords++;
      continue;
    }

    // 2. Orthographic violation: in Urdu/Arabic, NO word can ever start with ے، ں، ة، ۃ
    if (/^[ےںةۃ]/.test(w)) {
      score -= 6;
      initialFinalViolations++;
      continue;
    }

    // 3. Valid Arabic definite article prefix (ال / وال / بال / فال / كال / لل)
    if (/^(?:ال|وال|بال|فال|كال|لل)[\u0621-\u06D3]{2,}$/.test(asAr)) {
      score += 3;
      recognizedWords++;
      continue;
    }

    // 4. Valid word-final letters (ے، ں، ة، ۃ، ى) or valid plural/morphological suffixes
    if (
      /[ےںةۃى]$/.test(w) ||
      /(?:وں|یں|ات|ان|ین|ين|ون|ہا|ها|ہم|هم|کم|كم|نا|تہ|نہ|یہ)$/.test(w)
    ) {
      score += 2;
      recognizedWords++;
      continue;
    }

    // 5. Suspicious reversed Arabic definite article suffix (...لا at end of 4+ char word)
    if (w.length >= 4 && w.endsWith("لا") && !w.startsWith("ال")) {
      score -= 3;
    }
  }

  return {
    score,
    recognizedWords,
    totalWords: words.length,
    initialFinalViolations,
  };
}

/**
 * Helper: Detect if a line from a PDF text layer is stored in Visual Left-to-Right
 * (reversed character order) — either whole-line reversed or per-token character reversed —
 * and automatically reverse it into Logical Right-to-Left order.
 */
export function detectAndFixVisualRtlReversal(lineText) {
  const line = String(lineText || "").trim();
  if (!line || line.length < 3 || !/[\u0600-\u06FF\u0750-\u077F]/.test(line)) {
    return line;
  }

  const forwardStats = scoreRtlPlausibility(line);

  // Fast path: if forward text has no word-initial [ےںةۃ] violations and >= 35% recognized words, keep as-is
  if (
    forwardStats.initialFinalViolations === 0 &&
    forwardStats.totalWords > 0 &&
    forwardStats.recognizedWords / forwardStats.totalWords >= 0.35
  ) {
    return line;
  }

  // Candidate A: Whole-line character reversal
  const wholeReversed = [...line].reverse().join("");
  const wholeRevStats = scoreRtlPlausibility(wholeReversed);

  // Candidate B: Per-token character reversal (when X-sorting already ordered words RTL, but chars inside each item were LTR)
  const perTokenReversed = line
    .split(/\s+/)
    .map((tk) => (/[\u0600-\u06FF\u0750-\u077F]/.test(tk) ? [...tk].reverse().join("") : tk))
    .join(" ");
  const tokenRevStats = scoreRtlPlausibility(perTokenReversed);

  let bestText = line;
  let bestScore = forwardStats.score;

  if (wholeRevStats.score >= bestScore + 3 && wholeRevStats.recognizedWords > forwardStats.recognizedWords) {
    bestText = wholeReversed;
    bestScore = wholeRevStats.score;
  }
  if (tokenRevStats.score >= bestScore + 3 && tokenRevStats.recognizedWords > forwardStats.recognizedWords) {
    bestText = perTokenReversed;
  }

  return bestText;
}

/**
 * Helper: Segment a continuous string of single Arabic/Urdu characters into intact words
 * using longest-prefix dictionary lookahead + orthographic boundary rules.
 */
function segmentLetterRunIntoWords(letterTokens) {
  const n = letterTokens.length;
  if (n === 0) return [];
  if (n === 1) return [letterTokens[0]];

  const baseChars = letterTokens.map((t) =>
    t.replace(/[\u064B-\u065F\u0670۔،؛؟!:"'«»﴿﴾\(\)\[\]]/g, "")
  );

  // Check if the single-letter run is reversed (Visual LTR order)
  const forwardJoined = baseChars.join("");
  const reverseJoined = [...baseChars].reverse().join("");
  let forwardHits = 0;
  let reverseHits = 0;
  for (const kw of ["وسوسہ", "شیطان", "ہتھیار", "ایمان", "مومن", "اللہ", "رسول", "حدیث", "قرآن", "نماز", "الحمد", "العالمين"]) {
    if (forwardJoined.includes(kw)) forwardHits += 2;
    if (reverseJoined.includes(kw)) reverseHits += 2;
  }
  const tokens =
    reverseHits > forwardHits && reverseHits >= 2
      ? [...letterTokens].reverse()
      : letterTokens;
  const bases = tokens.map((t) =>
    t.replace(/[\u064B-\u065F\u0670۔،؛؟!:"'«»﴿﴾\(\)\[\]]/g, "")
  );

  const matchKnownWordAt = (startIdx) => {
    const remainingLen = tokens.length - startIdx;
    if (remainingLen < 2) return 0;
    const sub = bases.slice(startIdx, Math.min(tokens.length, startIdx + 10)).join("");
    for (const kw of SORTED_KNOWN_WORDS) {
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

  const resultWords = [];
  let currentWord = "";
  let currentClean = "";
  let idx = 0;

  while (idx < tokens.length) {
    if (!currentWord) {
      const matchLen = matchKnownWordAt(idx);
      if (matchLen >= 2) {
        let built = "";
        for (let m = 0; m < matchLen; m++) {
          built += tokens[idx + m];
          if (/[۔،؛؟!:]$/.test(tokens[idx + m])) {
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

    const piece = tokens[idx];
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

    if (STRICTLY_WORD_FINAL_CHARS.has(baseChar) && currentClean.length >= 2) {
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

    if (KNOWN_WORDS_SET.has(currentClean) && idx < tokens.length) {
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
      idx < tokens.length &&
      (NON_CONNECTING_AFTER_CHARS.has(baseChar) || currentClean.length >= 3)
    ) {
      const lookaheadMatchLen = matchKnownWordAt(idx);
      if (lookaheadMatchLen >= 2) {
        resultWords.push(currentWord);
        currentWord = "";
        currentClean = "";
        continue;
      }
    }
  }

  if (currentWord) {
    resultWords.push(currentWord);
  }

  return resultWords;
}

/**
 * Stage 3B: Detect & Rejoin Disconnected Urdu/Arabic Letters + Auto-Fix Visual LTR Reversal
 */
export function rejoinFragmentedUrduArabicLetters(inputText) {
  if (!inputText) return "";
  const normalized = normalizePresentationFormsAndUrduChars(inputText);

  const lines = normalized.split(/\n+/);
  const repairedLines = lines.map((rawLine) => {
    const line = detectAndFixVisualRtlReversal(rawLine.trim());
    const rawTokens = line.split(/\s+/).filter(Boolean);
    if (rawTokens.length < 2) return line;

    const isSingleLetterToken = (tk) => {
      const stripped = tk.replace(/[۔،؛؟!:"'«»﴿﴾\(\)\[\]]/g, "");
      return SINGLE_AR_UR_LETTER_REGEX.test(stripped);
    };

    const singleCount = rawTokens.filter(isSingleLetterToken).length;
    if (singleCount < 2) {
      return detectAndFixVisualRtlReversal(rawTokens.join(" "));
    }

    const outputTokens = [];
    let i = 0;

    while (i < rawTokens.length) {
      if (isSingleLetterToken(rawTokens[i])) {
        let j = i;
        while (j < rawTokens.length && isSingleLetterToken(rawTokens[j])) {
          j++;
        }
        const runLength = j - i;

        if (runLength === 1) {
          const singleChar = rawTokens[i];
          if (
            singleChar !== "و" &&
            outputTokens.length > 0 &&
            DUAL_JOINING_LETTERS_REGEX.test(
              outputTokens[outputTokens.length - 1].slice(-1)
            )
          ) {
            outputTokens[outputTokens.length - 1] += singleChar;
          } else {
            outputTokens.push(singleChar);
          }
          i++;
          continue;
        }

        const reconstructed = segmentLetterRunIntoWords(rawTokens.slice(i, j));
        outputTokens.push(...reconstructed);
        i = j;
      } else {
        outputTokens.push(rawTokens[i]);
        i++;
      }
    }

    return detectAndFixVisualRtlReversal(outputTokens.join(" "));
  });

  return repairedLines.join("\n").trim();
}

/**
 * Stage 3C: Validate Urdu/Arabic Text Before TTS (including Lexical & Orthographic Gibberish Check)
 */
export function validateUrduArabicText(rawText) {
  const repaired = rejoinFragmentedUrduArabicLetters(rawText);
  const clean = repaired.replace(/\s+/g, " ").trim();

  if (!clean) {
    return {
      isValid: false,
      repairedText: "",
      errorCode: "TEXT_EXTRACTION_FAILED",
      reason: "النص فارغ بعد المعالجة",
      singleLetterRatio: 1,
      avgWordLength: 0,
    };
  }

  const hasValidScript = /[\u0600-\u06FF\u0750-\u077F]/.test(clean);
  const puaMatches = (clean.match(/[\uE000-\uF8FF\uFFFD]/g) || []).length;

  const words = clean
    .split(/\s+/)
    .map((w) => w.replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–-]/g, ""))
    .filter(Boolean);

  if (!hasValidScript || words.length === 0) {
    return {
      isValid: false,
      repairedText: clean,
      errorCode: "INVALID_TEXT",
      reason: "لا يحتوي النص على حروف عربية أو أردية صالحة",
      singleLetterRatio: 1,
      avgWordLength: 0,
    };
  }

  const singleLetterWords = words.filter(
    (w) => w.length === 1 && w !== "و"
  ).length;
  const singleLetterRatio = singleLetterWords / Math.max(1, words.length);
  const totalChars = words.reduce((acc, w) => acc + w.length, 0);
  const avgWordLength = totalChars / Math.max(1, words.length);

  // Check lexical & orthographic plausibility to detect legacy non-Unicode font mapping gibberish
  const plausibility = scoreRtlPlausibility(clean);
  const isFontEncodingGibberish =
    words.length >= 6 &&
    (plausibility.score < -4 ||
      (plausibility.recognizedWords === 0 && words.length >= 8) ||
      plausibility.initialFinalViolations >= Math.ceil(words.length * 0.25));

  const isCorrupted =
    puaMatches > Math.max(2, words.length * 0.2) ||
    (words.length >= 4 && singleLetterRatio > 0.25) ||
    (words.length >= 4 && avgWordLength < 1.8) ||
    isFontEncodingGibberish;

  return {
    isValid: !isCorrupted,
    repairedText: clean,
    errorCode: isCorrupted ? "INVALID_TEXT" : null,
    reason: isCorrupted
      ? "تم اكتشاف تقطيع حروف أو رموز خطوط غير قياسية في طبقة النص — يتطلب الاستخراج البصري (OCR)"
      : null,
    singleLetterRatio: Math.round(singleLetterRatio * 100) / 100,
    avgWordLength: Math.round(avgWordLength * 100) / 100,
  };
}

/**
 * 1. Normalize Urdu/Arabic Unicode characters for TTS pronunciation without changing author's wording.
 *    If `targetLang` ('ar' | 'ur') is known, canonicalizes characters to that language's standard Unicode block.
 */
export function normalizeUrduTextForPronunciation(rawText, targetLang = null) {
  if (!rawText) return "";
  let s = rejoinFragmentedUrduArabicLetters(rawText);

  // Strip isolated footnote markers like (1), [١], *, † and OCR noise symbols from spoken audio layer
  s = s
    .replace(/\[\d+\]|\(\d+\)|\[[٠-٩۰-۹]+\]|\([٠-٩۰-۹]+\)/g, " ")
    .replace(/[~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ");

  s = s
    .replace(/\s+/g, " ")
    .replace(/\s+([۔.،؛؟!:])/g, "$1")
    .trim();

  const resolvedLang = targetLang || (detectIsUrduScript(s) ? "ur" : "ar");
  return canonicalizeTextForLanguage(s, resolvedLang);
}

/**
 * 2. Detect whether a text segment is Urdu (`true`) or Arabic (`false`).
 *
 * CRITICAL DIAGNOSTIC FIX (v4):
 * - Never includes shared Arabic words ("ان", "بعد", "تم", "طرح", "اس") in Urdu particle detection.
 * - Compares strict Urdu-only letters (`ٹ ڈ ڑ ں ے ھ پ چ ژ گ`) and 100% exclusive Urdu functional words
 *   against Classical Arabic definite articles (`ال / وال / بال / فال / كال / لل`), prepositions, and markers.
 * - If a segment has 0 strict Urdu letters and 0 exclusive Urdu words, it is 100% Arabic (`false`)!
 */
export function detectIsUrduScript(text) {
  const s = normalizePresentationFormsAndUrduChars(String(text || ""));
  if (!s) return false;

  const strictUrduChars = (s.match(STRICT_URDU_ONLY_CHARS_REGEX) || []).length;
  const exclusiveUrduWords = (s.match(EXCLUSIVE_URDU_WORDS_REGEX) || []).length;

  const arabicMarkers = (s.match(ARABIC_DEFINITE_AND_MARKERS_REGEX) || []).length;
  const arabicAlMatches = (
    s.match(/(?:^|\s)(?:ال|وال|بال|كال|فال|لل)[\u0621-\u064A\u0671-\u06D3]{2,}/g) || []
  ).length;
  const strictArabicChars = (s.match(/[ةىإأؤئ]/g) || []).length;
  const tashkeelCount = (s.match(/[\u064B-\u0652\u0670]/g) || []).length;

  const urduScore = strictUrduChars * 2.5 + exclusiveUrduWords * 3.5;
  const arabicScore =
    arabicMarkers * 2.5 +
    arabicAlMatches * 2.5 +
    strictArabicChars * 1.5 +
    (tashkeelCount >= 3 ? 3 : 0);

  if (urduScore === 0) {
    return false;
  }

  // If the sentence contains 2 or more 100%-exclusive Urdu grammatical words (e.g. "اور", "کا", "کے", "کی", "ہے", "میں")
  // and does not have heavy Arabic vocalization (tashkeel) or multiple Arabic "ال..." words, it is an Urdu sentence
  // that merely embeds an Islamic phrase like "رضي الله عنهم" or "رحمه الله".
  if (exclusiveUrduWords >= 2 && arabicAlMatches <= 1 && tashkeelCount < 4) {
    return true;
  }

  return urduScore >= arabicScore;
}

/**
 * 3. Detect language and Islamic text category of a sentence or segment
 *    Returns: { language: 'ur' | 'ar', segmentType: 'quran' | 'hadith' | 'dua' | 'arabic_quote' | 'urdu_body' | 'heading' | 'footnote' }
 */
export function classifyTextSegment(text, hintType = "") {
  const clean = rejoinFragmentedUrduArabicLetters(String(text || "")).trim();
  if (!clean) {
    return { language: "ar", segmentType: "arabic_quote" };
  }

  const isUrdu = detectIsUrduScript(clean);

  // 1. Explicit Quranic brackets ﴿ ... ﴾ or canonical Quran verse phrase
  if (
    /﴿[^﴾]{6,}﴾/.test(clean) ||
    (hintType === "quran" && !isUrdu) ||
    (!isUrdu && containsCanonicalQuranPhrase(clean))
  ) {
    return { language: "ar", segmentType: "quran" };
  }

  // 2. Headings and Footnotes preserve their detected language (ur vs ar)
  if (hintType === "heading" || hintType === "footnote") {
    return { language: isUrdu ? "ur" : "ar", segmentType: hintType };
  }

  // 3. If the segment is written in Urdu, classify as Urdu body ('ur')
  if (isUrdu) {
    return {
      language: "ur",
      segmentType: "urdu_body",
    };
  }

  // 4. Segment is written in Arabic script (not Urdu):
  if (hintType === "hadith" || HADITH_ARABIC_MARKER_REGEX.test(clean)) {
    return {
      language: "ar",
      segmentType: "hadith",
    };
  }

  if (hintType === "dua" || DUA_MARKER_REGEX.test(clean)) {
    return {
      language: "ar",
      segmentType: "dua",
    };
  }

  return {
    language: "ar",
    segmentType: "arabic_quote",
  };
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
    .replace(/[ةۃہ]/g, "ه")
    .replace(/[ىیے]/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/\s+/g, " ")
    .trim();
}

function containsCanonicalQuranPhrase(text) {
  const norm = normalizeForQuickArabicMatch(text);
  return CANONICAL_QURAN_SUBSTRINGS.some((p) => norm.includes(p));
}

function hasSpeakableLetters(str) {
  return /[\u0600-\u06FF\u0750-\u077F\w]/.test(String(str || ""));
}

/**
 * 4. Split a block into meaningful prosody sentences & mixed-language segments
 *    - Separates inline Quranic verses ﴿...﴾ into standalone 'quran' segments.
 *    - Separates bilingual clauses separated by em-dash (`—` / `–`) or colon (`:`) when language switches (`Arabic <-> Urdu`).
 *    - Separates inline Arabic Hadith / quotes («...», "...", “...”) ONLY when surrounded by Urdu commentary;
 *      if the preceding intro clause is ALREADY Arabic (e.g., `قال رسول الله ﷺ: «...»`), keeps them unified in one Arabic sentence!
 */
export function segmentBlockIntoSentences(block, blockIndex = 0) {
  const rawInput = String(block?.originalText || block?.text || "").trim();
  if (!rawInput || !hasSpeakableLetters(rawInput)) return [];

  let rawText = rejoinFragmentedUrduArabicLetters(rawInput);
  const blockContainsUrdu = detectIsUrduScript(rawText);

  // Pre-step 1: If a line contains an em-dash `—` or `–` separating an Arabic clause from an Urdu clause
  // (e.g. "كيف تنقذ نفسك من ورطة الوسوسة؟ — وسوسے کے جال سے نجات کا نبوی منہج"), replace the dash with a sentence break
  if (/\s+[—–-]\s+/.test(rawText)) {
    const dashParts = rawText.split(/\s+[—–-]\s+/).filter(Boolean);
    if (dashParts.length === 2 && detectIsUrduScript(dashParts[0]) !== detectIsUrduScript(dashParts[1])) {
      rawText = `${dashParts[0].replace(/[۔.؟!]+$/, "")}۔\n${dashParts[1]}`;
    }
  }

  // Pre-step 2: If an Urdu sentence introduces an unquoted Arabic Hadith/Dua after a colon (e.g. `آپ ﷺ نے فرمایا: ذَلِكَ صَرِيحُ الْإِيمَانِ۔`)
  // wrap the Arabic clause in «...» so it gets cleanly isolated as an Arabic segment!
  if (blockContainsUrdu) {
    rawText = rawText.replace(
      /((?:فرمایا|ارشاد ہے|حدیث میں ہے|دعا ہے)\s*[:：]\s*)(?![«﴿"“])([^۔.؟!\n]{8,}[۔.؟!]?)/g,
      (full, intro, clause) => {
        const cleanClause = clause.replace(/[۔.؟!]+$/, "").trim();
        if (!detectIsUrduScript(cleanClause)) {
          return `${intro}«${cleanClause}»۔ `;
        }
        return full;
      }
    );
  }

  // Step 1: Split out inline Quranic verses ﴿...﴾ and (when block contains Urdu) inline quotes «...» / "..." / “...”
  const tokenRegex = blockContainsUrdu
    ? /(﴿[^﴾]{6,}﴾[۔.؟!،؛]*|«[^»]{6,}»[۔.؟!،؛]*|"[^"]{8,}"[۔.؟!،؛]*|“[^”]{8,}”[۔.؟!،؛]*)/g
    : /(﴿[^﴾]{6,}﴾[۔.؟!،؛]*)/g;
  const parts = [];
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(rawText)) !== null) {
    const token = match[0].trim();

    if (match.index > lastIdx) {
      const before = rawText
        .slice(lastIdx, match.index)
        .replace(/^[۔.،؛:\s]+/, "")
        .trim();

      if (before && hasSpeakableLetters(before)) {
        // If `token` is a non-Quran Arabic quote «...» and `before` is ALSO pure Arabic (e.g. "قال رسول الله ﷺ:"),
        // merge `before` directly with `token` so the Arabic intro and Arabic quote are read as ONE seamless sentence!
        if (!token.startsWith("﴿")) {
          const innerCheck = token
            .replace(/[۔.؟!،؛]+$/, "")
            .replace(/^[«"“]+|[»"”]+$/g, "")
            .trim();
          if (!detectIsUrduScript(before) && !detectIsUrduScript(innerCheck)) {
            const combinedAr = `${before} ${token.replace(/[۔.؟!،؛]+$/, "").trim()}`;
            const isDuaCtx = block?.blockType === "dua" || DUA_MARKER_REGEX.test(combinedAr);
            const isHadithCtx =
              block?.blockType === "hadith" || HADITH_ARABIC_MARKER_REGEX.test(combinedAr);
            parts.push({
              text: combinedAr,
              forcedType: isDuaCtx ? "dua" : isHadithCtx ? "hadith" : "arabic_quote",
            });
            lastIdx = match.index + match[0].length;
            continue;
          }
        }
        parts.push({ text: before, forcedType: null });
      }
    }

    if (token.startsWith("﴿")) {
      const cleanVerse = token.replace(/[۔.؟!،؛]+$/, "").trim();
      parts.push({ text: cleanVerse, forcedType: "quran" });
    } else {
      const inner = token
        .replace(/[۔.؟!،؛]+$/, "")
        .replace(/^[«"“]+|[»"”]+$/g, "")
        .trim();
      const isInnerUrdu = detectIsUrduScript(inner);
      if (!isInnerUrdu) {
        const precedingText = rawText.slice(
          Math.max(0, match.index - 90),
          match.index
        );
        const isDuaContext =
          block?.blockType === "dua" || DUA_MARKER_REGEX.test(inner);
        const isHadithContext =
          block?.blockType === "hadith" ||
          HADITH_URDU_INTRO_REGEX.test(precedingText) ||
          HADITH_ARABIC_MARKER_REGEX.test(precedingText + " " + inner);
        parts.push({
          text: token.replace(/[۔.؟!،؛]+$/, "").trim(),
          forcedType: isDuaContext
            ? "dua"
            : isHadithContext
            ? "hadith"
            : "arabic_quote",
        });
      } else {
        parts.push({ text: token, forcedType: null });
      }
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < rawText.length) {
    const tail = rawText
      .slice(lastIdx)
      .replace(/^[۔.،؛:\s]+/, "")
      .trim();
    if (tail && hasSpeakableLetters(tail)) {
      parts.push({ text: tail, forcedType: null });
    }
  }

  const sentences = [];
  for (const part of parts) {
    if (!hasSpeakableLetters(part.text)) continue;

    if (part.forcedType === "quran") {
      const cleaned = normalizeUrduTextForPronunciation(part.text, "ar");
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      sentences.push({
        originalText: part.text,
        cleanedPronunciationText: cleaned,
        segmentType: "quran",
        language: "ar",
        surahNumber: block?.surahNumber || 0,
        ayahNumber: block?.ayahNumber || 0,
        blockIndex,
        box2d: block?.box2d || null,
        words: words.map((w, idx) => ({
          word: w,
          text: w,
          wordIndex: idx,
          rect: null,
        })),
      });
      continue;
    }

    if (
      part.forcedType === "hadith" ||
      part.forcedType === "dua" ||
      part.forcedType === "arabic_quote"
    ) {
      sentences.push(
        buildSentenceObject(
          part.text,
          { ...block, blockType: part.forcedType },
          blockIndex,
          part.forcedType
        )
      );
      continue;
    }

    // Split on major sentence terminators: Urdu full stop (۔), question mark (؟), exclamation (!), period (.), newline (\n)
    const rawChunks = part.text
      .split(/(?<=[۔؟!\.\n])\s+/)
      .map((c) => c.replace(/^[۔.،؛:\s—–-]+/, "").trim())
      .filter((c) => c && hasSpeakableLetters(c));

    let buffer = "";
    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i];

      if (!buffer) {
        buffer = chunk;
        continue;
      }

      const bufferIsUrdu = detectIsUrduScript(buffer);
      const chunkIsUrdu = detectIsUrduScript(chunk);
      const sameLanguage = bufferIsUrdu === chunkIsUrdu;

      // Only merge short clauses if they share the EXACT SAME language (never merge Urdu into Arabic!)
      if (
        sameLanguage &&
        buffer.length + chunk.length < 155 &&
        (!/[۔؟!\.]$/.test(buffer) || buffer.length < 22)
      ) {
        buffer = `${buffer} ${chunk}`;
      } else {
        sentences.push(buildSentenceObject(buffer, block, blockIndex));
        buffer = chunk;
      }
    }
    if (buffer && hasSpeakableLetters(buffer)) {
      sentences.push(buildSentenceObject(buffer, block, blockIndex));
    }
  }

  return sentences;
}

function buildSentenceObject(text, block, blockIndex, forcedSegmentType = null) {
  const hint =
    forcedSegmentType ||
    (block?.blockType === "heading" ||
    block?.blockType === "footnote" ||
    block?.blockType === "hadith" ||
    block?.blockType === "dua"
      ? block.blockType
      : "");
  const classification = classifyTextSegment(text, hint);

  const resolvedLanguage =
    forcedSegmentType === "hadith" ||
    forcedSegmentType === "dua" ||
    forcedSegmentType === "arabic_quote" ||
    forcedSegmentType === "quran"
      ? "ar"
      : classification.language;

  const resolvedSegmentType =
    forcedSegmentType ||
    (block?.blockType === "quran" && resolvedLanguage === "ar"
      ? "quran"
      : classification.segmentType);

  const cleaned = normalizeUrduTextForPronunciation(text, resolvedLanguage);
  const words = cleaned.split(/\s+/).filter(Boolean);

  return {
    originalText: canonicalizeTextForLanguage(text, resolvedLanguage),
    cleanedPronunciationText: cleaned,
    language: resolvedLanguage,
    segmentType: resolvedSegmentType,
    surahNumber: block?.surahNumber || 0,
    ayahNumber: block?.ayahNumber || 0,
    blockIndex,
    box2d: block?.box2d || null,
    words: words.map((w, idx) => ({
      word: w,
      text: w,
      wordIndex: idx,
      rect: null,
    })),
  };
}

/**
 * 5. Extract native PDF text layer + coordinates and evaluate OCR quality
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
  // Check cache first (only return cached data if not forcing fresh OCR and cached page has pipelineVersion === 4)
  if (!forceOcr) {
    const cached = await getCachedPageOcr(bookId, pageNumber);
    if (
      cached?.data &&
      Array.isArray(cached.data.sentences) &&
      cached.data.sentences.length > 0 &&
      cached.data.pipelineVersion === 4
    ) {
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

  // Stage 1: Analyze native PDF text layer quality, coalesce RTL glyphs safely, & repair fragmented/reversed letters
  const analysis = analyzeNativePdfTextLayer(nativeItems, pageViewport);

  // Build blocks from native PDF text items with bounding-box coordinates
  const blocksFromNative = buildBlocksFromNativeItems(
    analysis.orderedLines,
    pageViewport
  );

  // Stage 2: Trigger OCR whenever:
  // 1) forceOcr is explicitly requested, OR
  // 2) Native PDF text layer yielded 0 blocks / < 20 chars (scanned image PDF), OR
  // 3) autoOcrEnabled is true and native layer has Nastaliq/glyph/font-table corruption (needsOcr or qualityScore < 70)
  const isNativeEmpty =
    blocksFromNative.length === 0 || analysis.rawText.trim().length < 20;
  const shouldRunOcr =
    pdfPage &&
    (forceOcr ||
      isNativeEmpty ||
      (autoOcrEnabled && (analysis.needsOcr || analysis.qualityScore < 70)));

  if (shouldRunOcr) {
    try {
      const ocrResult = await runGeminiVisionOcrOnPdfPage(
        pdfPage,
        pageNumber,
        analysis.isCorruptedLayer ? "" : analysis.rawText
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
          extractionSource: ocrResult.engine || "gemini-vision-ocr",
          qualityScore: ocrResult.qualityScore ?? 94,
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

  let finalBlocks = analysis.isCorruptedLayer ? [] : blocksFromNative;
  let finalSource = "pdf-text-layer";
  let finalQuality = analysis.qualityScore;

  // Only fall back to WASWASA_STRUCTURED_PAGES if the open book is actually the Waswasa sample book
  // or explicitly provides structured_pages in bookMetadata.
  if (!finalBlocks || finalBlocks.length === 0) {
    const candidatePages =
      Array.isArray(bookMetadata?.structured_pages) &&
      bookMetadata.structured_pages.length > 0
        ? bookMetadata.structured_pages
        : isSampleWaswasaBook(bookId, bookMetadata)
        ? WASWASA_STRUCTURED_PAGES
        : null;

    if (Array.isArray(candidatePages) && candidatePages.length > 0) {
      const exactPage =
        candidatePages.find((p) => Number(p.pageNumber) === Number(pageNumber)) ||
        candidatePages[
          (Math.max(1, Number(pageNumber) || 1) - 1) % candidatePages.length
        ];
      if (
        exactPage &&
        Array.isArray(exactPage.blocks) &&
        exactPage.blocks.length > 0
      ) {
        finalBlocks = exactPage.blocks;
        finalSource = "bilingual-structured-ocr";
        finalQuality = 96;
      }
    }
  }

  const processed = await finalizeStructuredBlocks({
    blocks: finalBlocks,
    pageNumber,
    bookId,
    extractionSource: finalSource,
    qualityScore: finalQuality,
    hasOcrWarnings: finalQuality < 70,
    ocrWarningMessage:
      finalQuality < 70
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
 * Helper: Subdivide a line bounding box `[minX, maxX, normY, normH]` across an array of RTL words
 * proportionally by character length from right to left so every word has accurate PDF coordinates.
 */
function buildProportionalRtlWordItems(words, minX, maxX, normY, normH) {
  if (!words || words.length === 0) return [];
  const spanW = Math.max(20, maxX - minX);
  const weights = words.map((w) => Math.max(1, w.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  let rightCursor = maxX;

  return words.map((w, i) => {
    const wordW = Math.max(12, Math.round((weights[i] / totalWeight) * spanW));
    const itemX = Math.max(minX, rightCursor - wordW);
    rightCursor = Math.max(minX, itemX - 2);
    return {
      str: w,
      normX: itemX,
      normY,
      normW: wordW,
      normH,
    };
  });
}

/**
 * Coalesce RTL PDF.js text items along a line safely:
 * - NEVER glues separate multi-letter words together (`rtlGap` between multi-letter words always preserves a word boundary space).
 * - Only joins touching sub-word single-glyph/combining-mark fragments directly (`rtlGap <= 1`),
 *   and delegates disconnected single-letter runs to `rejoinFragmentedUrduArabicLetters` (dictionary lookahead).
 */
function coalesceRtlLineItems(sortedItems, hasRtl) {
  if (!sortedItems || sortedItems.length === 0) {
    return { lineText: "", coalescedWordItems: [] };
  }
  if (!hasRtl) {
    const text = sortedItems
      .map((it) => it.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { lineText: text, coalescedWordItems: sortedItems };
  }

  let rawJoined = "";
  const coalescedWordItems = [];
  let currentWordItem = null;

  for (let i = 0; i < sortedItems.length; i++) {
    const curr = sortedItems[i];
    const currStr = normalizePresentationFormsAndUrduChars(curr.str || "");
    if (!currStr.trim()) continue;

    if (i === 0 || !currentWordItem) {
      rawJoined = currStr.trim();
      currentWordItem = { ...curr, str: currStr.trim() };
      continue;
    }

    const prev = sortedItems[i - 1];
    const prevStr = normalizePresentationFormsAndUrduChars(prev.str || "");

    const rtlGap = prev.normX - (curr.normX + curr.normW);
    const hadExplicitSpace = /\s$/.test(prev.str) || /^\s/.test(curr.str);
    const prevClean = prevStr.trim();
    const currClean = currStr.trim();
    const isCombiningOnly = /^[\u064B-\u065F\u0670]+$/.test(currClean);
    const prevLastChar = prevClean.slice(-1);
    const prevEndsWithDualJoiner = DUAL_JOINING_LETTERS_REGEX.test(prevLastChar);
    const prevEndsWithWordFinal = STRICTLY_WORD_FINAL_CHARS.has(prevLastChar);

    // Only join directly without space if:
    // 1) Current item is a combining diacritic mark, OR
    // 2) Glyphs are literally touching/overlapping (rtlGap <= 1), no explicit space existed,
    //    previous char connects forward, AND at least one of the two items is a 1-char fragment
    //    (so two separate multi-letter words are NEVER glued together!)
    const shouldJoinDirectly =
      isCombiningOnly ||
      (!hadExplicitSpace &&
        !prevEndsWithWordFinal &&
        prevEndsWithDualJoiner &&
        rtlGap <= 1 &&
        (prevClean.length === 1 || currClean.length === 1) &&
        !KNOWN_WORDS_SET.has(prevClean));

    if (shouldJoinDirectly) {
      rawJoined += currClean;
      const newMinX = Math.min(currentWordItem.normX, curr.normX);
      const newMaxX = Math.max(
        currentWordItem.normX + currentWordItem.normW,
        curr.normX + curr.normW
      );
      currentWordItem.str += currClean;
      currentWordItem.normX = newMinX;
      currentWordItem.normW = newMaxX - newMinX;
    } else {
      coalescedWordItems.push(currentWordItem);
      rawJoined += " " + currClean;
      currentWordItem = { ...curr, str: currClean };
    }
  }

  if (currentWordItem) {
    coalescedWordItems.push(currentWordItem);
  }

  // Run the Urdu/Arabic disconnected-letter rejoiner & Visual LTR reversal fixer across the line
  const repairedLine = rejoinFragmentedUrduArabicLetters(rawJoined);
  const finalWords = repairedLine.split(/\s+/).filter(Boolean);

  const minX = Math.min(...sortedItems.map((i) => i.normX));
  const maxX = Math.max(...sortedItems.map((i) => i.normX + i.normW));
  const minY = Math.min(...sortedItems.map((i) => i.normY));
  const maxH = Math.max(...sortedItems.map((i) => i.normH || 18));

  const alignedWordItems =
    coalescedWordItems.length === finalWords.length
      ? coalescedWordItems
      : buildProportionalRtlWordItems(finalWords, minX, maxX, minY, maxH);

  return { lineText: repairedLine, coalescedWordItems: alignedWordItems };
}

/**
 * 6. Analyze native PDF text layer for Nastaliq / RTL / Font-Table / OCR anomalies
 */
export function analyzeNativePdfTextLayer(items, viewport) {
  if (!items || items.length === 0) {
    return {
      needsOcr: true,
      isCorruptedLayer: false,
      qualityScore: 0,
      rawText: "",
      orderedLines: [],
      anomalies: ["صفحة مصورة بدون طبقة نصية — يتطلب تشغيل محرك OCR المتخصص"],
    };
  }

  const pageWidth = viewport?.width || 600;
  const pageHeight = viewport?.height || 850;

  const lineBuckets = [];
  for (const item of items) {
    const str = String(item.str || "");
    if (!str.trim()) continue;
    const tx = item.transform ? item.transform[4] : 0;
    const ty = item.transform ? item.transform[5] : 0;
    const w = item.width || str.length * 5.5;
    const h = item.height || Math.abs(item.transform?.[3] || 14);

    const normY = Math.round(((pageHeight - ty - h) / pageHeight) * 1000);
    const normX = Math.round((tx / pageWidth) * 1000);
    const normW = Math.max(2, Math.round((w / pageWidth) * 1000));
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
      normW: Math.max(2, Math.min(1000, normW)),
      normH,
    });
  }

  lineBuckets.sort((a, b) => a.normY - b.normY);

  const orderedLines = [];
  const anomalies = [];
  let singleCharTokenCount = 0;
  let totalTokenCount = 0;
  let puaGlyphCount = 0;

  for (let idx = 0; idx < lineBuckets.length; idx++) {
    const b = lineBuckets[idx];
    const hasRtl = b.items.some((it) =>
      /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(it.str)
    );
    if (hasRtl && b.items.length > 1) {
      b.items.sort((x, y) => y.normX + y.normW - (x.normX + x.normW));
    } else {
      b.items.sort((x, y) => x.normX - y.normX);
    }

    const { lineText, coalescedWordItems } = coalesceRtlLineItems(
      b.items,
      hasRtl
    );
    if (!lineText) continue;

    const isIsolatedPageNum =
      (idx === 0 || idx === lineBuckets.length - 1) &&
      /^[-–—\s]*[\d٠-٩۰-۹]{1,4}[-–—\s]*$/.test(lineText);
    if (isIsolatedPageNum) {
      anomalies.push("تم استبعاد رقم الصفحة من نص القراءة الصوتية");
      continue;
    }

    const tokens = lineText.split(/\s+/).filter(Boolean);
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
      items: coalescedWordItems,
      box2d: [minY, minX, maxY, maxX],
      isFootnoteArea: minY > 830,
    });
  }

  const rawText = orderedLines.map((l) => l.text).join("\n");
  if (rawText.trim().length < 20) {
    return {
      needsOcr: true,
      isCorruptedLayer: false,
      qualityScore: 15,
      rawText,
      orderedLines,
      anomalies: ["نص الصفحة قصير جداً أو مصور — يتطلب تشغيل OCR"],
    };
  }

  const validation = validateUrduArabicText(rawText);
  let qualityScore = 95;
  if (puaGlyphCount > 0) {
    qualityScore -= Math.min(55, puaGlyphCount * 10);
    anomalies.push(
      "تم اكتشاف رموز خطوط غير قياسية (Private Use Glyphs) في طبقة PDF"
    );
  }
  if (
    totalTokenCount > 4 &&
    (singleCharTokenCount / totalTokenCount > 0.18 || !validation.isValid)
  ) {
    qualityScore -= 50;
    anomalies.push(
      "تم اكتشاف تقطيع أو ترميز خطوط غير قياسي في طبقة PDF — سيتم استخدام الاستخراج البصري (OCR)"
    );
  }

  return {
    needsOcr: qualityScore < 70 || !validation.isValid,
    isCorruptedLayer: !validation.isValid || qualityScore < 55,
    qualityScore: Math.max(10, qualityScore),
    rawText: validation.repairedText || rawText,
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
    const combinedText = rejoinFragmentedUrduArabicLetters(
      currentLines.map((l) => l.text).join(" ")
    );
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
      cleanedPronunciationText: normalizeUrduTextForPronunciation(
        combinedText,
        cls.language
      ),
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
        /[۔؟!\.]$/.test(prev.text))
    ) {
      flushBlock();
    }
    currentLines.push(line);
  }
  flushBlock();
  return blocks;
}

/**
 * 7. Render PDF page to offscreen Canvas at high-DPI (scale 2.0) and invoke server-side OCR
 */
export async function runGeminiVisionOcrOnPdfPage(
  pdfPage,
  pageNumber,
  rawPdfTextHint = ""
) {
  if (typeof document === "undefined" || !pdfPage) return null;
  const viewport = pdfPage.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const imageBase64 = canvas.toDataURL("image/jpeg", 0.9);

  const res = await fetch("/api/reader/ocr-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64,
      mimeType: "image/jpeg",
      pageNumber,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      rawPdfTextHint,
    }),
  });
  if (!res.ok) {
    const err = new Error(`OCR HTTP ${res.status}`);
    err.code = "OCR_FAILED";
    throw err;
  }
  return await res.json();
}

/**
 * 8. Finalize blocks into sentences, validate Urdu/Arabic text integrity,
 *    assign accurate offset-aware word & sentence coordinates, and verify Quranic verses.
 */
export async function finalizeStructuredBlocks({
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
    const totalSentencesInBlock = blockSentences.length;

    // Only treat `lineItems` as exact word coordinates when they actually come from
    // native PDF text items or Tesseract word bounding boxes (`block.lineItems`).
    const realLineItems =
      Array.isArray(block.lineItems) && block.lineItems.length > 0
        ? block.lineItems
        : null;

    let blockWordCursor = 0;

    for (let sInBlockIdx = 0; sInBlockIdx < totalSentencesInBlock; sInBlockIdx++) {
      const sent = blockSentences[sInBlockIdx];
      const validation = validateUrduArabicText(
        sent.cleanedPronunciationText || sent.originalText
      );
      if (validation.repairedText) {
        sent.cleanedPronunciationText = normalizeUrduTextForPronunciation(
          validation.repairedText,
          sent.language
        );
        sent.originalText = canonicalizeTextForLanguage(
          sent.originalText || validation.repairedText,
          sent.language
        );
        const syncedWords = sent.cleanedPronunciationText
          .split(/\s+/)
          .filter(Boolean);
        sent.words = syncedWords.map((w, idx) => ({
          word: w,
          text: w,
          wordIndex: idx,
          rect: null,
        }));
      }

      let quranMeta = null;
      if (sent.segmentType === "quran") {
        quranMeta = await verifyQuranVerseClient(
          sent.originalText,
          sent.surahNumber,
          sent.ayahNumber,
          reciterId
        );
        if (!quranMeta?.verified) {
          sent.segmentType = "arabic_quote";
          sent.quranUnverifiedNotice = true;
        }
      }

      const sentenceWordSlice =
        realLineItems
          ? realLineItems.slice(
              blockWordCursor,
              blockWordCursor + sent.words.length
            )
          : null;

      // Preserve the exact `block.box2d` when real per-word coordinates don't exist,
      // or compute a tight bounding box from real PDF/OCR word items when they do exist.
      let sentenceBox2d = sent.box2d || block.box2d;
      if (sentenceWordSlice && sentenceWordSlice.length > 0) {
        const sMinY = Math.min(...sentenceWordSlice.map((it) => it.normY));
        const sMaxY = Math.max(
          ...sentenceWordSlice.map((it) => it.normY + (it.normH || 22))
        );
        const sMinX = Math.min(...sentenceWordSlice.map((it) => it.normX));
        const sMaxX = Math.max(
          ...sentenceWordSlice.map((it) => it.normX + (it.normW || 25))
        );
        sentenceBox2d = [
          Math.max(0, sMinY - 4),
          Math.max(0, sMinX - 6),
          Math.min(1000, sMaxY + 4),
          Math.min(1000, sMaxX + 6),
        ];
      }

      const hasExactWordCoords = Boolean(
        sentenceWordSlice && sentenceWordSlice.length > 0
      );

      const wordsWithCoords = assignWordCoordinates(
        sent.words,
        sentenceBox2d,
        sentenceWordSlice,
        pageNumber,
        bIdx
      );

      blockWordCursor += sent.words.length;
      totalWordsCount += wordsWithCoords.length;

      allSentences.push({
        ...sent,
        box2d: sentenceBox2d,
        sentenceIndex: sentenceCounter++,
        bookId,
        pageNumber,
        paragraphIndex: bIdx,
        hasExactWordCoords,
        textValidation: validation,
        words: wordsWithCoords,
        quranMeta,
      });
    }
  }

  return {
    pipelineVersion: 4,
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

/**
 * Assign word metadata (word, pageNumber, paragraphIndex, wordIndex, rect).
 */
function assignWordCoordinates(
  words,
  box2d,
  sentenceWordItems,
  pageNumber = 1,
  paragraphIndex = 0
) {
  if (!words || words.length === 0) return [];

  const hasRealLineItems =
    Array.isArray(sentenceWordItems) &&
    sentenceWordItems.length > 0 &&
    Array.isArray(box2d) &&
    box2d.length >= 4;

  if (!hasRealLineItems) {
    return words.map((w, idx) => ({
      ...w,
      word: w.word || w.text || "",
      text: w.word || w.text || "",
      wordIndex: idx,
      pageNumber,
      paragraphIndex,
      rect: null,
    }));
  }

  return words.map((w, idx) => {
    const matchedItem =
      sentenceWordItems[Math.min(idx, sentenceWordItems.length - 1)];
    if (
      matchedItem &&
      typeof matchedItem.normX === "number" &&
      typeof matchedItem.normY === "number"
    ) {
      return {
        ...w,
        word: w.word || w.text || "",
        text: w.word || w.text || "",
        wordIndex: idx,
        pageNumber,
        paragraphIndex,
        rect: {
          topPct: Math.max(0, Math.min(98, matchedItem.normY / 10)),
          leftPct: Math.max(0, Math.min(98, matchedItem.normX / 10)),
          widthPct: Math.max(2, Math.min(95, (matchedItem.normW || 25) / 10)),
          heightPct: Math.max(1.6, Math.min(25, (matchedItem.normH || 20) / 10)),
        },
      };
    }

    return {
      ...w,
      word: w.word || w.text || "",
      text: w.word || w.text || "",
      wordIndex: idx,
      pageNumber,
      paragraphIndex,
      rect: null,
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
    const baseUrl =
      typeof window !== "undefined" && window.location?.origin
        ? ""
        : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/reader/verify-quran`, {
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
