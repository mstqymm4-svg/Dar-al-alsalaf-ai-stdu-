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
import {
  NOORI_GID_TO_UNI,
  NOORI_SKEL_VARIANTS_TO_ROOT,
  NOORI_SKEL_MARK_TO_UNI,
  NOORI_ROOT_SKEL_LIG_REV,
  NOORI_PRECOMPOSED_GSUB_FIXES,
  TRAD_ARABIC_GID_TO_UNI,
  SALEEM_QURAN_GID_TO_UNI,
} from "./nooriNastaliqGsubMap";

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
  /(?:^|\s)(?:کے|کی|کا|میں|ہے|ہیں|تھا|تھے|تھی|تھیں|اور|پر|سے|کو|نے|بھی|کیونکہ|لیکن|تاکہ|ہوتا|ہوتی|ہوتے|ہوئی|ہوئے|ہوگا|ہوگی|ہوں|کرتا|کرتے|کرتی|کیے|کئے|گیا|گئی|گئے|رہا|رہی|رہے|جائے|جائیں|جاتا|جاتے|جاتی|والا|والے|والی|لیے|لئے|ساتھ|بغیر|ذریعہ|ذریعے|تحت|متعلق|اندر|باہر|پہلے|فرمایا|فرماتے|وسوسے|آپ|اپنے|اپنی|اپنا|نہیں|کبھی|ایسے|ایسا|ایسی|جنہیں|سمجھنا|ہونا|چاہیے|چاہئے|سکتا|سکتے|سکتی|کیا|کیوں|کیسے|کہاں|یہاں|وہاں|بہت|زیادہ|تھوڑا|ہمارا|ہمارے|ہماری|تمہارا|تمہارے|معلومات|وضاحت|تعریف|رہنمائیاں|نشانیاں|بیماریاں|طریقے|مقام|خبردار|سنو|دیکھو|سمجھو|چنانچہ|لہٰذا|البتہ|مگر|بلکہ|کیوں|چونکہ|حالانکہ|اگرچہ)(?=\s|$|[۔،؟!:])/g;

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
  "نیت", "نیتوں", "نیتیں", "اخلاص", "اعمال", "عمل", "عملوں", "مقصد", "مقاصد", "بندہ", "بندے", "بندوں",
  "ثواب", "اجر", "ہجرت", "دنیا", "آخرت", "حلال", "حرام", "مباح", "مستحب", "واجب", "سفر", "مقیم",
  "عذر", "جہاد", "غزوہ", "تبوک", "مدینہ", "شریک", "خرچ", "صدقہ", "نفقہ", "عورت", "شادی", "نکاح",
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
 * - `ur-PK-AsadNeural` expects Standard Urdu `ک` (U+06A9), `ی` (U+06CC), `ہ` (U+06C1),
 *   and pronounces `\u0649` (`ى`, Arabic Alef Maksura) as Fatha/Alif (`-a`) unless converted to `\u06CC` (`ی`)!
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
    .replace(/[\u0649\u064A]/g, "\u06CC") // ى / ي -> ی (critical so ur-PK-AsadNeural reads Kasra/Ye instead of Fatha/Alif)
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

  // Fast path: if forward text has no word-initial [ےںةۃ] violations, NEVER reverse tokens
  // (reversing tokens without word-initial violations turns valid words like "نیت" into "تین" or scrambles vocalized Arabic!)
  if (forwardStats.initialFinalViolations === 0) {
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

  // Normalize Indo-Pak/Arabic variants (ك -> ک, ى/ي -> ی, ه -> ہ) before matching exclusive Urdu words
  // so Urdu text using Arabic Kaf/Alef Maksura (e.g. "مطبع كى معلومات", "اس كامقام") is 100% recognized!
  const sUrNorm = s
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u0647/g, "\u06C1");

  const strictUrduChars = (s.match(STRICT_URDU_ONLY_CHARS_REGEX) || []).length;
  const exclusiveUrduWords = (sUrNorm.match(EXCLUSIVE_URDU_WORDS_REGEX) || []).length;

  const arabicMarkers = (s.match(ARABIC_DEFINITE_AND_MARKERS_REGEX) || []).length;
  const arabicAlMatches = (
    s.match(/(?:^|\s)(?:ال|وال|بال|كال|فال|لل)[\u0621-\u064A\u0671-\u06D3]{2,}/g) || []
  ).length;
  // Do NOT count \u0649 (ى) as a strict Arabic character because Jameel Noori Nastaleeq maps final ی to ى
  const strictArabicChars = (s.match(/[ةإأؤئ]/g) || []).length;
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
  if (exclusiveUrduWords >= 2 && arabicAlMatches <= 2 && tashkeelCount < 4) {
    return true;
  }

  // Short Urdu headings or phrases with at least 1 exclusive Urdu word (e.g., "مطبع كى معلومات", "حدىث «...» اور اس كامقام")
  const sWithoutQuotes = sUrNorm.replace(/«[^»]*»|﴿[^﴾]*﴾/g, " ").trim();
  const outerUrduWords = (sWithoutQuotes.match(EXCLUSIVE_URDU_WORDS_REGEX) || []).length;
  const wordCount = sWithoutQuotes.split(/\s+/).filter(Boolean).length;
  if ((exclusiveUrduWords >= 1 || outerUrduWords >= 1) && (strictUrduChars >= 1 || wordCount <= 8) && tashkeelCount < 4) {
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
  "فاعبد الله مخلصا له الدين",
  "الا لله الدين الخالص",
  "وقدمنا الي ما عملوا من عمل فجعلناه هباء منثورا",
  "ومن احسن دينا ممن اسلم وجهه لله وهو محسن",
  "بلي من اسلم وجهه لله وهو محسن فله اجره عند ربه",
  "وما امروا الا ليعبدوا الله مخلصين له الدين",
  "فمن كان يرجو لقاء ربه فليعمل عملا صالحا",
  "الذي خلق الموت والحياه ليبلوكم ايكم احسن عملا",
  "لئن اشركت ليحبطن عملك ولتكونن من الخاسرين",
  "قل اني امرت ان اعبد الله مخلصا له الدين",
  "قل الله اعبد مخلصا له ديني",
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
  const s = String(str || "").trim();
  if (!s) return false;
  // Ignore isolated TOC page numbers or punctuation-only strings
  if (/^[\d٠-٩۰-۹\s.۔،؛؟!:"'«»﴿﴾\(\)\[\]—–-]+$/.test(s)) return false;
  return /[\u0621-\u065F\u0670-\u06D3\u0750-\u077Fa-zA-Z]/.test(s);
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
  const rawWithoutQuotes = rawText
    .replace(/﴿[^﴾]*﴾|﴿[^﴾]*$|^[^﴿]*﴾|«[^»]*»|«[^»]*$|^[^«]*»/g, " ")
    .trim();
  const rawUrNorm = rawWithoutQuotes
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u0647/g, "\u06C1");
  const blockContainsUrdu =
    detectIsUrduScript(rawText) ||
    detectIsUrduScript(rawWithoutQuotes) ||
    new RegExp(STRICT_URDU_ONLY_CHARS_REGEX.source).test(rawWithoutQuotes) ||
    new RegExp(EXCLUSIVE_URDU_WORDS_REGEX.source).test(rawUrNorm);

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
  // CRITICAL: Never wrap a clause that already contains Quranic brackets ﴿ or ﴾ or Hadith quotes « or »!
  if (blockContainsUrdu) {
    rawText = rawText.replace(
      /((?:فرمایا|ارشاد ہے|حدیث میں ہے|دعا ہے)\s*[:：]\s*)(?![«﴿"“])([^۔.؟!\n﴿﴾«»]{8,}[۔.؟!]?)/g,
      (full, intro, clause) => {
        const cleanClause = clause.replace(/[۔.؟!]+$/, "").trim();
        if (!detectIsUrduScript(cleanClause)) {
          return `${intro}«${cleanClause}»۔ `;
        }
        return full;
      }
    );
  }

  // Step 1: Split out inline Quranic verses ﴿...﴾ (including cross-page unclosed ﴿... at end or ...﴾ at start)
  // and (when block contains Urdu) inline quotes «...» / "..." / “...” (including unclosed «... at end of page or ...» at start of page)
  const tokenRegex = blockContainsUrdu
    ? /(﴿[^﴾]{4,}﴾(?:\s*\(\s*[\d٠-٩۰-۹]+\s*\))?[۔.؟!،؛]*|﴿[^﴾]{6,}$|^[^﴿]{6,}﴾(?:\s*\(\s*[\d٠-٩۰-۹]+\s*\))?[۔.؟!،؛]*|«[^»]{6,}»[۔.؟!،؛]*|«[^»]{6,}$|^[^«]{6,}»[۔.؟!،؛]*|"[^"]{8,}"[۔.؟!،؛]*|“[^”]{8,}”[۔.؟!،؛]*)/g
    : /(﴿[^﴾]{4,}﴾(?:\s*\(\s*[\d٠-٩۰-۹]+\s*\))?[۔.؟!،؛]*|﴿[^﴾]{6,}$|^[^﴿]{6,}﴾(?:\s*\(\s*[\d٠-٩۰-۹]+\s*\))?[۔.؟!،؛]*)/g;
  const parts = [];
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(rawText)) !== null) {
    const token = match[0].trim();
    const isQuranToken = token.includes("﴿") || token.includes("﴾");

    if (match.index > lastIdx) {
      const before = rawText
        .slice(lastIdx, match.index)
        .replace(/^[۔.،؛:\s]+/, "")
        .trim();

      if (before && hasSpeakableLetters(before)) {
        // If `token` is a non-Quran Arabic quote «...» and `before` is ALSO pure Arabic (e.g. "قال رسول الله ﷺ:"),
        // merge `before` directly with `token` so the Arabic intro and Arabic quote are read as ONE seamless sentence!
        if (!isQuranToken) {
          const innerCheck = token
            .replace(/[۔.؟!،؛]+$/, "")
            .replace(/^[«"“]+|[»"”]+$/g, "")
            .trim();
          const beforeUrNorm = before
            .replace(/\u0643/g, "\u06A9")
            .replace(/[\u0649\u064A]/g, "\u06CC")
            .replace(/\u0647/g, "\u06C1");
          const beforeHasUrdu =
            detectIsUrduScript(before) ||
            new RegExp(STRICT_URDU_ONLY_CHARS_REGEX.source).test(before) ||
            new RegExp(EXCLUSIVE_URDU_WORDS_REGEX.source).test(beforeUrNorm);
          if (!beforeHasUrdu && !detectIsUrduScript(innerCheck)) {
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

    if (isQuranToken) {
      // Extract optional trailing footnote index like (1) or (١) to look up footnoteQuranMap
      let footnoteNum = 0;
      const fnMatch =
        token.match(/﴾\s*\(\s*([\d٠-٩۰-۹]+)\s*\)/) ||
        rawText.slice(match.index + match[0].length, match.index + match[0].length + 14).match(/^\s*\(\s*([\d٠-٩۰-۹]+)\s*\)/);
      if (fnMatch) {
        footnoteNum = parseArabicIndicDigitsToInt(fnMatch[1]);
      }
      const cleanVerse = token
        .replace(/^[«"“]+|[»"”]+$/g, "")
        .replace(/\s*\(\s*[\d٠-٩۰-۹]+\s*\)\s*[۔.؟!،؛]*$/, "")
        .replace(/[۔.؟!،؛]+$/, "")
        .trim();
      parts.push({ text: cleanVerse, forcedType: "quran", footnoteNum });
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
      .replace(/^\s*\(\s*[\d٠-٩۰-۹]+\s*\)\s*/, "")
      .replace(/^[۔.،؛:\s]+/, "")
      .trim();
    if (tail && hasSpeakableLetters(tail)) {
      parts.push({ text: tail, forcedType: null });
    }
  }

  const footnoteQuranMap = block?.footnoteQuranMap || {};
  const sentences = [];
  for (const part of parts) {
    if (!hasSpeakableLetters(part.text)) continue;

    if (part.forcedType === "quran") {
      const cleaned = normalizeUrduTextForPronunciation(part.text, "ar");
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const fnHint =
        (part.footnoteNum && footnoteQuranMap[part.footnoteNum]) ||
        footnoteQuranMap.__first ||
        null;
      sentences.push({
        originalText: part.text,
        cleanedPronunciationText: cleaned,
        segmentType: "quran",
        language: "ar",
        surahNumber: block?.surahNumber || fnHint?.surahNumber || 0,
        ayahNumber: block?.ayahNumber || fnHint?.ayahNumber || 0,
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

const NOORI_ZERO_WIDTH_TAGS = new Set([1649, 1651, 1653, 1654]);

function isNooriMarkGid(c) {
  return (c >= 460 && c <= 484) || (c >= 256 && c <= 270);
}

function decodeIslamicHonorificPua(str) {
  if (!str) return "";
  return String(str)
    .replace(/[\uF048\u1916]/g, " ﷺ ")
    .replace(/\uF049/g, " رضي الله عنه ")
    .replace(/\uF04A/g, " رضي الله عنهما ")
    .replace(/\uF04B/g, " رضي الله عنها ")
    .replace(/[\uF04C\uF04D]/g, " رضي الله عنهم ")
    .replace(/\uF04E/g, " رضي الله عنهن ")
    .replace(/\uF055/g, " رحمهم الله ")
    .replace(/\uF056/g, " رحمه الله ")
    .replace(/\uF04F/g, " عليه السلام ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u0128\u0134\u01B0\u01D6]/g, "");
}

function decodeSingleNooriGlyph(curr) {
  if (curr.c === 12610 && curr.rawU === "ㅂ") {
    return "ب";
  }
  const fixKey = `${curr.c}:${curr.rawU}`;
  if (NOORI_PRECOMPOSED_GSUB_FIXES[fixKey]) {
    return NOORI_PRECOMPOSED_GSUB_FIXES[fixKey].replace(/\u0649/g, "\u06CC");
  }
  let trueU = curr.rawU;
  if (curr.c >= 219 && curr.c <= 306 && NOORI_GID_TO_UNI[curr.c]) {
    trueU = NOORI_GID_TO_UNI[curr.c];
  } else if (NOORI_ROOT_SKEL_LIG_REV[curr.c]) {
    const skels = NOORI_ROOT_SKEL_LIG_REV[curr.c];
    trueU =
      skels
        .map((sk) => NOORI_SKEL_MARK_TO_UNI[`${sk}:none`] || NOORI_GID_TO_UNI[sk] || "")
        .join("") || curr.rawU;
  } else {
    const root = NOORI_SKEL_VARIANTS_TO_ROOT[curr.c];
    if (root && NOORI_SKEL_MARK_TO_UNI[`${root}:none`]) {
      trueU = NOORI_SKEL_MARK_TO_UNI[`${root}:none`];
    }
  }
  return decodeIslamicHonorificPua(
    trueU
      .replace(/\u063E/g, "م")
      .replace(/\u063F/g, "ن")
      .replace(/\u063D/g, "ل")
      .replace(/\u063B/g, "ف")
      .replace(/\u063C/g, "ق")
      .replace(/\u0649/g, "\u06CC") // ى -> ی in Jameel Noori Nastaleeq
  );
}

// Complete 114-Surah Arabic Name -> Surah Number lookup for harvesting footnote Quran citations
const ARABIC_SURAH_NAME_TO_NUMBER = {
  "الفاتحة": 1, "البقرة": 2, "آل عمران": 3, "ال عمران": 3, "النساء": 4, "المائدة": 5, "الأنعام": 6, "الانعام": 6,
  "الأعراف": 7, "الاعراف": 7, "الأنفال": 8, "الانفال": 8, "التوبة": 9, "يونس": 10, "هود": 11, "يوسف": 12,
  "الرعد": 13, "إبراهيم": 14, "ابراهيم": 14, "الحجر": 15, "النحل": 16, "الإسراء": 17, "الاسراء": 17, "الكهف": 18,
  "مريم": 19, "طه": 20, "الأنبياء": 21, "الانبياء": 21, "الحج": 22, "المؤمنون": 23, "النور": 24, "الفرقان": 25,
  "الشعراء": 26, "النمل": 27, "القصص": 28, "العنكبوت": 29, "الروم": 30, "لقمان": 31, "السجدة": 32, "الأحزاب": 33, "الاحزاب": 33,
  "سبأ": 34, "سبا": 34, "فاطر": 35, "يس": 36, "الصافات": 37, "ص": 38, "الزمر": 39, "غافر": 40, "فصلت": 41,
  "الشورى": 42, "الشوري": 42, "الزخرف": 43, "الدخان": 44, "الجاثية": 45, "الأحقاف": 46, "الاحقاف": 46,
  "محمد": 47, "الفتح": 48, "الحجرات": 49, "ق": 50, "الذاريات": 51, "الطور": 52, "النجم": 53, "القمر": 54,
  "الرحمن": 55, "الواقعة": 56, "الحديد": 57, "المجادلة": 58, "الحشر": 59, "الممتحنة": 60, "الصف": 61,
  "الجمعة": 62, "المنافقون": 63, "التغابن": 64, "الطلاق": 65, "التحريم": 66, "الملك": 67, "القلم": 68,
  "الحاقة": 69, "المعارج": 70, "نوح": 71, "الجن": 72, "المزمل": 73, "المدثر": 74, "القيامة": 75,
  "الإنسان": 76, "الانسان": 76, "الدهر": 76, "المرسلات": 77, "النبأ": 78, "النبا": 78, "النازعات": 79,
  "عبس": 80, "التكوير": 81, "الانفطار": 82, "المطففين": 83, "الانشقاق": 84, "البروج": 85, "الطارق": 86,
  "الأعلى": 87, "الاعلى": 87, "الاعلي": 87, "الغاشية": 88, "الفجر": 89, "البلد": 90, "الشمس": 91,
  "الليل": 92, "الضحى": 93, "الضحي": 93, "الشرح": 94, "الانشراح": 94, "التين": 95, "العلق": 96,
  "القدر": 97, "البينة": 98, "الزلزلة": 99, "العاديات": 100, "القارعة": 101, "التكاثر": 102, "العصر": 103,
  "الهمزة": 104, "الفيل": 105, "قريش": 106, "الماعون": 107, "الكوثر": 108, "الكافرون": 109, "النصر": 110,
  "المسد": 111, "الإخلاص": 112, "الاخلاص": 112, "الفلق": 113, "الناس": 114,
};

function parseArabicIndicDigitsToInt(str) {
  if (!str) return 0;
  const ascii = String(str).replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    return d;
  });
  const n = parseInt(ascii.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Detect the horizontal footnote separator rule drawn near the bottom of the PDF page in `opList`.
 * In this book (and standard Arabic/Urdu books), a horizontal path rectangle (width 50..350pt, height <= 3.5pt)
 * is drawn at `ry` between 55pt and 340pt above the bottom of the page.
 */
export function detectFootnoteSeparatorY(opList) {
  if (!opList || !Array.isArray(opList.fnArray) || !Array.isArray(opList.argsArray)) {
    return null;
  }
  let maxSeparatorY = null;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    // OPS.constructPath === 91
    if (fn === 91 && Array.isArray(args) && Array.isArray(args[1])) {
      const coords = args[1];
      if (coords.length >= 4) {
        const rw = Math.abs(Number(coords[2]) || 0);
        const rh = Math.abs(Number(coords[3]) || 0);
        const ry = Number(coords[1]) || 0;
        if (rw >= 45 && rw <= 360 && rh >= 0.1 && rh <= 3.5 && ry >= 55 && ry <= 340) {
          if (maxSeparatorY === null || ry > maxSeparatorY) {
            maxSeparatorY = ry;
          }
        }
      }
    }
  }
  return maxSeparatorY;
}

/**
 * Harvest Surah & Ayah citations from footnote lines (e.g. `(١) (سورة البينة ٥)` or `(٢) (سورة الزمر ٣)`)
 * BEFORE excluding footnote lines from spoken audio, so partial or cross-page Quranic verses on the page
 * resolve 100% to Sheikh Abdul Rahman Al-Sudais!
 */
export function extractFootnoteQuranCitations(footnoteLines) {
  const map = {};
  if (!Array.isArray(footnoteLines) || footnoteLines.length === 0) return map;

  const combinedText = footnoteLines.map((l) => l.text || "").join("\n");
  const citationRegex =
    /(?:[\(\[\{]?\s*([٠-٩۰-۹\d]{1,2})\s*[\)\]\}]?[^\n\(]*?)?\(\s*سور[ةۃ]\s+([^\d٠-٩۰-۹:\)\]]+?)\s*[:：،]?\s*([٠-٩۰-۹\d]{1,3})\s*\)/g;

  let m;
  let seq = 1;
  while ((m = citationRegex.exec(combinedText)) !== null) {
    const fnIdx = parseArabicIndicDigitsToInt(m[1]) || seq;
    const rawSurahName = String(m[2] || "")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/ة|ۃ/g, "ة")
      .replace(/\s+/g, " ")
      .trim();
    const ayahNumber = parseArabicIndicDigitsToInt(m[3]);
    const surahNumber =
      ARABIC_SURAH_NAME_TO_NUMBER[rawSurahName] ||
      ARABIC_SURAH_NAME_TO_NUMBER[rawSurahName.replace(/^[أإآ]/, "ا")] ||
      0;

    if (surahNumber > 0 && ayahNumber > 0) {
      map[fnIdx] = { surahNumber, ayahNumber, surahName: `سورة ${rawSurahName}` };
      if (!map.__first) {
        map.__first = map[fnIdx];
      }
      seq++;
    }
  }
  return map;
}

/**
 * Recover 100% dot-accurate glyph strings from pdf.js getOperatorList() + getTextContent():
 * 1. Fixes pdf.js's character-by-character BiDi reversal of multi-character Urdu/Arabic ligature glyphs.
 * 2. Decodes Jameel Noori Nastaleeq dynamic skeleton+nuqta-mark ligatures (Lookups #30 & #33..48).
 * 3. Decodes embedded Traditional Arabic (TTF #4 & #17) and Muhammadi Quranic (TTF #13) GIDs whose /ToUnicode tables are corrupted.
 * 4. Ignores marked-content tags ("P", "Span") so curFont is never overwritten by non-font operators.
 */
export function recoverTrueGlyphTextItems(items, opList) {
  if (!items || items.length === 0) return [];
  if (!opList || !Array.isArray(opList.fnArray) || !Array.isArray(opList.argsArray)) {
    return items.map((it) => ({
      ...it,
      str: decodeIslamicHonorificPua(String(it.str || ""))
        .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
        .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم"),
    }));
  }

  const fontStats = {};
  let curFont = "";
  const fontStack1 = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === 10) {
      fontStack1.push(curFont);
      continue;
    }
    if (fn === 11) {
      if (fontStack1.length > 0) curFont = fontStack1.pop();
      continue;
    }
    if (!args) continue;
    if (
      args.length === 2 &&
      typeof args[0] === "string" &&
      /^g_d\d+_f\d+$/.test(args[0]) &&
      typeof args[1] === "number"
    ) {
      curFont = args[0];
      if (!fontStats[curFont]) {
        fontStats[curFont] = {
          nooriScore: 0,
          tradArabicScore: 0,
          saleemQuranScore: 0,
        };
      }
    } else if (Array.isArray(args[0]) && curFont && fontStats[curFont]) {
      const st = fontStats[curFont];
      for (const g of args[0]) {
        if (!g || typeof g !== "object" || typeof g.unicode !== "string") continue;
        const c = g.originalCharCode;
        const w = Math.round(g.width || 0);
        const u = g.unicode;

        // 1. Jameel Noori Nastaleeq signatures (exclude MCS Taybah symbol c === 6422)
        if (
          (c === 296 && (w === 9 || w === 1000)) ||
          (c >= 460 && c <= 484 && (w === 0 || w === 1000)) ||
          (c > 2500 && c !== 6422)
        ) {
          st.nooriScore += 3;
        }

        // 2. Traditional Arabic (TTF #4 & #17) signatures
        if (
          (c === 166 && u === "ا") ||
          (c === 190 && u === "ؿ") ||
          (c === 506 && u === " ") ||
          (c === 519 && u === "ْ") ||
          (c === 361 && u === "ب٠") ||
          (c === 365 && u === "ب٤") ||
          (c === 374 && u === "ب٭") ||
          (c >= 200 && c <= 204 && /^[\u064B-\u0652]$/.test(u))
        ) {
          st.tradArabicScore += 5;
        }

        // 3. Muhammadi Quranic (TTF #13) signatures
        if (
          (c === 441 && u === "ا") ||
          (c === 722 && u === "ي") ||
          (c === 720 && u === "و") ||
          (c === 718 && u === "ن") ||
          (c === 732 && u === "ى") ||
          (c === 1741 && u === "فَ") ||
          (c === 1735 && u === "عَ") ||
          (c === 1919 && u === "مِ") ||
          (c >= 472 && c <= 482 && w === 0 && /^[\u064B-\u0652\u0670]$/.test(u)) ||
          (c >= 518 && c <= 527 && /^[\u064B-\u0652\u0670]$/.test(u))
        ) {
          st.saleemQuranScore += 6;
        }
      }
    }
  }

  const fontKindMap = {};
  for (const [fName, st] of Object.entries(fontStats)) {
    if (st.saleemQuranScore >= 12 && st.saleemQuranScore >= st.tradArabicScore) {
      fontKindMap[fName] = "saleem_quran";
    } else if (st.tradArabicScore >= 8) {
      fontKindMap[fName] = "trad_arabic";
    } else if (st.nooriScore > 0) {
      fontKindMap[fName] = "noori";
    } else {
      fontKindMap[fName] = "standard";
    }
  }

  const glyphStream = [];
  curFont = "";
  const fontStack2 = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === 10) {
      fontStack2.push(curFont);
      continue;
    }
    if (fn === 11) {
      if (fontStack2.length > 0) curFont = fontStack2.pop();
      continue;
    }
    if (!args) continue;
    if (
      args.length === 2 &&
      typeof args[0] === "string" &&
      /^g_d\d+_f\d+$/.test(args[0]) &&
      typeof args[1] === "number"
    ) {
      curFont = args[0];
    } else if (Array.isArray(args[0])) {
      const fontKind = fontKindMap[curFont] || "standard";
      for (const g of args[0]) {
        if (g && typeof g === "object" && typeof g.unicode === "string" && g.unicode.length > 0) {
          glyphStream.push({
            rawU: g.unicode,
            trueU: g.unicode,
            c: g.originalCharCode,
            w: Math.round(g.width || 0),
            fontKind,
            fontName: curFont,
          });
        }
      }
    }
  }

  if (glyphStream.length === 0) return items;

  // Decode each glyph according to its font family (noori, trad_arabic, saleem_quran, or standard)
  let idx = 0;
  while (idx < glyphStream.length) {
    const curr = glyphStream[idx];
    if (curr.fontKind === "trad_arabic") {
      const mapped =
        TRAD_ARABIC_GID_TO_UNI[curr.c] !== undefined
          ? TRAD_ARABIC_GID_TO_UNI[curr.c]
          : curr.rawU;
      curr.trueU = decodeIslamicHonorificPua(mapped);
      idx++;
      continue;
    }

    if (curr.fontKind === "saleem_quran") {
      const mapped =
        SALEEM_QURAN_GID_TO_UNI[curr.c] !== undefined
          ? SALEEM_QURAN_GID_TO_UNI[curr.c]
          : curr.rawU;
      curr.trueU = decodeIslamicHonorificPua(mapped)
        .replace(/بٔ/g, "أ")
        .replace(/أ/g, "أ")
        .replace(/إ/g, "إ");
      idx++;
      continue;
    }

    if (curr.fontKind !== "noori") {
      curr.trueU = decodeIslamicHonorificPua(curr.rawU)
        .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
        .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم");
      idx++;
      continue;
    }

    // Jameel Noori Nastaleeq decoding
    if (NOORI_ZERO_WIDTH_TAGS.has(curr.c) && (curr.w === 0 || curr.w === 1000)) {
      curr.trueU = "";
      idx++;
      continue;
    }

    if (
      (isNooriMarkGid(curr.c) || NOORI_ZERO_WIDTH_TAGS.has(curr.c)) &&
      (curr.w === 0 || curr.w === 1000)
    ) {
      const marksLtr = [];
      while (
        idx < glyphStream.length &&
        glyphStream[idx].fontKind === "noori" &&
        (glyphStream[idx].w === 0 || glyphStream[idx].w === 1000) &&
        (isNooriMarkGid(glyphStream[idx].c) || NOORI_ZERO_WIDTH_TAGS.has(glyphStream[idx].c))
      ) {
        if (!NOORI_ZERO_WIDTH_TAGS.has(glyphStream[idx].c)) {
          marksLtr.push(glyphStream[idx].c);
        }
        glyphStream[idx].trueU = "";
        idx++;
      }
      if (idx < glyphStream.length && glyphStream[idx].fontKind === "noori") {
        const base = glyphStream[idx++];
        const baseRoot = NOORI_SKEL_VARIANTS_TO_ROOT[base.c] || base.c;
        const skels = NOORI_ROOT_SKEL_LIG_REV[base.c] || [baseRoot];
        const mQueue = [...marksLtr].reverse();
        const chars = [];
        for (const sk of skels) {
          let matched = null;
          if (
            mQueue.length >= 2 &&
            NOORI_SKEL_MARK_TO_UNI[`${sk}:${mQueue[0]}+${mQueue[1]}`]
          ) {
            matched = NOORI_SKEL_MARK_TO_UNI[`${sk}:${mQueue[0]}+${mQueue[1]}`];
            mQueue.splice(0, 2);
          } else if (
            mQueue.length >= 1 &&
            NOORI_SKEL_MARK_TO_UNI[`${sk}:${mQueue[0]}`]
          ) {
            matched = NOORI_SKEL_MARK_TO_UNI[`${sk}:${mQueue[0]}`];
            mQueue.shift();
          } else {
            matched =
              NOORI_SKEL_MARK_TO_UNI[`${sk}:none`] ||
              NOORI_GID_TO_UNI[sk] ||
              base.rawU ||
              "";
          }
          chars.push(matched);
        }
        base.trueU = decodeIslamicHonorificPua(chars.join("")).replace(/\u0649/g, "\u06CC");
        continue;
      }
    }

    idx++;
    curr.trueU = decodeSingleNooriGlyph(curr);
  }

  const sortChars = (s) => [...s].sort().join("");

  // Align each pdf.js text item with its exact glyph slice in glyphStream (searching forward from gCursor first)
  let gCursor = 0;
  const decodedItems = items.map((item) => {
    const str = String(item.str || "");
    const strNoSpace = str.replace(/\s+/g, "");
    if (!strNoSpace) return item;
    const revStrNoSpace = [...str].reverse().join("").replace(/\s+/g, "");

    let matchedSlice = null;
    let matchedEnd = -1;
    let isReversed = false;

    const candidates = [];
    for (let s = gCursor; s < Math.min(glyphStream.length, gCursor + 180); s++) {
      candidates.push(s);
    }
    for (let s = Math.max(0, gCursor - 24); s < gCursor; s++) {
      candidates.push(s);
    }

    for (const start of candidates) {
      let acc = "";
      const slice = [];
      for (let k = start; k < Math.min(glyphStream.length, start + 120); k++) {
        const g = glyphStream[k];
        // Only skip leading genuine whitespace glyphs (where BOTH rawU and trueU are whitespace, e.g., c === 3).
        // Never skip a glyph like c === 506 (trueU="ن") or c === 1792 (trueU="الله") whose broken rawU is " "!
        if (
          acc.length === 0 &&
          !g.rawU.replace(/\s+/g, "") &&
          !g.trueU.replace(/\s+/g, "") &&
          (g.fontKind === "trad_arabic" || g.fontKind === "saleem_quran")
        ) {
          break;
        }
        slice.push(g);
        acc += g.rawU.replace(/\s+/g, "");
        if (acc.length >= revStrNoSpace.length) {
          // If the next glyph in the same font is a non-space letter whose broken /ToUnicode is " " (like 1792 -> "الله" or 506 -> "ن")
          // and the original item string ended/started with a space corresponding to that glyph, include it!
          while (
            k + 1 < glyphStream.length &&
            glyphStream[k + 1].fontName === g.fontName &&
            !glyphStream[k + 1].rawU.replace(/\s+/g, "") &&
            glyphStream[k + 1].trueU.replace(/\s+/g, "").length > 0 &&
            glyphStream[k + 1].c !== 3 &&
            glyphStream[k + 1].c !== 296
          ) {
            k++;
            slice.push(glyphStream[k]);
          }
          if (acc === revStrNoSpace) {
            matchedSlice = slice;
            matchedEnd = k + 1;
            isReversed = true;
            break;
          } else if (acc === strNoSpace) {
            matchedSlice = slice;
            matchedEnd = k + 1;
            isReversed = false;
            break;
          } else if (
            acc.length === strNoSpace.length &&
            (g.fontKind === "saleem_quran" || g.fontKind === "trad_arabic") &&
            sortChars(acc) === sortChars(strNoSpace)
          ) {
            // Multi-char /ToUnicode glyph entries (e.g. GID 1809 -> "مُ", 1919 -> "مِ", 1999 -> "نُ", 1817 -> "هُ")
            // preserve internal char order in g.rawU while pdf.js reverses the whole item string
            matchedSlice = slice;
            matchedEnd = k + 1;
            isReversed = true;
            break;
          }
          if (acc.length > revStrNoSpace.length + 5) break;
        }
      }
      if (matchedSlice) break;
    }

    if (matchedSlice) {
      if (matchedEnd > gCursor) gCursor = matchedEnd;
      const ordered = isReversed ? [...matchedSlice].reverse() : matchedSlice;
      const decodedStr = decodeIslamicHonorificPua(
        ordered.map((g) => g.trueU).join("")
      )
        .replace(/بٔ/g, "أ")
        .replace(/أ/g, "أ")
        .replace(/إ/g, "إ")
        .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
        .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم");
      return { ...item, str: decodedStr };
    }

    return {
      ...item,
      str: decodeIslamicHonorificPua(str)
        .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
        .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم"),
    };
  });

  // Coalesce zero-width combining/suffix items (and split " ََّا" before "إِنم") directly onto their
  // following base item in stream order! In Traditional Arabic and Muhammadi Quranic, PDF.js emits
  // the zero-width left-hand suffix/diacritic item immediately BEFORE its right-hand base word item.
  for (let i = 0; i < decodedItems.length - 1; i++) {
    const curr = decodedItems[i];
    const next = decodedItems[i + 1];
    const currStr = String(curr?.str || "");
    const nextStr = String(next?.str || "");
    if (!currStr.trim() || !nextStr.trim()) continue;

    const currY = curr.transform ? curr.transform[5] : 0;
    const nextY = next.transform ? next.transform[5] : 0;
    if (Math.abs(currY - nextY) > 16) continue;

    const isZeroWidthMarkOrSuffix =
      (curr.width || 0) === 0 && curr.fontName === next.fontName;
    const isSplitInnama =
      curr.fontName === next.fontName &&
      /^[\s\u064B-\u0652]*ا[\s\u064B-\u0652]*$/.test(currStr) &&
      /(?:إِنم|أنم|كأنم|لإنم)\s*$/.test(nextStr);

    if (isZeroWidthMarkOrSuffix || isSplitInnama) {
      next.str = nextStr + currStr.trim();
      curr.str = "";
    }
  }

  return decodedItems;
}

/**
 * Post-process common Nastaliq sub-word splits after GSUB decoding so every word is 100% whole.
 */
export function polishDecodedNastaliqLine(rawLine) {
  if (!rawLine) return "";
  let s = decodeIslamicHonorificPua(String(rawLine));
  // Replace King Fahd Mushaf Page 458 (QCF_P458) cover calligraphy verse with authentic Unicode text (Surah Az-Zumar 39:2)
  s = s.replace(
    /﴿\s*[ڎڈژ\uFB50-\uFDCF\s]+\s*﴾/g,
    "﴿فَاعْبُدِ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ﴾"
  );
  // Strip table-of-contents dot leaders (2+ consecutive periods/dots)
  s = s.replace(/\.{2,}|…+/g, " ");
  // Rejoin Noon Ghunna (ں) or Bari Ye (ے) when separated by a space from its stem
  s = s.replace(/([\u0621-\u06D3])\s+([ںے])(?=\s|$|[۔.،؛؟!:])/g, "$1$2");
  // Rejoin isolated initial Alif before known stems where Nastaliq kerning left a small gap
  s = s
    .replace(/(^|\s)ا\s+(خلاص|سلام|عتبار|حساس|نسان|یمان|مت|عمال|حادیث|حادىث|سلاف|طاعت|ختیار|ہمیت|مید|سلوب|لفاظ|مور|حکام|نبیاء|نبىاء)(?=\s|$|[۔.،؛؟!:])/g, "$1ا$2")
    .replace(/االلہ/g, "اللہ")
    .replace(/اس\s+پوری\s*(?:تا|ات)\s*ب?\s*کا\s*نتیجہ/g, "اس پوری کتاب کا نتیجہ")
    .replace(/بالنلا\s*ت/g, "بالنيات")
    .replace(/ِ\s*ْنَ\s*َع\s*ْنِ\s*عُمَر/g, "عَنْ عُمَرَ")
    .replace(/فَمْنَ/g, "فَمَنْ")
    .replace(/فَ([هہ])ِجْرَتُ([هہ])\s*ِ?ل([ىی])َُ\s*إ/g, "فَ$1ِجْرَتُ$2 إِلَى")
    .replace(/(^|\s)ِجْرَتُ([هہ])\s*ِ?ل([ىی])َُ\s*إ/g, "$1هِجْرَتُ$2 إِلَى")
    .replace(/(^|\s)ِجْرَتُ([هہ])ُ?/g, "$1هِجْرَتُ$2ُ")
    .replace(/فَ([هہ])\1ِجْرَتُ/g, "فَ$1ِجْرَتُ")
    .replace(/فَم\s*ُ?\s*([هہ])ِ\s*َنْ\s*کَانَتْ?\s*جْرَت\s*للهِّٰ\s*([هہ])\s*ِ?\s*اِلیٰ\s*ا/g, "فَمَنْ کَانَتْ هِجْرَتُهُ إِلَى اللَّهِ")
    .replace(/«\s*ْ?\s*ُ?\s*([هہ])ِ?\s*فَمَنْ/g, "«فَمَنْ")
    .replace(/فَ\s*([هہ])ُ\s*جْرَت\s*للهِّٰ\s*([هہ])\s*ِ?\s*اِلیٰ\s*ا/g, "فَهِجْرَتُهُ إِلَى اللَّهِ")
    .replace(/فُ\s*([هہ])\s*([هہ])ِجْرَتُ([هہ])ُ?/g, "فَهِجْرَتُهُ")
    .replace(/جْرَت\s*للهِّٰ\s*([هہ])\s*ِ?\s*اِلیٰ\s*ا/g, "هِجْرَتُهُ إِلَى اللَّهِ")
    .replace(/وَرَسُوْل\s*َ?\s*([هہ])\s*ِ?/g, "وَرَسُولِهِ ")
    .replace(/وَرَسُوْل([هہ])/g, "وَرَسُولِ$1ِ ")
    .replace(/وَرَسُولِهِفَهِجْرَتُهُ/g, "وَرَسُولِهِ فَهِجْرَتُهُ")
    .replace(/«\s*ُ\s*إِنَّمَاِ?\s*الأَعْمَال/g, "«إِنَّمَا الأَعْمَالُ")
    .replace(/«\s*َ?و\s*إِنَّمَا/g, "«وَإِنَّمَا")
    .replace(/لِدُنْيَاِ?\s*يُصِيبُهَاٍ?\s*أَو\s*امْرَأَةُ?\s*يَنْكِحُهَا/g, "لِدُنْيَا يُصِيبُهَا أَوِ امْرَأَةٍ يَنْكِحُهَا")
    .replace(/پو\s+را\s+پورا/g, "پورا پورا")
    .replace(/باعتبار\s+دین\s+کے\s+اس\s+سے\s+اچھا\s+کون\s+ہے\s*؟/g, "باعتبار دین کے اس سے اچھا کون ہے ؟")
    .replace(/﴾\s*ان\s+کے\s+اکثر\s+خفیہ/g, "﴾ ان کے اکثر خفیہ")
    .replace(/ْ\s*نَ\s*ْ?\s*وَم\s*ُ?\s*كَانَت/g, "وَمَنْ كَانَتْ")
    .replace(/ِلىَ\s*فَهِجْرَتُ([هہ])\s*إ\s*َ?\s*مَا\s*ِ?\s*([هہ])َاجَر/g, "فَهِجْرَتُهُ إِلَى مَا هَاجَرَ")
    .replace(/إِف\s*َّ\s*باِلْمَدِينَةِ\s*أَقْوَامًا\s*مَا\s*سِر\s*ْتمُْ/g, "إِنَّ بِالْمَدِينَةِ أَقْوَامًا مَا سِرْتُمْ")
    .replace(/ِ?\s*إِن\s*َّ\s*باِلْمَدِينَةِ\s*أَقْوَامًا\s*مَا\s*سِر\s*ْتمُْ/g, "إِنَّ بِالْمَدِينَةِ أَقْوَامًا مَا سِرْتُمْ")
    .replace(/ُ?\s*قَطَعْتُمْ\s*وَادِياً\s*إِلا\s*َّ?\s*كَانُوا\s*مَعَكُمْ\s*قَالُوا\s*ياَ\s*رَسُولَ\s*الله\s*َِّ\s*وَهُم\s*ْ?\s*باِلْمَدِينَةِ\s*قَالَ\s*وَهُم\s*ْ?\s*باِلْمَدِينَة/g, "قَطَعْتُمْ وَادِيًا إِلَّا كَانُوا مَعَكُمْ قَالُوا يَا رَسُولَ اللَّهِ وَهُمْ بِالْمَدِينَةِ قَالَ وَهُمْ بِالْمَدِينَةِ")
    .replace(/إِن\s*َّكَ\s*ل\s*َنْ\s*تُنْف\s*ِقَ/g, "إِنَّكَ لَنْ تُنْفِقَ")
    .replace(/مُهَاجِرًا\s*ا\s*ِٕلىَ\s*اللهَِّ/g, "مُهَاجِرًا إِلَى اللَّهِ")
    .replace(/فَقَدْ\s*وَقَعَ\s*أَجْرُه\s*ُ?\s*عليََ\s*اللهَِّ/g, "فَقَدْ وَقَعَ أَجْرُهُ عَلَى اللَّهِ")
    .replace(/ُ?\s*عليََ\s*اللهَِّ\s*مُهَاجِرًا\s*ا\s*ِٕلىَ\s*اللهَِّ\s*وَرَسُولِهِ\s*ثُمَّ\s*[یي]ُدْرِكْهُ\s*الْمَوْتُ\s*فَقَدْ\s*وَقَعَ\s*أَجْرُه/g, "مُهَاجِرًا إِلَى اللَّهِ وَرَسُولِهِ ثُمَّ يُدْرِكْهُ الْمَوْتُ فَقَدْ وَقَعَ أَجْرُهُ عَلَى اللَّهِ")
    .replace(/وَمَا\s*أُمِرُوا\s*إِلاَّ\s*لِ[یي]َعْبُدُوا\s*ََّ?\s*مخُْلِصِينَ/g, "وَمَا أُمِرُوا إِلَّا لِيَعْبُدُوا اللَّهَ مُخْلِصِينَ")
    .replace(/نیت\s+لیٰ\s+سے\s+لیتا\s+ہے\s*،?\s*تو\s+اللہ\s+تعا/g, "نیت سے لیتا ہے تو اللہ تعالیٰ")
    .replace(/تعا\s+بھی/g, "تعالیٰ بھی")
    .replace(/الْ عَبْدُ/g, "الْعَبْدُ")
    .replace(/مَا\s+كَا\s+نَ/g, "مَا كَانَ")
    .replace(/(^|\s)دو\s+الاب(?=\s|$|[۔.،؛؟!:])/g, "$1دوبالا")
    .replace(/(^|\s)مندرجہ\s+الاب(?=\s|$|[۔.،؛؟!:])/g, "$1مندرجہ بالا")
    .replace(/(^|\s)ہر\s+کو\s*ئ([ىی])(?=\s|$|[۔.،؛؟!:])/g, "$1ہر کوئ$2")
    .replace(/(^|\s)وا\s+ل([ىی])(?=\s|$|[۔.،؛؟!:])/g, "$1وال$2")
    .replace(/(^|\s)دعوا\s+نا(?=\s|$|[۔.،؛؟!:])/g, "$1دعوانا")
    .replace(/(^|\s)سواونٹن([ىی])وں(?=\s|$|[۔.،؛؟!:])/g, "$1سو اونٹن$2وں")
    .replace(/(^|\s)ب([ىی])انکیا(?=\s|$|[۔.،؛؟!:])/g, "$1ب$2ان کیا")
    .replace(/(^|\s)صحیحطور(?=\s|$|[۔.،؛؟!:])/g, "$1صحیح طور")
    .replace(/(^|\s)پرکھسکے(?=\s|$|[۔.،؛؟!:])/g, "$1پرکھ سکے")
    .replace(/(^|\s)محققینکا(?=\s|$|[۔.،؛؟!:])/g, "$1محققین کا")
    .replace(/(^|\s)کیاگ([ىی])ا(?=\s|$|[۔.،؛؟!:])/g, "$1کیا گ$2ا")
    .replace(/(^|\s)ہواور(?=\s|$|[۔.،؛؟!:])/g, "$1ہو اور")
    .replace(/(^|\s)مزیدمعلومات(?=\s|$|[۔.،؛؟!:])/g, "$1مزید معلومات")
    .replace(/(^|\s)پیما\s+نے(?=\s|$|[۔.،؛؟!:])/g, "$1پیمانے")
    .replace(/(^|\s)بھر\s+پر(?=\s|$|[۔.،؛؟!:])/g, "$1بھرپور")
    .replace(/(^|\s)تالیف\s+وترتیب(?=\s|$|[۔.،؛؟!:])/g, "$1تالیف و ترتیب")
    .replace(/(^|\s)دنیا\s+وآخرت(?=\s|$|[۔.،؛؟!:])/g, "$1دنیا و آخرت")
    .replace(/(^|\s)ایمان\s+واخلاص(?=\s|$|[۔.،؛؟!:])/g, "$1ایمان و اخلاص")
    .replace(/(^|\s)موت\s+وزندگ([ىی])(?=\s|$|[۔.،؛؟!:])/g, "$1موت و زندگ$2")
    .replace(/(^|\s)اجروثواب(?=\s|$|[۔.،؛؟!:])/g, "$1اجر و ثواب")
    .replace(/(^|\s)اطاعت\s+وعبادت(?=\s|$|[۔.،؛؟!:])/g, "$1اطاعت و عبادت")
    .replace(/(^|\s)توحیداداكرنےپر(?=\s|$|[۔.،؛؟!:])/g, "$1توحید ادا كرنے پر")
    .replace(/(^|\s)پىداكرتاہے(?=\s|$|[۔.،؛؟!:])/g, "$1پىدا كرتا ہے")
    .replace(/(^|\s)بناپرکامیاب(?=\s|$|[۔.،؛؟!:])/g, "$1بنا پر کامیاب")
    .replace(/(^|\s)بناپر(?=\s|$|[۔.،؛؟!:])/g, "$1بنا پر")
    .replace(/(^|\s)کیاجارہاہے(?=\s|$|[۔.،؛؟!:])/g, "$1کیا جا رہا ہے")
    .replace(/(^|\s)ہوتاہے(?=\s|$|[۔.،؛؟!:])/g, "$1ہوتا ہے")
    .replace(/(^|\s)سےہوتى(?=\s|$|[۔.،؛؟!:])/g, "$1سے ہوتى")
    .replace(/(^|\s)ہےتاکہ(?=\s|$|[۔.،؛؟!:])/g, "$1ہے تاکہ")
    .replace(/(^|\s)پراخلاص(?=\s|$|[۔.،؛؟!:])/g, "$1پر اخلاص")
    .replace(/(^|\s)کےوسائل(?=\s|$|[۔.،؛؟!:])/g, "$1کے وسائل")
    .replace(/(^|\s)چنداہم(?=\s|$|[۔.،؛؟!:])/g, "$1چند اہم")
    .replace(/(^|\s)چھٹاباب(?=\s|$|[۔.،؛؟!:])/g, "$1چھٹا باب")
    .replace(/موهفم\s+اك\s+تين/g, "نیت كا مفہوم")
    .replace(/اس\s+كامقام/g, "اس كا مقام")
    .replace(/اس\s+کامقام/g, "اس کا مقام")
    .replace(/ابنا\s+لقیم/g, "ابن القیم")
    .replace(/بھیہو/g, "بھی ہو")
    .replace(/ر\s+ہی\s+بات/g, "رہی بات")
    .replace(/قول\s*وعملاور/g, "قول و عمل اور")
    .replace(/ساتھر\s*کھے/g, "ساتھ رکھے")
    .replace(/لوگاپنا/g, "لوگ اپنا")
    .replace(/حكمكرے/g, "حکم کرے")
    .replace(/بند\s+گ([ىی])/g, "بندگی")
    .replace(/کھول\s+د\s*[يی]\s*ہے/g, "کھول دی ہے");

  // Repair Arabic Hadith & Quranic vocalization (tashkeel) and sub-word splits from Traditional Arabic & Muhammadi Quranic fonts
  // First collapse any space before a combining diacritic (e.g. "الأَعْمَال ُ" -> "الأَعْمَالُ", "و َمنَْ" -> "وَمَنْ", "ب َليَ" -> "بَلَىٰ")
  s = s
    .replace(/مَا\s+َاجَرَ/g, "مَا هَاجَرَ")
    .replace(/\s+([\u064B-\u065F\u0670]+)/g, "$1");

  s = s
    .replace(/(?:^|\s)َ?\s*عْنَ\s*ْنِ\s*عُمَر\s*(?:بْنِ|ِب)\s*(?:الْخَطَّابِِ?|الخَْط\s*َّاب)/g, " عَنْ عُمَرَ بْنِ الْخَطَّابِ")
    .replace(/عْنَْنِ\s+عُمَربْنِ\s+الْخَطَّابِِ?/g, "عَنْ عُمَرَ بْنِ الْخَطَّابِ")
    .replace(/عْنَ\s*ْنِ\s*عُمَر/g, "عَنْ عُمَرَ")
    .replace(/إِنم\s*ََّا/g, "إِنَّمَا")
    .replace(/وَإِنم\s*ََّا/g, "وَإِنَّمَا")
    .replace(/اِنم\s*ََّا/g, "إِنَّمَا")
    .replace(/وَاِنم\s*ََّا/g, "وَإِنَّمَا")
    .replace(/لِ[کك]ُلِّ\s*امْرِئٍ\s*م\s*ََّا/g, "لِكُلِّ امْرِئٍ مَا")
    .replace(/سمَِعْت/g, "سَمِعْت")
    .replace(/رَسُولُ\s+اللهِ/g, "رَسُولَ اللَّهِ")
    .replace(/باِلنِّي\s*َّات/g, "بِالنِّيَّات")
    .replace(/الخَْط\s*َّاب/g, "الْخَطَّابِ")
    .replace(/ِب\s+الْخَطَّاب/g, "بْنِ الْخَطَّابِ")
    .replace(/لِكُلِّ\s+ا\s*مْرِئٍ/g, "لِكُلِّ امْرِئٍ")
    .replace(/وَمْنَ/g, "وَمَنْ")
    .replace(/مَاَاجَرَ/g, "مَا هَاجَرَ")
    .replace(/متف\s+عليه/g, "متفق عليه")
    .replace(/بدء\s+الو\s*ح\s*ي/g, "بدء الوحي")
    .replace(/ا\s*ِٕليَ/g, "إِلَىٰ")
    .replace(/عمَِلُوا/g, "عَمِلُوا")
    .replace(/منِْ/g, "مِنْ")
    .replace(/عمََلٍ/g, "عَمَلٍ")
    .replace(/فجََعَلْنَاهُ/g, "فَجَعَلْنَاهُ")
    .replace(/وَمَنَْ/g, "وَمَنْ")
    .replace(/منَْ/g, "مَنْ")
    .replace(/أَحْس\s*َنُ/g, "أَحْسَنُ")
    .replace(/مم\s*َِّّنْ/g, "مِمَّنْ")
    .replace(/محُْس\s*ِنٌ/g, "مُحْسِنٌ")
    .replace(/إِبرَْاهِيْمَ/g, "إِبْرَاهِيمَ")
    .replace(/وَاتخََّذَ/g, "وَاتَّخَذَ")
    .replace(/عَلَيهِْمْ/g, "عَلَيْهِمْ")
    .replace(/وَلاَ\s*همُْ/g, "وَلَا هُمْ")
    .replace(/يحَْزَنوُن/g, "يَحْزَنُون")
    .replace(/للهِِّ|للهَِِّ/g, "لِلَّهِ")
    .replace(/الخَْالِصُ/g, "الْخَالِصُ")
    .replace(/بَلَيَ|بَليَ/g, "بَلَىٰ")
    .replace(/إِلىَ/g, "إِلَى")
    .replace(/\(\s*\)\s*([٠-٩۰-۹\d]+)/g, "($1)");

  // Strip inline footnote markers like (1) or )1( inside Quranic verses ﴿...﴾ so multi-line verses verify 100%
  s = s.replace(/﴿([^﴾]+)﴾/g, (full, inner) => {
    const cleanedInner = inner
      .replace(/\(\s*[\d٠-٩۰-۹]+\s*\)|\)\s*[\d٠-٩۰-۹]+\s*\(/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `﴿${cleanedInner}﴾`;
  });

  return s.replace(/\s+/g, " ").trim();
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
  reciterId = "ar.abdurrahmaansudais",
  bookMetadata = null,
}) {
  // Check cache first (only return cached data if not forcing fresh OCR and cached page has pipelineVersion === 8)
  if (!forceOcr) {
    const cached = await getCachedPageOcr(bookId, pageNumber);
    if (
      cached?.data &&
      Array.isArray(cached.data.sentences) &&
      cached.data.sentences.length > 0 &&
      cached.data.pipelineVersion === 8
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
  let separatorY = null;

  if (pdfDoc) {
    try {
      pdfPage = await pdfDoc.getPage(pageNumber);
      pageViewport = pdfPage.getViewport({ scale: 1.0 });
      const [textContent, operatorList] = await Promise.all([
        pdfPage.getTextContent({ disableCombineTextItems: true }),
        pdfPage.getOperatorList().catch(() => null),
      ]);
      const rawItems = textContent?.items || [];
      separatorY = detectFootnoteSeparatorY(operatorList);
      nativeItems = recoverTrueGlyphTextItems(rawItems, operatorList);
    } catch {
      nativeItems = [];
    }
  }

  // Stage 1: Analyze native PDF text layer quality, coalesce RTL glyphs safely, & exclude footnote area below separatorY
  const analysis = analyzeNativePdfTextLayer(nativeItems, pageViewport, separatorY);

  // Build blocks from native PDF text items with bounding-box coordinates and harvested footnote Quran citations
  const blocksFromNative = buildBlocksFromNativeItems(
    analysis.orderedLines,
    pageViewport,
    analysis.footnoteQuranMap
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

  // Never discard non-empty native blocks if OCR did not run or did not return replacement blocks
  let finalBlocks =
    blocksFromNative && blocksFromNative.length > 0 ? blocksFromNative : [];
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
 * Helper: Subdivide a bounding box `[minX, maxX, normY, normH]` across an array of RTL words
 * proportionally by character length from right to left so every word has accurate PDF coordinates.
 */
function buildProportionalRtlWordItems(words, minX, maxX, normY, normH) {
  if (!words || words.length === 0) return [];
  if (words.length === 1) {
    return [
      {
        str: words[0],
        normX: minX,
        normY,
        normW: Math.max(12, maxX - minX),
        normH,
      },
    ];
  }
  const spanW = Math.max(16, maxX - minX);
  const weights = words.map((w) => Math.max(1, w.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  let rightCursor = maxX;

  return words.map((w, i) => {
    const rawW = Math.round((weights[i] / totalWeight) * spanW);
    const wordW = Math.max(10, i === words.length - 1 ? rightCursor - minX : rawW);
    const itemX = Math.max(minX, rightCursor - wordW);
    rightCursor = Math.max(minX, itemX - 1);
    return {
      str: w,
      normX: itemX,
      normY,
      normW: Math.max(10, wordW),
      normH,
    };
  });
}

/**
 * Coalesce RTL PDF.js text items along a line safely and compute per-word bounding boxes
 * strictly anchored inside each text item's true horizontal span `[item.normX, item.normX + item.normW]`.
 */
function coalesceRtlLineItems(sortedItems, hasRtl) {
  if (!sortedItems || sortedItems.length === 0) {
    return { lineText: "", coalescedWordItems: [] };
  }

  // Filter out table-of-contents dot-leader runs so they never distort text or word bounding boxes
  const nonDotItems = sortedItems
    .map((it) => ({
      ...it,
      str: String(it.str || "").replace(/\.{2,}|…+/g, " "),
    }))
    .filter((it) => it.str.trim().length > 0);

  if (nonDotItems.length === 0) {
    return { lineText: "", coalescedWordItems: [] };
  }

  if (!hasRtl) {
    const text = nonDotItems
      .map((it) => it.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { lineText: text, coalescedWordItems: nonDotItems };
  }

  const mergedChunks = [];
  let currentChunk = null;

  for (let i = 0; i < nonDotItems.length; i++) {
    const curr = nonDotItems[i];
    const currStr = normalizePresentationFormsAndUrduChars(curr.str || "");
    if (!currStr.trim()) continue;

    if (!currentChunk) {
      currentChunk = { ...curr, str: currStr.trim(), rawStr: curr.str };
      continue;
    }

    const prevClean = currentChunk.str.trim();
    const currClean = currStr.trim();
    const rtlGap = currentChunk.normX - (curr.normX + curr.normW);
    const hadExplicitSpace =
      /\s$/.test(currentChunk.rawStr || "") || /^\s/.test(curr.str || "");
    const isCombiningOnly = /^[\u064B-\u065F\u0670]+$/.test(currClean);
    const startsWithWordFinalChar = /^[ںےةۃ]$/.test(currClean);
    const prevLastChar = prevClean.slice(-1);
    const prevEndsWithDualJoiner = DUAL_JOINING_LETTERS_REGEX.test(prevLastChar);
    const prevEndsWithWordFinal = STRICTLY_WORD_FINAL_CHARS.has(prevLastChar);

    // Check if joining the last token of currentChunk with the first token of currClean forms a known word
    const prevLastWord = prevClean.split(/\s+/).pop() || "";
    const currFirstWord = currClean.split(/\s+/)[0] || "";
    const combinedCandidate = prevLastWord + currFirstWord;
    const formsKnownWord =
      !hadExplicitSpace &&
      rtlGap <= 6 &&
      prevLastWord.length <= 3 &&
      currFirstWord.length <= 3 &&
      (KNOWN_WORDS_SET.has(combinedCandidate) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(combinedCandidate, "ur")) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(combinedCandidate, "ar")));

    // CRITICAL FIX: Never glue separate multi-letter words together! Only join directly without space when:
    // 1) currClean is purely combining marks, OR
    // 2) currClean is a single word-final letter (ں, ے, ة, ۃ), OR
    // 3) two short sub-word fragments (<= 3 chars) combine to form a known word, OR
    // 4) prevLastWord is a single dual-joining prefix letter with rtlGap <= 2
    const shouldJoinDirectly =
      isCombiningOnly ||
      (startsWithWordFinalChar && rtlGap <= 8) ||
      formsKnownWord ||
      (!hadExplicitSpace &&
        !prevEndsWithWordFinal &&
        prevEndsWithDualJoiner &&
        rtlGap <= 2 &&
        prevLastWord.length === 1);

    if (shouldJoinDirectly) {
      const newMinX = Math.min(currentChunk.normX, curr.normX);
      const newMaxX = Math.max(
        currentChunk.normX + currentChunk.normW,
        curr.normX + curr.normW
      );
      currentChunk.str = prevClean + currClean;
      currentChunk.rawStr = (currentChunk.rawStr || "") + (curr.str || "");
      currentChunk.normX = newMinX;
      currentChunk.normW = newMaxX - newMinX;
      currentChunk.normY = Math.min(currentChunk.normY, curr.normY);
      currentChunk.normH = Math.max(currentChunk.normH || 18, curr.normH || 18);
    } else {
      mergedChunks.push(currentChunk);
      currentChunk = { ...curr, str: currClean, rawStr: curr.str };
    }
  }

  if (currentChunk) {
    mergedChunks.push(currentChunk);
  }

  // Polish each chunk and subdivide multi-word chunks WITHIN their own exact [normX, normX + normW] bounding box!
  const perWordItems = [];
  const polishedChunkTexts = [];

  for (const chunk of mergedChunks) {
    const polishedChunk = polishDecodedNastaliqLine(
      rejoinFragmentedUrduArabicLetters(chunk.str)
    );
    if (!polishedChunk) continue;
    polishedChunkTexts.push(polishedChunk);
    const chunkWords = polishedChunk.split(/\s+/).filter(Boolean);
    const subItems = buildProportionalRtlWordItems(
      chunkWords,
      chunk.normX,
      chunk.normX + chunk.normW,
      chunk.normY,
      chunk.normH || 18
    );
    perWordItems.push(...subItems);
  }

  const repairedLine = polishDecodedNastaliqLine(polishedChunkTexts.join(" "));
  const finalWords = repairedLine.split(/\s+/).filter(Boolean);

  if (perWordItems.length === finalWords.length) {
    return {
      lineText: repairedLine,
      coalescedWordItems: perWordItems.map((it, idx) => ({
        ...it,
        str: finalWords[idx],
      })),
    };
  }

  const minX = Math.min(...mergedChunks.map((i) => i.normX));
  const maxX = Math.max(...mergedChunks.map((i) => i.normX + i.normW));
  const minY = Math.min(...mergedChunks.map((i) => i.normY));
  const maxH = Math.max(...mergedChunks.map((i) => i.normH || 18));

  return {
    lineText: repairedLine,
    coalescedWordItems: buildProportionalRtlWordItems(
      finalWords,
      minX,
      maxX,
      minY,
      maxH
    ),
  };
}

/**
 * 6. Analyze native PDF text layer for Nastaliq / RTL / Font-Table / OCR anomalies
 *    and exclude all footnotes below the horizontal separator line from spoken audio.
 */
export function analyzeNativePdfTextLayer(items, viewport, separatorY = null) {
  if (!items || items.length === 0) {
    return {
      needsOcr: true,
      isCorruptedLayer: false,
      qualityScore: 0,
      rawText: "",
      orderedLines: [],
      footnoteQuranMap: {},
      anomalies: ["صفحة مصورة بدون طبقة نصية — يتطلب تشغيل محرك OCR المتخصص"],
    };
  }

  const pageWidth = viewport?.width || 600;
  const pageHeight = viewport?.height || 850;
  const separatorNormY =
    typeof separatorY === "number" && separatorY > 0
      ? Math.round(((pageHeight - separatorY) / pageHeight) * 1000)
      : null;

  const lineBuckets = [];
  for (const item of items) {
    const rawStr = String(item.str || "");
    const str = rawStr.replace(/\.{3,}|…+/g, " ");
    if (!str.trim()) continue;
    const tx = item.transform ? item.transform[4] : 0;
    const ty = item.transform ? item.transform[5] : 0;
    const w = item.width || str.length * 5.5;
    const h = item.height || Math.abs(item.transform?.[3] || 14);

    // Skip zero-width control mark items that were emptied during GSUB decoding
    if (w <= 0.1 && !str.trim()) continue;

    const normY = Math.round(((pageHeight - ty - h) / pageHeight) * 1000);
    const normX = Math.round((tx / pageWidth) * 1000);
    const normW = Math.max(4, Math.round((w / pageWidth) * 1000));
    const normH = Math.max(16, Math.round((h / pageHeight) * 1000));

    let bucket = lineBuckets.find((b) => Math.abs(b.normY - normY) <= 14);
    if (!bucket) {
      bucket = { normY, rawTy: ty, items: [] };
      lineBuckets.push(bucket);
    }
    bucket.items.push({
      str,
      rawTy: ty,
      normX: Math.max(0, Math.min(1000, normX)),
      normY: Math.max(0, Math.min(1000, normY)),
      normW: Math.max(4, Math.min(1000, normW)),
      normH,
    });
  }

  lineBuckets.sort((a, b) => a.normY - b.normY);

  const allDecodedLines = [];
  const anomalies = [];

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

    const activeItems =
      coalescedWordItems.length > 0 ? coalescedWordItems : b.items;
    const minX = Math.min(...activeItems.map((i) => i.normX));
    const maxX = Math.max(...activeItems.map((i) => i.normX + i.normW));
    const minY = Math.min(...activeItems.map((i) => i.normY));
    const maxY = Math.max(...activeItems.map((i) => i.normY + i.normH));
    const avgTy =
      b.items.reduce((acc, it) => acc + (it.rawTy || 0), 0) /
      Math.max(1, b.items.length);

    allDecodedLines.push({
      text: lineText,
      items: coalescedWordItems,
      box2d: [minY, minX, maxY, maxX],
      avgTy,
      minY,
    });
  }

  // Partition lines into main body lines vs footnote lines below the horizontal footnote separator rule!
  let footnoteCutoffIndex = allDecodedLines.length;
  for (let i = 0; i < allDecodedLines.length; i++) {
    const ln = allDecodedLines[i];
    const prevLn = i > 0 ? allDecodedLines[i - 1] : null;
    const verticalGap = prevLn ? ln.box2d[0] - prevLn.box2d[2] : 0;

    // 1. Explicit PDF path horizontal rule separatorY
    if (typeof separatorY === "number" && separatorY > 0 && ln.avgTy < separatorY - 1) {
      footnoteCutoffIndex = i;
      break;
    }
    if (separatorNormY !== null && ln.minY >= separatorNormY - 4) {
      footnoteCutoffIndex = i;
      break;
    }

    // 2. Heuristic footnote block detection near bottom of page (minY >= 650) starting with (١), (1), )١(, etc.
    const startsWithFootnoteNumber =
      /^\s*(?:[\(\[\{]\s*[٠-٩۰-۹\d]{1,2}\s*[\)\]\}]|\)\s*[٠-٩۰-۹\d]{1,2}\s*\(|[\(\[\{]\s*\)\s*[٠-٩۰-۹\d]{1,2})/.test(
        ln.text
      );
    if (
      ln.minY >= 650 &&
      startsWithFootnoteNumber &&
      (verticalGap >= 16 || /(?:سورة|سورۃ|رواه|أخرجه|صحيح|صحيحه|البخاري|البخاری|مسلم|ترمذي|داود)/.test(ln.text))
    ) {
      footnoteCutoffIndex = i;
      break;
    }
  }

  const bodyLines = allDecodedLines.slice(0, footnoteCutoffIndex);
  const footnoteLines = allDecodedLines.slice(footnoteCutoffIndex);
  const footnoteQuranMap = extractFootnoteQuranCitations(footnoteLines);

  const orderedLines = [];
  let singleCharTokenCount = 0;
  let totalTokenCount = 0;
  let puaGlyphCount = 0;

  for (const ln of bodyLines) {
    const tokens = ln.text.split(/\s+/).filter(Boolean);
    totalTokenCount += tokens.length;
    for (const tk of tokens) {
      if (tk.length === 1 && /[\u0600-\u06FF]/.test(tk) && tk !== "و") {
        singleCharTokenCount++;
      }
      if (/[\uE000-\uF8FF\uFFFD]/.test(tk)) {
        puaGlyphCount++;
      }
    }
    orderedLines.push({
      text: ln.text,
      items: ln.items,
      box2d: ln.box2d,
      isFootnoteArea: false,
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
      footnoteQuranMap,
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
    footnoteQuranMap,
    anomalies,
  };
}

function buildBlocksFromNativeItems(orderedLines, pageViewport = null, footnoteQuranMap = {}) {
  if (!orderedLines || orderedLines.length === 0) return [];
  const blocks = [];
  let currentLines = [];

  const flushBlock = () => {
    if (currentLines.length === 0) return;
    const combinedText = polishDecodedNastaliqLine(
      rejoinFragmentedUrduArabicLetters(
        currentLines.map((l) => l.text).join(" ")
      )
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
      footnoteQuranMap,
    });
    currentLines = [];
  };

  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    if (!hasSpeakableLetters(line.text)) continue;
    const prev = currentLines[currentLines.length - 1];
    const verticalGap = prev ? line.box2d[0] - prev.box2d[2] : 0;
    const accText = currentLines.map((l) => l.text).join(" ");
    const openQuranCount = (accText.match(/﴿/g) || []).length;
    const closeQuranCount = (accText.match(/﴾/g) || []).length;
    const isInsideUnclosedQuran = openQuranCount > closeQuranCount;
    const openHadithCount = (accText.match(/«/g) || []).length;
    const closeHadithCount = (accText.match(/»/g) || []).length;
    const isInsideUnclosedHadith = openHadithCount > closeHadithCount;
    const isInsideUnclosedQuote = isInsideUnclosedQuran || isInsideUnclosedHadith;

    const prevIsUrdu = prev ? detectIsUrduScript(prev.text) : false;
    const currIsUrdu = detectIsUrduScript(line.text);
    const prevEndsWithCloseOrPunct = prev
      ? /[۔؟!\.:﴾»]$/.test(prev.text.replace(/\(\s*[\d٠-٩۰-۹]+\s*\)\s*$/, "").trim())
      : false;
    const prevIsShortHeading = prev ? prev.text.length < 62 && verticalGap > 8 : false;
    const languageSwitched =
      !isInsideUnclosedQuote &&
      prev &&
      prevIsUrdu !== currIsUrdu &&
      (prevEndsWithCloseOrPunct || prevIsShortHeading) &&
      prev.text.length >= 6 &&
      line.text.length >= 6;

    if (
      prev &&
      !isInsideUnclosedQuote &&
      (verticalGap > 24 ||
        line.isFootnoteArea !== prev.isFootnoteArea ||
        languageSwitched ||
        /[۔؟!\.:]$/.test(prev.text))
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

function normalizeTokenForCoordMatch(str) {
  return String(str || "")
    .replace(/[\u064B-\u065F\u0670۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–-]/g, "")
    .replace(/[کك]/g, "ک")
    .replace(/[یىي]/g, "ی")
    .replace(/[ہهةۃ]/g, "ہ")
    .trim();
}

/**
 * Align sentence words to `realLineItems` starting at `startCursor` with fuzzy token resynchronization
 * so stripped footnote markers or punctuation never shift word highlighting boxes.
 */
function alignSentenceWordsToLineItems(sentWords, realLineItems, startCursor) {
  if (!realLineItems || realLineItems.length === 0 || !sentWords || sentWords.length === 0) {
    return { matchedItems: null, nextCursor: startCursor };
  }
  let cursor = Math.max(0, Math.min(realLineItems.length - 1, startCursor));
  const matchedItems = [];

  for (let wIdx = 0; wIdx < sentWords.length; wIdx++) {
    const targetNorm = normalizeTokenForCoordMatch(
      sentWords[wIdx].word || sentWords[wIdx].text || ""
    );
    let chosenIdx = cursor;
    if (targetNorm) {
      const searchEnd = Math.min(realLineItems.length, cursor + 6);
      for (let look = cursor; look < searchEnd; look++) {
        const candNorm = normalizeTokenForCoordMatch(realLineItems[look]?.str || "");
        if (
          candNorm &&
          (candNorm === targetNorm ||
            candNorm.includes(targetNorm) ||
            targetNorm.includes(candNorm))
        ) {
          chosenIdx = look;
          break;
        }
      }
    }
    const item = realLineItems[Math.min(chosenIdx, realLineItems.length - 1)];
    matchedItems.push(item);
    cursor = Math.min(realLineItems.length, chosenIdx + 1);
  }

  return { matchedItems, nextCursor: cursor };
}

/**
 * Build per-line tight highlight boxes for a sentence so multi-line sentences
 * highlight cleanly along each line instead of drawing a single large overlapping rectangle.
 */
function buildSentenceLineBoxes(wordsWithCoords, fallbackBox2d) {
  const validRects = (wordsWithCoords || [])
    .map((w) => w?.rect)
    .filter((r) => r && typeof r.topPct === "number" && typeof r.leftPct === "number");

  if (validRects.length === 0) {
    if (Array.isArray(fallbackBox2d) && fallbackBox2d.length >= 4) {
      const [ymin, xmin, ymax, xmax] = fallbackBox2d;
      return [
        {
          topPct: Math.max(0, Math.min(98, ymin / 10)),
          leftPct: Math.max(0, Math.min(98, xmin / 10)),
          widthPct: Math.max(4, Math.min(98, (xmax - xmin) / 10)),
          heightPct: Math.max(2, Math.min(45, (ymax - ymin) / 10)),
        },
      ];
    }
    return [];
  }

  const lineGroups = [];
  for (const r of validRects) {
    let group = lineGroups.find((g) => Math.abs(g.topPct - r.topPct) <= 1.35);
    if (!group) {
      group = { topPct: r.topPct, rects: [] };
      lineGroups.push(group);
    }
    group.rects.push(r);
  }

  return lineGroups.map((g) => {
    const minTop = Math.min(...g.rects.map((r) => r.topPct));
    const maxBottom = Math.max(...g.rects.map((r) => r.topPct + r.heightPct));
    const minLeft = Math.min(...g.rects.map((r) => r.leftPct));
    const maxRight = Math.max(...g.rects.map((r) => r.leftPct + r.widthPct));
    return {
      topPct: Math.max(0, minTop - 0.25),
      leftPct: Math.max(0, minLeft - 0.4),
      widthPct: Math.min(99, Math.max(3, maxRight - minLeft + 0.8)),
      heightPct: Math.min(18, Math.max(1.8, maxBottom - minTop + 0.5)),
    };
  });
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
  reciterId = "ar.abdurrahmaansudais",
}) {
  const allSentences = [];
  let sentenceCounter = 0;
  let totalWordsCount = 0;

  for (let bIdx = 0; bIdx < (blocks || []).length; bIdx++) {
    const block = blocks[bIdx];
    // Never include footnote blocks in spoken audio sentences
    if (block?.blockType === "footnote") continue;

    const blockSentences = segmentBlockIntoSentences(block, bIdx);
    const totalSentencesInBlock = blockSentences.length;

    const realLineItems =
      Array.isArray(block.lineItems) && block.lineItems.length > 0
        ? block.lineItems
        : null;

    let blockWordCursor = 0;

    for (let sInBlockIdx = 0; sInBlockIdx < totalSentencesInBlock; sInBlockIdx++) {
      const sent = blockSentences[sInBlockIdx];
      if (sent.segmentType === "footnote") continue;

      const validation = validateUrduArabicText(
        sent.cleanedPronunciationText || sent.originalText
      );
      if (validation.repairedText) {
        const polished = polishDecodedNastaliqLine(validation.repairedText);
        sent.cleanedPronunciationText = normalizeUrduTextForPronunciation(
          polished,
          sent.language
        );
        sent.originalText = canonicalizeTextForLanguage(
          polishDecodedNastaliqLine(sent.originalText || polished),
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

      if (!sent.words || sent.words.length === 0) continue;

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

      const { matchedItems: sentenceWordSlice, nextCursor } =
        alignSentenceWordsToLineItems(sent.words, realLineItems, blockWordCursor);
      blockWordCursor = nextCursor;

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
          Math.max(0, sMinY - 3),
          Math.max(0, sMinX - 4),
          Math.min(1000, sMaxY + 3),
          Math.min(1000, sMaxX + 4),
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

      const lineBoxes = buildSentenceLineBoxes(wordsWithCoords, sentenceBox2d);
      totalWordsCount += wordsWithCoords.length;

      allSentences.push({
        ...sent,
        box2d: sentenceBox2d,
        lineBoxes,
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
    pipelineVersion: 8,
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
    // Subdivide fallback box2d proportionally so user can still tap individual words
    if (Array.isArray(box2d) && box2d.length >= 4) {
      const [ymin, xmin, ymax, xmax] = box2d;
      const syntheticItems = buildProportionalRtlWordItems(
        words.map((w) => w.word || w.text || ""),
        xmin,
        xmax,
        ymin,
        Math.max(18, ymax - ymin)
      );
      return words.map((w, idx) => {
        const it = syntheticItems[idx];
        return {
          ...w,
          word: w.word || w.text || "",
          text: w.word || w.text || "",
          wordIndex: idx,
          pageNumber,
          paragraphIndex,
          rect: it
            ? {
                topPct: Math.max(0, Math.min(98, it.normY / 10)),
                leftPct: Math.max(0, Math.min(98, it.normX / 10)),
                widthPct: Math.max(1.8, Math.min(95, (it.normW || 25) / 10)),
                heightPct: Math.max(1.8, Math.min(25, (it.normH || 20) / 10)),
              }
            : null,
        };
      });
    }

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
          topPct: Math.max(0, Math.min(98, (matchedItem.normY - 2) / 10)),
          leftPct: Math.max(0, Math.min(98, (matchedItem.normX - 1) / 10)),
          widthPct: Math.max(1.8, Math.min(95, ((matchedItem.normW || 24) + 2) / 10)),
          heightPct: Math.max(1.8, Math.min(25, ((matchedItem.normH || 20) + 4) / 10)),
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

const CLIENT_CANONICAL_QURAN_INDEX = [
  { surahNumber: 114, surahName: "سورة الناس", ayahNumber: 4, globalAyahNumber: 6234, uthmaniText: "مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ", key: "من شر الوسواس الخناس" },
  { surahNumber: 114, surahName: "سورة الناس", ayahNumber: 5, globalAyahNumber: 6235, uthmaniText: "الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ", key: "الذي يوسوس في صدور الناس" },
  { surahNumber: 7, surahName: "سورة الأعراف", ayahNumber: 200, globalAyahNumber: 1154, uthmaniText: "وَإِمَّا يَنزَغَنَّكَ مِنَ الشَّيْطَانِ نَزْغٌ فَاسْتَعِذْ بِاللَّهِ إِنَّهُ سَمِيعٌ عَلِيمٌ", key: "واما ينزغنك من الشيطان نزغ فاستعذ بالله انه سميع عليم" },
  { surahNumber: 41, surahName: "سورة فصلت", ayahNumber: 36, globalAyahNumber: 4254, uthmaniText: "وَإِمَّا يَنزَغَنَّكَ مِنَ الشَّيْطَانِ نَزْغٌ فَاسْتَعِذْ بِاللَّهِ إِنَّهُ هُوَ السَّمِيعُ الْعَلِيمُ", key: "واما ينزغنك من الشيطان نزغ فاستعذ بالله انه هو السميع العليم" },
  { surahNumber: 23, surahName: "سورة المؤمنون", ayahNumber: 97, globalAyahNumber: 2770, uthmaniText: "وَقُل رَّبِّ أَعُوذُ بِكَ مِنْ هَمَزَاتِ الشَّيَاطِينِ", key: "وقل رب اعوذ بك من همزات الشياطين" },
  { surahNumber: 23, surahName: "سورة المؤمنون", ayahNumber: 98, globalAyahNumber: 2771, uthmaniText: "وَأَعُوذُ بِكَ رَبِّ أَن يَحْضُرُونِ", key: "واعوذ بك رب ان يحضرون" },
  { surahNumber: 13, surahName: "سورة الرعد", ayahNumber: 28, globalAyahNumber: 1735, uthmaniText: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", key: "الا بذكر الله تطمئن القلوب" },
  { surahNumber: 2, surahName: "سورة البقرة", ayahNumber: 265, globalAyahNumber: 272, uthmaniText: "وَمَثَلُ الَّذِينَ يُنفِقُونَ أَمْوَالَهُمُ ابْتِغَاءَ مَرْضَاتِ اللَّهِ وَتَثْبِيتًا مِّنْ أَنفُسِهِمْ كَمَثَلِ جَنَّةٍ بِرَبْوَةٍ", key: "ومثل الذين ينفقون اموالهم ابتغاء مرضات الله وتثبيتا من انفسهم كمثل جنه بربوه" },
  { surahNumber: 2, surahName: "سورة البقرة", ayahNumber: 286, globalAyahNumber: 293, uthmaniText: "لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا", key: "لا يكلف الله نفسا الا وسعها" },
  { surahNumber: 4, surahName: "سورة النساء", ayahNumber: 38, globalAyahNumber: 531, uthmaniText: "وَالَّذِينَ يُنفِقُونَ أَمْوَالَهُمْ رِئَاءَ النَّاسِ وَلَا يُؤْمِنُونَ بِاللَّهِ وَلَا بِالْيَوْمِ الْآخِرِ", key: "والذين ينفقون اموالهم رياء الناس ولا يومنون بالله ولا باليوم الاخر" },
  { surahNumber: 4, surahName: "سورة النساء", ayahNumber: 114, globalAyahNumber: 607, uthmaniText: "لَّا خَيْرَ فِي كَثِيرٍ مِّن نَّجْوَاهُمْ إِلَّا مَنْ أَمَرَ بِصَدَقَةٍ أَوْ مَعْرُوفٍ أَوْ إِصْلَاحٍ بَيْنَ النَّاسِ وَمَن يَفْعَلْ ذَٰلِكَ ابْتِغَاءَ مَرْضَاتِ اللَّهِ فَسَوْفَ نُؤْتِيهِ أَجْرًا عَظِيمًا", key: "لا خير في كثير من نجواهم الا من امر بصدقه او معروف او اصلاح بين الناس ومن يفعل ذلك ابتغاء مرضات الله فسوف نوتيه اجرا عظيما" },
  { surahNumber: 50, surahName: "سورة ق", ayahNumber: 16, globalAyahNumber: 4646, uthmaniText: "وَلَقَدْ خَلَقْنَا الْإِنسَانَ وَنَعْلَمُ مَا تُوَسْوِسُ بِهِ نَفْسُهُ وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ الْوَرِيدِ", key: "ولقد خلقنا الانسان ونعلم ما توسوس به نفسه ونحن اقرب اليه من حبل الوريد" },
  { surahNumber: 1, surahName: "سورة الفاتحة", ayahNumber: 1, globalAyahNumber: 1, uthmaniText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", key: "بسم الله الرحمن الرحيم" },
  { surahNumber: 39, surahName: "سورة الزمر", ayahNumber: 2, globalAyahNumber: 4060, uthmaniText: "فَاعْبُدِ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ", key: "فاعبد الله مخلصا له الدين" },
  { surahNumber: 25, surahName: "سورة الفرقان", ayahNumber: 23, globalAyahNumber: 2878, uthmaniText: "وَقَدِمْنَا إِلَىٰ مَا عَمِلُوا مِنْ عَمَلٍ فَجَعَلْنَاهُ هَبَاءً مَّنثُورًا", key: "وقدمنا الي ما عملوا من عمل فجعلناه هباء منثورا" },
  { surahNumber: 4, surahName: "سورة النساء", ayahNumber: 100, globalAyahNumber: 593, uthmaniText: "وَمَن يُهَاجِرْ فِي سَبِيلِ اللَّهِ يَجِدْ فِي الْأَرْضِ مُرَاغَمًا كَثِيرًا وَسَعَةً وَمَن يَخْرُجْ مِن بَيْتِهِ مُهَاجِرًا إِلَى اللَّهِ وَرَسُولِهِ ثُمَّ يُدْرِكْهُ الْمَوْتُ فَقَدْ وَقَعَ أَجْرُهُ عَلَى اللَّهِ وَكَانَ اللَّهُ غَفُورًا رَّحِيمًا", key: "ومن يخرج من بيته مهاجرا الي الله ورسوله ثم يدركه الموت فقد وقع اجره علي الله" },
  { surahNumber: 4, surahName: "سورة النساء", ayahNumber: 125, globalAyahNumber: 618, uthmaniText: "وَمَنْ أَحْسَنُ دِينًا مِّمَّنْ أَسْلَمَ وَجْهَهُ لِلَّهِ وَهُوَ مُحْسِنٌ وَاتَّبَعَ مِلَّةَ إِبْرَاهِيمَ حَنِيفًا وَاتَّخَذَ اللَّهُ إِبْرَاهِيمَ خَلِيلًا", key: "ومن احسن دينا ممن اسلم وجهه لله وهو محسن واتبع مله ابراهيم حنيفا واتخذ الله ابراهيم خليلا" },
  { surahNumber: 2, surahName: "سورة البقرة", ayahNumber: 112, globalAyahNumber: 119, uthmaniText: "بَلَىٰ مَنْ أَسْلَمَ وَجْهَهُ لِلَّهِ وَهُوَ مُحْسِنٌ فَلَهُ أَجْرُهُ عِندَ رَبِّهِ وَلَا خَوْفٌ عَلَيْهِمْ وَلَا هُمْ يَحْزَنُونَ", key: "بلي من اسلم وجهه لله وهو محسن فله اجره عند ربه ولا خوف عليهم ولا هم يحزنون" },
  { surahNumber: 98, surahName: "سورة البينة", ayahNumber: 5, globalAyahNumber: 6135, uthmaniText: "وَمَا أُمِرُوا إِلَّا لِيَعْبُدُوا اللَّهَ مُخْلِصِينَ لَهُ الدِّينَ حُنَفَاءَ وَيُقِيمُوا الصَّلَاةَ وَيُؤْتُوا الزَّكَاةَ وَذَٰلِكَ دِينُ الْقَيِّمَةِ", key: "وما امروا الا ليعبدوا الله مخلصين له الدين حنفاء ويقيموا الصلاه ويؤتوا الزكاه وذلك دين القيمه" },
  { surahNumber: 18, surahName: "سورة الكهف", ayahNumber: 110, globalAyahNumber: 2250, uthmaniText: "فَمَن كَانَ يَرْجُو لِقَاءَ رَبِّهِ فَلْيَعْمَلْ عَمَلًا صَالِحًا وَلَا يُشْرِكْ بِعِبَادَةِ رَبِّهِ أَحَدًا", key: "فمن كان يرجو لقاء ربه فليعمل عملا صالحا ولا يشرك بعباده ربه احدا" },
  { surahNumber: 67, surahName: "سورة الملك", ayahNumber: 2, globalAyahNumber: 5243, uthmaniText: "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا وَهُوَ الْعَزِيزُ الْغَفُورُ", key: "الذي خلق الموت والحياه ليبلوكم ايكم احسن عملا وهو العزيز الغفور" },
  { surahNumber: 11, surahName: "سورة هود", ayahNumber: 15, globalAyahNumber: 1488, uthmaniText: "مَن كَانَ يُرِيدُ الْحَيَاةَ الدُّنْيَا وَزِينَتَهَا نُوَفِّ إِلَيْهِمْ أَعْمَالَهُمْ فِيهَا وَهُمْ فِيهَا لَا يُبْخَسُونَ", key: "من كان يريد الحياه الدنيا وزينتها نوف اليهم اعمالهم فيها وهم فيها لا يبخسون" },
  { surahNumber: 11, surahName: "سورة هود", ayahNumber: 16, globalAyahNumber: 1489, uthmaniText: "أُولَٰئِكَ الَّذِينَ لَيْسَ لَهُمْ فِي الْآخِرَةِ إِلَّا النَّارُ وَحَبِطَ مَا صَنَعُوا فِيهَا وَبَاطِلٌ مَّا كَانُوا يَعْمَلُونَ", key: "اوليك الذين ليس لهم في الاخره الا النار وحبط ما صنعوا فيها وباطل ما كانوا يعملون" },
  { surahNumber: 39, surahName: "سورة الزمر", ayahNumber: 3, globalAyahNumber: 4061, uthmaniText: "أَلَا لِلَّهِ الدِّينُ الْخَالِصُ", key: "الا لله الدين الخالص" },
  { surahNumber: 39, surahName: "سورة الزمر", ayahNumber: 11, globalAyahNumber: 4069, uthmaniText: "قُلْ إِنِّي أُمِرْتُ أَنْ أَعْبُدَ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ", key: "قل اني امرت ان اعبد الله مخلصا له الدين" },
  { surahNumber: 39, surahName: "سورة الزمر", ayahNumber: 14, globalAyahNumber: 4072, uthmaniText: "قُلِ اللَّهَ أَعْبُدُ مُخْلِصًا لَّهُ دِينِي", key: "قل الله اعبد مخلصا له ديني" },
  { surahNumber: 39, surahName: "سورة الزمر", ayahNumber: 65, globalAyahNumber: 4123, uthmaniText: "وَلَقَدْ أُوحِيَ إِلَيْكَ وَإِلَى الَّذِينَ مِن قَبْلِكَ لَئِنْ أَشْرَكْتَ لَيَحْبَطَنَّ عَمَلُكَ وَلَتَكُونَنَّ مِنَ الْخَاسِرِينَ", key: "ولقد اوحي اليك والي الذين من قبلك لين اشركت ليحبطن عملك ولتكونن من الخاسرين" },
];

export async function verifyQuranVerseClient(
  text,
  surahHint = 0,
  ayahHint = 0,
  reciterId = "ar.abdurrahmaansudais"
) {
  const cacheKey = surahHint && ayahHint ? `${text}__${surahHint}:${ayahHint}` : text;
  const cached = await getCachedQuranVerification(cacheKey, reciterId);
  if (cached && cached.verified) return cached;

  const reciterFolderMap = {
    "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
    "ar.alafasy": "Alafasy_128kbps",
    "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
    "ar.husary": "Husary_128kbps",
    "ar.minshawi": "Minshawy_Murattal_128kbps",
  };
  const folder = reciterFolderMap[reciterId] || "Abdurrahmaan_As-Sudais_192kbps";

  const norm = normalizeForQuickArabicMatch(text)
    .replace(/[\(\)\[\]\{\}]\s*[٠-٩۰-۹\d]+\s*[\(\)\[\]\{\}]/g, " ")
    .replace(/[﴿﴾«»"'\(\)\[\]\{\}۞٭]/g, " ")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
  const normNoSpace = norm.replace(/\s+/g, "");

  // 1. Check direct verse text match against CLIENT_CANONICAL_QURAN_INDEX first!
  if (normNoSpace.length >= 10) {
    for (const item of CLIENT_CANONICAL_QURAN_INDEX) {
      const keyNoSpace = item.key.replace(/\s+/g, "");
      if (
        norm.includes(item.key) ||
        (item.key.includes(norm) && norm.length >= 12) ||
        normNoSpace.includes(keyNoSpace) ||
        (keyNoSpace.includes(normNoSpace) && normNoSpace.length >= 12)
      ) {
        const sPad = String(item.surahNumber).padStart(3, "0");
        const aPad = String(item.ayahNumber).padStart(3, "0");
        const directUrl = `https://everyayah.com/data/${folder}/${sPad}${aPad}.mp3`;
        const resolved = {
          verified: true,
          confidence: 0.99,
          surahNumber: item.surahNumber,
          surahName: item.surahName,
          ayahNumber: item.ayahNumber,
          globalAyahNumber: item.globalAyahNumber,
          uthmaniText: item.uthmaniText,
          reciterId,
          audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
          directAudioUrl: directUrl,
          backupAudioUrl: `https://cdn.islamic.network/quran/audio/128/${reciterId}/${item.globalAyahNumber}.mp3`,
        };
        await setCachedQuranVerification(cacheKey, reciterId, resolved);
        return resolved;
      }
    }
  }

  // 2. If footnote citation provided exact surahHint & ayahHint, check canonical index by surah:ayah
  if (surahHint > 0 && ayahHint > 0) {
    const exactMatch = CLIENT_CANONICAL_QURAN_INDEX.find(
      (it) => it.surahNumber === Number(surahHint) && it.ayahNumber === Number(ayahHint)
    );
    if (exactMatch) {
      const sPad = String(exactMatch.surahNumber).padStart(3, "0");
      const aPad = String(exactMatch.ayahNumber).padStart(3, "0");
      const directUrl = `https://everyayah.com/data/${folder}/${sPad}${aPad}.mp3`;
      const resolved = {
        verified: true,
        confidence: 0.99,
        surahNumber: exactMatch.surahNumber,
        surahName: exactMatch.surahName,
        ayahNumber: exactMatch.ayahNumber,
        globalAyahNumber: exactMatch.globalAyahNumber,
        uthmaniText: exactMatch.uthmaniText,
        reciterId,
        audioUrl: `/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`,
        directAudioUrl: directUrl,
        backupAudioUrl: `https://cdn.islamic.network/quran/audio/128/${reciterId}/${exactMatch.globalAyahNumber}.mp3`,
      };
      await setCachedQuranVerification(cacheKey, reciterId, resolved);
      return resolved;
    }
  }

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
      if (data?.verified) {
        await setCachedQuranVerification(cacheKey, reciterId, data);
      }
      return data;
    }
  } catch {}
  return { verified: false };
}
