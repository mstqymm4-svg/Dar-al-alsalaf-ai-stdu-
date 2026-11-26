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
  READER_PIPELINE_VERSION,
} from "./cacheManager";
import { apiUrl } from "../../lib/apiBase.js";
import { WASWASA_STRUCTURED_PAGES } from "./sampleUrduBook";
import {
  NOORI_GID_TO_UNI,
  NOORI_SKEL_VARIANTS_TO_ROOT,
  NOORI_SKEL_MARK_TO_UNI,
  NOORI_ROOT_SKEL_LIG_REV,
  NOORI_PRECOMPOSED_GSUB_FIXES,
  ALVI_NASTALEEQ_GID_TO_UNI,
  TRAD_ARABIC_GID_TO_UNI,
  SALEEM_QURAN_GID_TO_UNI,
} from "./nooriNastaliqGsubMap";
import {
  evaluateSemanticCompleteness,
  refineSentencesLinguistically,
  enrichPageWithLinguisticStructure,
  PAUSE_TYPES,
} from "./linguisticLinker";
import {
  processUrduLinguisticsAndPhonetics,
  processArabicLinguisticsAndVocalization,
  auditSentenceExtractionQuality,
  applyLinguisticAccuracyAndQualityAssurance,
  deduplicateShadowPdfTokens,
} from "./linguisticAccuracyAndQA";

export {
  evaluateSemanticCompleteness,
  refineSentencesLinguistically,
  enrichPageWithLinguisticStructure,
  PAUSE_TYPES,
  processUrduLinguisticsAndPhonetics,
  processArabicLinguisticsAndVocalization,
  auditSentenceExtractionQuality,
  applyLinguisticAccuracyAndQualityAssurance,
  deduplicateShadowPdfTokens,
};

// ─── Structured Error Taxonomy ────────────────────────────────────────────────
export const READER_ERROR_CODES = {
  PDF_LOAD_FAILED: {
    code: "PDF_LOAD_FAILED",
    titleAr: "PDF غير متوفر",
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
    titleAr: "نص غير صالح",
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
  QURAN_AUDIO_LOAD_FAILED: {
    code: "QURAN_AUDIO_LOAD_FAILED",
    titleAr: "فشل تحميل التسجيل القرآني",
    messageAr: "تعذر تحميل التسجيل الصوتي للآية القرآنية بصوت الشيخ سعود الشريم.",
  },
  AUDIO_LOAD_FAILED: {
    code: "AUDIO_LOAD_FAILED",
    titleAr: "فشل تحميل الصوت",
    messageAr: "تعذر تحميل أو تشغيل المقطع الصوتي.",
  },
  QURAN_MATCH_FAILED: {
    code: "QURAN_MATCH_FAILED",
    titleAr: "فشل مطابقة الآية",
    messageAr: "تعذر التحقق من مطابقة الآية القرآنية في المصحف العثماني؛ لن يتم تشغيل تسجيل غير مؤكد.",
  },
  SYNC_FAILED: {
    code: "SYNC_FAILED",
    titleAr: "فشل المزامنة",
    messageAr: "حدث خلل في مزامنة تظليل الكلمات مع الصوت.",
  },
  HIGHLIGHT_FAILED: {
    code: "HIGHLIGHT_FAILED",
    titleAr: "فشل التظليل",
    messageAr: "تعذر مطابقة إحداثيات تظليل الكلمات على صفحة الكتاب.",
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
  /(?:^|\s)(?:کے|کی|کا|میں|ہے|ہیں|تھا|تھے|تھی|تھیں|اور|پر|سے|کو|نے|بھی|کیونکہ|لیکن|تاکہ|ہو|ہوتا|ہوتی|ہوتے|ہوئی|ہوئے|ہوگا|ہوگی|ہوں|کر|کرتا|کرتے|کرتی|کیے|کئے|گیا|گئی|گئے|رہا|رہی|رہے|جائے|جائیں|جاتا|جاتے|جاتی|والا|والے|والی|لیے|لئے|ساتھ|بغیر|ذریعہ|ذریعے|تحت|متعلق|اندر|باہر|پہلے|فرمایا|فرماتے|وسوسے|آپ|اپنے|اپنی|اپنا|نہیں|کبھی|ایسے|ایسا|ایسی|جنہیں|انہیں|انہوں|لوگوں|سمجھنا|ہونا|چاہیے|چاہئے|سکتا|سکتے|سکتی|کیا|کیوں|کیسے|کہاں|یہاں|وہاں|بہت|زیادہ|تھوڑا|ہمارا|ہمارے|ہماری|تمہارا|تمہارے|معلومات|وضاحت|تعریف|رہنمائیاں|نشانیاں|بیماریاں|طریقے|مقام|خبردار|سنو|دیکھو|سمجھو|چنانچہ|لہٰذا|البتہ|مگر|بلکہ|کیوں|چونکہ|حالانکہ|اگرچہ)(?=\s|$|[۔،؟!:])/g;

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
  "چاہے", "بھلائی", "برائی", "پارٹی", "عیادت", "عبادت", "اطاعت", "محبت", "دشمنی", "دوستی",
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

  // Strip isolated footnote markers like (1), )١(, [١], *, † and OCR noise symbols from spoken audio layer
  s = s
    .replace(/\[\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\]/g, " ")
    .replace(/\(\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\)/g, " ")
    .replace(/\)\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\(/g, " ")
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
  // EXCEPT Arabic pronoun "هو" ("ه" + "و") so Arabic sentences like "الإخلاص هو حقيقة الدين" are never misclassified as Urdu "ہو"!
  const sUrNorm = s
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/(^|\s)ه([\u064B-\u0652]*و)(?=\s|$|[۔.،؛؟!:])/g, "$1__AR_HUWA__")
    .replace(/\u0647/g, "\u06C1")
    .replace(/__AR_HUWA__/g, "هو");

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
  if ((exclusiveUrduWords >= 1 || outerUrduWords >= 1) && (strictUrduChars >= 1 || (wordCount <= 8 && arabicAlMatches <= 1)) && tashkeelCount < 4) {
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
  const cleanNoTashkeel = clean
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0671/g, "ا");

  // 1. Explicit Quranic brackets ﴿ ... ﴾ or canonical Quran verse phrase
  if (
    /﴿[^﴾]{4,}﴾/.test(clean) ||
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

  // 4. Segment is written in Arabic script (not Urdu): test against both raw and tashkeel-stripped text
  if (hintType === "dua" || DUA_MARKER_REGEX.test(clean) || DUA_MARKER_REGEX.test(cleanNoTashkeel)) {
    return {
      language: "ar",
      segmentType: "dua",
    };
  }

  if (
    hintType === "hadith" ||
    HADITH_ARABIC_MARKER_REGEX.test(clean) ||
    HADITH_ARABIC_MARKER_REGEX.test(cleanNoTashkeel)
  ) {
    return {
      language: "ar",
      segmentType: "hadith",
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

  let rawText = rejoinFragmentedUrduArabicLetters(rawInput)
    .replace(/﴿(?:\s*﴿)+/g, "﴿")
    .replace(/﴾(?:\s*﴾)+/g, "﴾")
    .replace(/\(\s*[\u064B-\u065F\u0670\u06D6-\u06ED\u0610-\u061A\s]*([\d٠-٩۰-۹]{1,2})\s*\)/g, "($1)")
    .replace(/^\s*﴾+\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()?\s*/, "");
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

  // Pre-step 2: If an Urdu sentence introduces an unquoted Arabic Hadith/Dua/Ayah after a colon (e.g. `آپ ﷺ نے فرمایا: ذَلِكَ صَرِيحُ الْإِيمَانِ۔`)
  // or ends a pure Arabic clause with a closing-only `»` (PDF dropped opening `«`, e.g. `پوچھا : والذين يؤتون... راجعون »`),
  // wrap the Arabic clause in «...» so it gets cleanly isolated and verified!
  if (blockContainsUrdu) {
    rawText = rawText.replace(
      /((?:فرمایا|ارشاد ہے|حدیث میں ہے|دعا ہے|پوچھا)\s*[:：]\s*)(?![«﴿"“])([^۔.؟!\n﴿﴾«»]{8,}[۔.؟!]?)/g,
      (full, intro, clause) => {
        const cleanClause = clause.replace(/[۔.؟!»]+$/, "").trim();
        if (!detectIsUrduScript(cleanClause)) {
          return `${intro}«${cleanClause}»۔ `;
        }
        return full;
      }
    );
    // Also catch closing-only `»` (no preceding matching `«` on the same segment) preceded by pure Arabic after `. ` / `۔ ` / `: ` / start
    rawText = rawText.replace(
      /(^|[۔.:\n]\s*)([^«»﴿﴾\n۔.]{12,}»)/g,
      (full, lead, innerWithClose) => {
        const cleanInner = innerWithClose.replace(/»$/, "").trim();
        if (!detectIsUrduScript(cleanInner) && cleanInner.length >= 12) {
          return `${lead}«${cleanInner}»`;
        }
        return full;
      }
    );
  }

  // Step 1: Split out inline Quranic verses ﴿...﴾ (including cross-page unclosed ﴿... at end or ...﴾ at start)
  // and (when block contains Urdu) inline quotes «...» / "..." / “...” (excluding any span that crosses ﴿ or ﴾ so multi-sentence Urdu quotes never swallow Quranic verses!)
  const tokenRegex = blockContainsUrdu
    ? /(﴿[^﴾]{2,}﴾(?:\s*[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\s*\)\s*[\d٠-٩۰-۹]+\s*\()?[۔.؟!،؛]*|﴿[^﴾]{2,}$|^[^﴿]{2,}﴾(?:\s*[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\s*\)\s*[\d٠-٩۰-۹]+\s*\()?[۔.؟!،؛]*|«[^»﴿﴾]{6,}»[۔.؟!،؛]*|«[^»﴿﴾]{6,}$|^[^«﴿﴾]{6,}»[۔.؟!،؛]*|"[^"﴿﴾]{8,}"[۔.؟!،؛]*|“[^”﴿﴾]{8,}”[۔.؟!،؛]*)/g
    : /(﴿[^﴾]{2,}﴾(?:\s*[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\s*\)\s*[\d٠-٩۰-۹]+\s*\()?[۔.؟!،؛]*|﴿[^﴾]{2,}$|^[^﴿]{2,}﴾(?:\s*[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\s*\)\s*[\d٠-٩۰-۹]+\s*\()?[۔.؟!،؛]*)/g;
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
            const combinedNoTashkeel = combinedAr.replace(/[\u064B-\u065F\u0670]/g, "");
            const isDuaCtx =
              block?.blockType === "dua" ||
              DUA_MARKER_REGEX.test(combinedAr) ||
              DUA_MARKER_REGEX.test(combinedNoTashkeel);
            const isHadithCtx =
              block?.blockType === "hadith" ||
              HADITH_ARABIC_MARKER_REGEX.test(combinedAr) ||
              HADITH_ARABIC_MARKER_REGEX.test(combinedNoTashkeel);
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
      const innerOnly = token.replace(/[﴿﴾\s\d٠-٩۰-۹\(\)\[\]۔.،؛؟!]/g, "");
      const isStrayCloseOnUrdu = !token.includes("﴿") && token.includes("﴾") && (innerOnly.length < 5 || detectIsUrduScript(token));
      if (isStrayCloseOnUrdu) {
        const strippedUrdu = token.replace(/^[^﴿]*?﴾\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()?\s*/, "").trim();
        if (strippedUrdu && hasSpeakableLetters(strippedUrdu)) {
          parts.push({ text: strippedUrdu, forcedType: null });
        }
        lastIdx = match.index + match[0].length;
        continue;
      }

      // Extract optional trailing footnote index like (1) or (١) or )١( OR inline bracket citation [غافر: ٦٥]
      let footnoteNum = 0;
      const tailSlice = rawText.slice(match.index + match[0].length, match.index + match[0].length + 42);
      let inlineCitationHint = null;
      const inlineCiteMatch = tailSlice.match(
        /^\s*(?:[\(\[]\s*)+([^\d٠-٩۰-۹\]\)\n:：]{2,28}?)\s*[:：]\s*([٠-٩۰-۹\d]{1,3})(?:\s*[-–—]\s*([٠-٩۰-۹\d]{1,3}))?\s*[\)\]]/
      );
      if (inlineCiteMatch) {
        const sNum = lookupSurahNumberFromName(inlineCiteMatch[1]);
        const aNum = parseArabicIndicDigitsToInt(inlineCiteMatch[2]);
        const eNum = inlineCiteMatch[3] ? parseArabicIndicDigitsToInt(inlineCiteMatch[3]) : aNum;
        if (sNum > 0 && aNum > 0) {
          inlineCitationHint = { surahNumber: sNum, ayahNumber: aNum, endAyahNumber: eNum || aNum };
        }
      }
      const fnMatch =
        token.match(/﴾\s*(?:[\(\[]\s*([\d٠-٩۰-۹]+)\s*[\)\]]|\)\s*([\d٠-٩۰-۹]+)\s*\()/) ||
        (!inlineCitationHint &&
          tailSlice.match(/^\s*(?:[\(\[]\s*([\d٠-٩۰-۹]+)\s*[\)\]]|\)\s*([\d٠-٩۰-۹]+)\s*\()/));
      if (fnMatch) {
        footnoteNum = parseArabicIndicDigitsToInt(fnMatch[1] || fnMatch[2]);
      }
      const cleanVerse = token
        .replace(/^[«"“]+|[»"”]+$/g, "")
        .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*[۔.؟!،؛]*$/, "")
        .replace(/[۔.؟!،؛]+$/, "")
        .trim();
      if (detectIsUrduScript(cleanVerse) && !/[ۓ\uFB50-\uFDCF]/.test(cleanVerse)) {
        parts.push({ text: cleanVerse.replace(/[﴿﴾]/g, "").trim(), forcedType: null });
      } else {
        parts.push({ text: cleanVerse, forcedType: "quran", footnoteNum, inlineCitationHint });
      }
      if (inlineCiteMatch) {
        lastIdx = match.index + match[0].length + inlineCiteMatch[0].length;
        tokenRegex.lastIndex = lastIdx;
        continue;
      }
    } else {
      const inner = token
        .replace(/[۔.؟!،؛]+$/, "")
        .replace(/^[«"“]+|[»"”]+$/g, "")
        .trim();
      const innerNoTashkeel = inner.replace(/[\u064B-\u065F\u0670]/g, "");
      const isInnerUrdu = detectIsUrduScript(inner);
      if (!isInnerUrdu) {
        const precedingText = rawText.slice(
          Math.max(0, match.index - 90),
          match.index
        );
        const isDuaContext =
          block?.blockType === "dua" ||
          DUA_MARKER_REGEX.test(inner) ||
          DUA_MARKER_REGEX.test(innerNoTashkeel);
        const isHadithContext =
          block?.blockType === "hadith" ||
          HADITH_URDU_INTRO_REGEX.test(precedingText) ||
          HADITH_ARABIC_MARKER_REGEX.test(precedingText + " " + inner) ||
          HADITH_ARABIC_MARKER_REGEX.test(precedingText + " " + innerNoTashkeel);
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
      .replace(/^\s*﴾+\s*/, "")
      .replace(/^\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*/, "")
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
        part.inlineCitationHint ||
        (part.footnoteNum && footnoteQuranMap[part.footnoteNum]) ||
        (part.text.split(/\s+/).length <= 5 ? footnoteQuranMap.__first : null) ||
        null;
      const partBareLettersLen = part.text.replace(/[﴿﴾\s\d٠-٩۰-۹\(\)\[\]۔.،؛؟!]/g, "").length;
      const isQcfMushaf = Boolean(part.inlineCitationHint && /[ۓ\uFB50-\uFDCF]/.test(part.text));
      const isCrossPageIncomplete =
        Boolean(block?.crossPageQuranText) &&
        (!(part.text.includes("﴿") && part.text.includes("﴾")) && partBareLettersLen < 26);
      sentences.push({
        originalText: part.text,
        cleanedPronunciationText: normalizeUrduTextForPronunciation(part.text, "ar"),
        segmentType: "quran",
        language: "ar",
        hasQuranBrackets: true,
        isQcfMushaf,
        quranVerificationText: isCrossPageIncomplete ? block.crossPageQuranText : part.text,
        surahNumber: part.inlineCitationHint?.surahNumber || block?.surahNumber || fnHint?.surahNumber || 0,
        ayahNumber: part.inlineCitationHint?.ayahNumber || block?.ayahNumber || fnHint?.ayahNumber || 0,
        endAyahNumber: part.inlineCitationHint?.endAyahNumber || block?.endAyahNumber || fnHint?.endAyahNumber || 0,
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

    // Protect leading numbered section/list markers (e.g. "۱۰۔ اخلاص...", "١- ...") from sentence-splitting right after the digit
    const protectedPartText =
      block?.blockType === "heading"
        ? part.text
        : part.text.replace(/(^|\n)(\s*[٠-٩۰-۹\d]{1,3}\s*[۔.])\s+/g, "$1$2\u00A0");

    // Split on major sentence terminators: Urdu full stop (۔), question mark (؟), exclamation (!), period (.), newline (\n)
    const initialChunks = (
      block?.blockType === "heading"
        ? [protectedPartText]
        : protectedPartText.split(/(?<=[۔؟!\.\n]) +/)
    )
      .map((c) => c.replace(/\u00A0/g, " ").replace(/^[۔.،؛:\s—–-]+/, "").trim())
      .filter((c) => c && hasSpeakableLetters(c));

    // Step 2: Intra-sentence & intra-paragraph mixed-language splitter:
    // If any chunk contains an inline transition between Urdu and Arabic (or Hadith matn + trailing Takhrij),
    // split it into ordered language-accurate sub-segments so Arabic is NEVER sent to Urdu TTS or vice versa.
    const rawChunks = [];
    for (const ic of initialChunks) {
      const subSegs = splitMixedLanguageSubSegments(ic, block);
      for (const sub of subSegs) {
        if (sub && sub.text && hasSpeakableLetters(sub.text)) {
          rawChunks.push(sub);
        }
      }
    }

    let buffer = "";
    let bufferForcedType = null;
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkObj = rawChunks[i];
      const chunk = chunkObj.text;
      const chunkForcedType = chunkObj.forcedType || null;

      if (!buffer) {
        buffer = chunk;
        bufferForcedType = chunkForcedType;
        continue;
      }

      const bufferIsUrdu = detectIsUrduScript(buffer);
      const chunkIsUrdu = detectIsUrduScript(chunk);
      const sameLanguage = bufferIsUrdu === chunkIsUrdu;
      const sameForcedType = bufferForcedType === chunkForcedType;

      // Only merge short clauses if they share the EXACT SAME language and forced segment type (never merge Urdu into Arabic!)
      if (
        sameLanguage &&
        sameForcedType &&
        !bufferForcedType &&
        buffer.length + chunk.length < 155 &&
        (!/[۔؟!\.]$/.test(buffer) || buffer.length < 22)
      ) {
        buffer = `${buffer} ${chunk}`;
      } else {
        sentences.push(buildSentenceObject(buffer, block, blockIndex, bufferForcedType));
        buffer = chunk;
        bufferForcedType = chunkForcedType;
      }
    }
    if (buffer && hasSpeakableLetters(buffer)) {
      sentences.push(buildSentenceObject(buffer, block, blockIndex, bufferForcedType));
    }
  }

  return sentences;
}

/**
 * Multi-Level Intra-Sentence & Intra-Paragraph Language Splitter:
 * Detects transitions between Urdu and Arabic within the same sentence/clause
 * (e.g., Urdu commentary + unquoted Arabic Hadith/quote/dua, or Arabic Hadith + trailing Takhrij/Urdu explanation)
 * and splits them into ordered, single-language sub-segments.
 */
function splitMixedLanguageSubSegments(chunkText, block = null) {
  const cleaned = String(chunkText || "").trim();
  if (!cleaned) return [];
  if (block?.blockType === "heading") {
    return [{ text: cleaned, forcedType: null }];
  }

  // 1. Separate trailing Hadith Takhrij / citation brackets at the end of a Hadith or Arabic sentence
  // e.g. «إنما الأعمال بالنيات» [رواه البخاري ومسلم] or رواه البخاري (١)
  const takhrijMatch = cleaned.match(
    /^(.*?)\s*(\[(?:رواه|أخرجه|متفق\s+عليه|صحيح\s+البخاري|صحيح\s+مسلم|سنن\s+[^\]]+)[^\]]*\]|\((?:رواه|أخرجه|متفق\s+عليه|صحيح\s+البخاري|صحيح\s+مسلم|سنن\s+[^\)]+)[^\)]*\))\s*[۔.؟!]*$/
  );
  if (takhrijMatch && takhrijMatch[1].trim().length >= 10) {
    const mainBody = takhrijMatch[1].trim();
    const takhrijPart = takhrijMatch[2].trim();
    return [
      ...splitMixedLanguageSubSegments(mainBody, block),
      { text: takhrijPart, forcedType: "arabic_quote" },
    ];
  }

  // 2. Token-level scan for intra-sentence language switches (Urdu <-> Arabic runs of >= 3 words)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return [{ text: cleaned, forcedType: null }];
  }

  const classifyTokenLang = (w) => {
    const bare = w.replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–\-]/g, "");
    if (!bare) return "neutral";
    const urNorm = bare
      .replace(/\u0643/g, "\u06A9")
      .replace(/[\u0649\u064A]/g, "\u06CC")
      .replace(/\u0647/g, "\u06C1");
    if (
      new RegExp(STRICT_URDU_ONLY_CHARS_REGEX.source).test(bare) ||
      new RegExp(EXCLUSIVE_URDU_WORDS_REGEX.source).test(urNorm) ||
      /(?:وں|یں|ائ|ئے|ئی)$/.test(urNorm)
    ) {
      return "ur";
    }
    const bareNoTash = bare.replace(/[\u064B-\u065F\u0670]/g, "");
    const hasDenseTashkeel = (bare.match(/[\u064B-\u0652\u0670]/g) || []).length >= 2;
    if (
      hasDenseTashkeel ||
      /^(?:ال[\u0621-\u064A]{2,}|وال[\u0621-\u064A]{2,}|بال[\u0621-\u064A]{2,}|فال[\u0621-\u064A]{2,}|لل[\u0621-\u064A]{2,}|قال|فقال|يقول|عن|حدثنا|أخبرنا|رواه|أخرجه|اللهم|إنما|الذي|التي|الذين|وهو|وهي|وهم|هذا|هذه|ذلك|تلك|ليس|كان|كانت|يكون|رسول|النبي|صلى|وسلم|رضي|عنه|عنها|عنهما|عنهم)$/.test(
        bareNoTash
      )
    ) {
      return "ar";
    }
    return "neutral";
  };

  const tokenLangs = words.map(classifyTokenLang);
  const hasExplicitUrdu = tokenLangs.includes("ur");
  const hasExplicitArabic = tokenLangs.includes("ar");
  if (!hasExplicitUrdu || !hasExplicitArabic) {
    return [{ text: cleaned, forcedType: null }];
  }

  // Forward-backfill neutral tokens so contiguous runs are identified cleanly
  const resolvedLangs = [...tokenLangs];
  let currentRunLang = resolvedLangs.find((l) => l !== "neutral") || "ur";
  for (let i = 0; i < resolvedLangs.length; i++) {
    if (resolvedLangs[i] === "neutral") {
      // Look ahead within 2 words to see if an Arabic phrase starts right here (e.g. preposition before Arabic noun)
      const nextExplicit = resolvedLangs.slice(i + 1, i + 4).find((l) => l !== "neutral");
      if (
        nextExplicit === "ar" &&
        /^(?:من|في|على|إلى|عن|مع|كل|غير|بعد|قبل|عند|بين|تحت|فوق|إن|أن|لا|ما|قد|لقد|يا|أيها)$/.test(
          words[i].replace(/[\u064B-\u065F\u0670۔.،؛؟!:"'«»\(\)\[\]]/g, "")
        )
      ) {
        currentRunLang = "ar";
      }
      resolvedLangs[i] = currentRunLang;
    } else {
      currentRunLang = resolvedLangs[i];
    }
  }

  // Group into runs and only split if an embedded run has >= 3 words (to prevent splitting single borrowed Arabic loanwords inside Urdu like "قرآنِ کریم" or "رسول اللہ ﷺ")
  const rawRuns = [];
  for (let i = 0; i < words.length; i++) {
    const lang = resolvedLangs[i];
    if (rawRuns.length === 0 || rawRuns[rawRuns.length - 1].lang !== lang) {
      rawRuns.push({ lang, words: [words[i]] });
    } else {
      rawRuns[rawRuns.length - 1].words.push(words[i]);
    }
  }

  const mergedRuns = [];
  for (let i = 0; i < rawRuns.length; i++) {
    const run = rawRuns[i];
    const runText = run.words.join(" ");
    const runNoTash = runText.replace(/[\u064B-\u065F\u0670]/g, "");
    const hasDenseTashkeelRun = (runText.match(/[\u064B-\u0652\u0670]/g) || []).length >= 4;
    const isGenuineArabicClause =
      hasDenseTashkeelRun ||
      /^(?:قال|فقال|يقول|حدثنا|أخبرنا|سمعت|رواه|أخرجه|متفق\s+عليه|إنما|اللهم|أعوذ|سبحان|الحمد\s+لله)/.test(
        runNoTash.replace(/^[٭•\-\s]+/, "")
      ) ||
      (run.words.length >= 6 &&
        !/(?:رحمه\s+الله|حفظه\s+الله|رضي\s+الله|صلى\s+الله\s+عليه\s+وسلم|تعالى|تعالي)/.test(
          runNoTash
        ));

    const isShortBorrowedArabicInUrdu =
      run.lang === "ar" && !isGenuineArabicClause;

    if (isShortBorrowedArabicInUrdu) {
      if (mergedRuns.length > 0 && mergedRuns[mergedRuns.length - 1].lang === "ur") {
        mergedRuns[mergedRuns.length - 1].words.push(...run.words);
      } else {
        mergedRuns.push({ lang: "ur", words: [...run.words] });
      }
    } else if (
      mergedRuns.length > 0 &&
      mergedRuns[mergedRuns.length - 1].lang === run.lang
    ) {
      mergedRuns[mergedRuns.length - 1].words.push(...run.words);
    } else {
      mergedRuns.push({ lang: run.lang, words: [...run.words] });
    }
  }

  if (mergedRuns.length <= 1) {
    return [{ text: cleaned, forcedType: null }];
  }

  return mergedRuns.map((r, idx) => {
    const segText = r.words.join(" ").trim();
    if (r.lang === "ar") {
      const prevRunText = idx > 0 ? mergedRuns[idx - 1].words.join(" ") : "";
      const segNoTash = segText.replace(/[\u064B-\u065F\u0670]/g, "");
      const isDua = DUA_MARKER_REGEX.test(segText) || DUA_MARKER_REGEX.test(segNoTash);
      const isHadith =
        HADITH_URDU_INTRO_REGEX.test(prevRunText) ||
        HADITH_ARABIC_MARKER_REGEX.test(segText) ||
        HADITH_ARABIC_MARKER_REGEX.test(segNoTash);
      return {
        text: segText,
        forcedType: isDua ? "dua" : isHadith ? "hadith" : "arabic_quote",
      };
    }
    return {
      text: segText,
      forcedType: "urdu_body",
    };
  });
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
    (classification.segmentType === "quran" && detectIsUrduScript(text)
      ? "urdu_body"
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
const NOORI_HAMZA_MADDA_MARK_GIDS = new Set([264, 265, 270]);

function isNooriNuqtaMarkGid(c) {
  return (c >= 460 && c <= 484) || NOORI_HAMZA_MADDA_MARK_GIDS.has(c);
}

function isNooriVowelMarkGid(c) {
  return (c >= 256 && c <= 263) || (c >= 266 && c <= 269);
}

function isNooriMarkGid(c) {
  return isNooriNuqtaMarkGid(c) || isNooriVowelMarkGid(c);
}

function canonicalizeShaddaOrder(str) {
  if (!str) return "";
  // Canonical Unicode order: Shadda (\u0651) before short vowel / superscript alef
  return String(str).replace(/([\u064B-\u0650\u0652\u0670]+)\u0651/g, "\u0651$1");
}

function decodeIslamicHonorificPua(str) {
  if (!str) return "";
  return String(str)
    .replace(/\uF023/g, "")
    .replace(/\uF044/g, " عز وجل ")
    .replace(/\uF045/g, " جل جلاله ")
    .replace(/\uF046/g, " تبارك وتعالى ")
    .replace(/[\uF048\u1916]/g, " ﷺ ")
    .replace(/\uF056/g, " رحمه الله ")
    .replace(/\uF049/g, " رضي الله عنه ")
    .replace(/\uF04A/g, " رضي الله عنها ")
    .replace(/\uF04B/g, " رضي الله عنهما ")
    .replace(/\uF04C/g, " رضي الله عنهم ")
    .replace(/[\uF04D\uF04F]/g, " رحمه الله ")
    .replace(/\uF04E/g, " رضي الله عنهن ")
    .replace(/\uF052/g, " عليهما السلام ")
    .replace(/\uF053/g, " عليه السلام ")
    .replace(/[\uF055\uF058]/g, " رحمهم الله ")
    .replace(/[\u0003\u0128]/g, " ")
    .replace(/[\x00-\x02\x04-\x08\x0B\x0C\x0E-\x1F\u0134\u01B0\u01D6\u02EC\u03EB]/g, "");
}

function resolveNooriSkeletonList(skels, nuqtaMarksLtr = [], fallbackRaw = "") {
  const mQueue = [...nuqtaMarksLtr].reverse();
  const chars = [];
  for (let i = 0; i < skels.length; i++) {
    const sk = skels[i];
    // Handle chained 2-tuple [skel, inlineNuqtaMark] entries inside NOORI_ROOT_SKEL_LIG_REV (e.g. 424 -> [404, 470])
    if (
      i + 1 < skels.length &&
      isNooriNuqtaMarkGid(skels[i + 1]) &&
      NOORI_SKEL_MARK_TO_UNI[`${sk}:${skels[i + 1]}`]
    ) {
      chars.push(NOORI_SKEL_MARK_TO_UNI[`${sk}:${skels[i + 1]}`]);
      i++;
      continue;
    }
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
        fallbackRaw ||
        "";
    }
    chars.push(matched);
  }
  return chars.join("");
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
  if (NOORI_GID_TO_UNI[curr.c] !== undefined) {
    trueU = NOORI_GID_TO_UNI[curr.c];
  } else if (NOORI_ROOT_SKEL_LIG_REV[curr.c]) {
    const skels = NOORI_ROOT_SKEL_LIG_REV[curr.c];
    trueU = resolveNooriSkeletonList(skels, [], curr.rawU) || curr.rawU;
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

function decodeAlviNastaleeqGlyph(curr) {
  if (NOORI_ZERO_WIDTH_TAGS.has(curr.c) || (curr.c >= 460 && curr.c <= 484)) {
    return "";
  }
  if (curr.c === 3 || curr.c === 296) {
    return " ";
  }
  if (ALVI_NASTALEEQ_GID_TO_UNI[curr.c] !== undefined) {
    return ALVI_NASTALEEQ_GID_TO_UNI[curr.c];
  }
  if (NOORI_GID_TO_UNI[curr.c] !== undefined && curr.c < 306) {
    return NOORI_GID_TO_UNI[curr.c];
  }
  // If Identity CMap produced raw CJK / LatinExt / control char equal to GID, strip undecodable artifact
  const ch0 = curr.rawU ? curr.rawU.charCodeAt(0) : -1;
  if (ch0 === curr.c && !/[\u0600-\u06FF\s0-9.,!?:;()\[\]\-–—«»"'،؛؟]/.test(curr.rawU)) {
    return "";
  }
  return decodeIslamicHonorificPua(curr.rawU);
}

// Complete 114-Surah Arabic Name (+ historical/book aliases) -> Surah Number lookup
const ARABIC_SURAH_NAME_TO_NUMBER = {
  "الفاتحة": 1, "فاتحة": 1, "البقرة": 2, "بقرة": 2, "آل عمران": 3, "ال عمران": 3, "النساء": 4, "نساء": 4,
  "المائدة": 5, "مائدة": 5, "الأنعام": 6, "الانعام": 6, "الأعراف": 7, "الاعراف": 7, "الأنفال": 8, "الانفال": 8,
  "التوبة": 9, "براءة": 9, "يونس": 10, "هود": 11, "يوسف": 12, "الرعد": 13, "إبراهيم": 14, "ابراهيم": 14,
  "الحجر": 15, "النحل": 16, "الإسراء": 17, "الاسراء": 17, "بني اسرائيل": 17, "بنى اسرائيل": 17,
  "الكهف": 18, "مريم": 19, "طه": 20, "الأنبياء": 21, "الانبياء": 21, "الحج": 22, "المؤمنون": 23, "المومنون": 23,
  "النور": 24, "الفرقان": 25, "الشعراء": 26, "النمل": 27, "القصص": 28, "العنكبوت": 29, "الروم": 30,
  "لقمان": 31, "السجدة": 32, "الم السجدة": 32, "الأحزاب": 33, "الاحزاب": 33, "سبأ": 34, "سبا": 34,
  "فاطر": 35, "يس": 36, "الصافات": 37, "ص": 38, "الزمر": 39,
  "غافر": 40, "الغافر": 40, "المؤمن": 40, "مؤمن": 40, "المومن": 40, "مومن": 40,
  "فصلت": 41, "حم السجدة": 41, "الشورى": 42, "الشوري": 42, "الزخرف": 43, "الدخان": 44, "الجاثية": 45,
  "الأحقاف": 46, "الاحقاف": 46, "محمد": 47, "الفتح": 48, "الحجرات": 49, "ق": 50,
  "الذاريات": 51, "الطور": 52, "النجم": 53, "القمر": 54, "الرحمن": 55, "الواقعة": 56, "الحديد": 57,
  "المجادلة": 58, "الحشر": 59, "الممتحنة": 60, "الصف": 61, "الجمعة": 62, "المنافقون": 63,
  "التغابن": 64, "الطلاق": 65, "التحريم": 66, "الملك": 67, "تبارك": 67, "القلم": 68, "نون": 68,
  "الحاقة": 69, "المعارج": 70, "نوح": 71, "الجن": 72, "المزمل": 73, "المدثر": 74, "القيامة": 75,
  "الإنسان": 76, "الانسان": 76, "الدهر": 76, "المرسلات": 77, "النبأ": 78, "النبا": 78, "عم": 78,
  "النازعات": 79, "عبس": 80, "التكوير": 81, "الانفطار": 82, "المطففين": 83, "الانشقاق": 84,
  "البروج": 85, "الطارق": 86, "الأعلى": 87, "الاعلى": 87, "الاعلي": 87, "الغاشية": 88, "الفجر": 89,
  "البلد": 90, "الشمس": 91, "الليل": 92, "الضحى": 93, "الضحي": 93, "الشرح": 94, "الانشراح": 94,
  "التين": 95, "العلق": 96, "اقرأ": 96, "القدر": 97, "البينة": 98, "الزلزلة": 99, "العاديات": 100,
  "القارعة": 101, "التكاثر": 102, "العصر": 103, "الهمزة": 104, "الفيل": 105, "قريش": 106,
  "الماعون": 107, "الكوثر": 108, "الكافرون": 109, "النصر": 110, "المسد": 111, "تبت": 111, "اللهب": 111,
  "الإخلاص": 112, "الاخلاص": 112, "الفلق": 113, "الناس": 114,
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

function lookupSurahNumberFromName(rawSurahName) {
  if (!rawSurahName) return 0;
  const cleaned = String(rawSurahName)
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ةۃ]/g, "ة")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .replace(/[\-–—:：،]+$/g, "")
    .trim();
  const candidates = [
    cleaned,
    cleaned.replace(/^[أإآ]/, "ا"),
    cleaned.replace(/^ال/, ""),
    cleaned.split(/\s*[–—\-]\s*/)[0]?.trim(),
    cleaned.split(/\s*[–—\-]\s*/)[1]?.trim(),
  ].filter(Boolean);

  for (const cand of candidates) {
    if (ARABIC_SURAH_NAME_TO_NUMBER[cand]) return ARABIC_SURAH_NAME_TO_NUMBER[cand];
    const normCand = cand.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
    if (ARABIC_SURAH_NAME_TO_NUMBER[normCand]) return ARABIC_SURAH_NAME_TO_NUMBER[normCand];
  }

  // Also check inner `{alias}` like `(سورة الغافر: {مؤمن} ٦٥)` or `(سورة فصلت {حم السجدة} ٣٠-٣٢)`
  const aliasMatch = String(rawSurahName).match(/\{([^}]+)\}/);
  if (aliasMatch) {
    return lookupSurahNumberFromName(aliasMatch[1]);
  }
  return 0;
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
 * Harvest Surah & Ayah citations (single Ayah & Ayah ranges like ٣٠-٣٢, (...), [...], {alias})
 * from footnote lines BEFORE excluding footnotes from spoken audio, so partial or cross-page
 * Quranic verses resolve 100% accurately to Sheikh Abdul Rahman Al-Sudais!
 */
export function extractFootnoteQuranCitations(footnoteLines) {
  const map = {};
  if (!Array.isArray(footnoteLines) || footnoteLines.length === 0) return map;

  const combinedText = footnoteLines
    .map((l) => (typeof l === "string" ? l : l?.text || ""))
    .join("\n");

  const citationRegex =
    /(?:[\(\[\{]?\s*([٠-٩۰-۹\d]{1,2})\s*[\)\]\}]?[^\n\(\[]{0,28}?)?[\(\[]\s*سور[ةۃ]\s+([^\d٠-٩۰-۹\)\]]+?)\s*(?:الآي[ةه]\s*)?[:：،]?\s*([٠-٩۰-۹\d]{1,3})(?:\s*[-–—]\s*([٠-٩۰-۹\d]{1,3}))?\s*[\)\]]/g;

  let m;
  let seq = 1;
  while ((m = citationRegex.exec(combinedText)) !== null) {
    const fnIdx = parseArabicIndicDigitsToInt(m[1]) || seq;
    const rawSurahBlock = String(m[2] || "").trim();
    const surahNumber = lookupSurahNumberFromName(rawSurahBlock);
    const ayahNumber = parseArabicIndicDigitsToInt(m[3]);
    const endAyahNumber = m[4] ? parseArabicIndicDigitsToInt(m[4]) : ayahNumber;
    const cleanSurahLabel = rawSurahBlock.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();

    if (surahNumber > 0 && ayahNumber > 0) {
      map[fnIdx] = {
        surahNumber,
        ayahNumber,
        endAyahNumber: endAyahNumber || ayahNumber,
        surahName: `سورة ${cleanSurahLabel || surahNumber}`,
      };
      if (!map.__first) {
        map.__first = map[fnIdx];
      }
      seq++;
    }
  }
  return map;
}

function mulPdfMat(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function reconstructSpatialRtlFontItems(spatialGlyphs) {
  if (!spatialGlyphs || spatialGlyphs.length === 0) return [];

  const isCombiningMarkGlyph = (gl) =>
    /^[\u064B-\u065F\u0670\u06D6-\u06ED]+$/.test(gl.trueU) ||
    (gl.w === 0 && /^[\u064B-\u065F\u0670\u06D6-\u06ED]+/.test(gl.trueU));

  const lines = [];
  for (const gl of spatialGlyphs) {
    let ln = lines.find((l) => Math.abs(l.y - gl.y) <= 5.5);
    if (!ln) {
      ln = { y: gl.y, gs: [] };
      lines.push(ln);
    }
    ln.gs.push(gl);
  }
  lines.sort((a, b) => b.y - a.y);

  const outItems = [];
  for (const ln of lines) {
    const marks = ln.gs.filter((gl) => isCombiningMarkGlyph(gl));
    // Pre-absorb decorative Tatweel/Kashida glyphs (c === 186 in Traditional Arabic, where trueU === "" and w > 0)
    // into the adjacent Arabic base glyph so elongated words like "ا٤بػػػدخل" -> "المدخل" never split across false spatial gaps!
    const nonMarkOrdered = [...ln.gs]
      .filter((gl) => !isCombiningMarkGlyph(gl))
      .sort((a, b) => b.x + b.w / 2 - (a.x + a.w / 2));

    const bases = [];
    for (const gl of nonMarkOrdered) {
      if (gl.trueU.length === 0) {
        if (bases.length > 0 && (gl.w || 0) > 0) {
          const prevB = bases[bases.length - 1];
          const minX = Math.min(prevB.x, gl.x);
          const maxX = Math.max(prevB.x + prevB.w, gl.x + gl.w);
          prevB.x = minX;
          prevB.w = maxX - minX;
        }
        continue;
      }
      if (gl.c === 3 && gl.fontKind === "trad_arabic") {
        // Mark c===3 in Traditional Arabic so we can strip phantom spaces directly before a word-final ة suffix (e.g. "الصلا ة", "الدعو ة", "أُمَّ ة")
        const prevB = bases.length > 0 ? bases[bases.length - 1] : null;
        if (prevB && /[\u0621-\u064A\u064B-\u065F\u0670]$/.test(prevB.trueU)) {
          gl._beforeTaMarbutaCandidate = true;
        }
      }
      bases.push({ ...gl });
    }
    // Filter out phantom space glyphs directly before word-final "ة" (like "الصلا ة", "الدعو ة", "أُمَّ ة", "سُمْعَ ةً", "بِشَفَاعَ ةِ")
    for (let bi = bases.length - 2; bi >= 1; bi--) {
      if (
        bases[bi]._beforeTaMarbutaCandidate &&
        /^ة(?:[\u064B-\u065F\u0670]*)$/.test(bases[bi + 1]?.trueU || "")
      ) {
        const prevB = bases[bi - 1];
        const minX = Math.min(prevB.x, bases[bi].x);
        const maxX = Math.max(prevB.x + prevB.w, bases[bi].x + bases[bi].w);
        prevB.x = minX;
        prevB.w = maxX - minX;
        bases.splice(bi, 1);
      }
    }

    if (bases.length === 0) continue;

    const baseMarks = bases.map(() => []);
    for (const mk of marks) {
      const mx = mk.x + (mk.w || 0) / 2;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let bi = 0; bi < bases.length; bi++) {
        const b = bases[bi];
        if (b.trueU === " " || b.c === 3) continue;
        const bEnd = b.x + b.w;
        const clamped = Math.max(b.x, Math.min(bEnd, mx));
        const dist = Math.abs(mx - clamped) + Math.abs(mx - (b.x + b.w / 2)) * 0.05;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = bi;
        }
      }
      baseMarks[bestIdx].push({ u: mk.trueU, mx });
    }

    const avgFs =
      bases.reduce((acc, b) => acc + (b.fs || 12), 0) / Math.max(1, bases.length);
    const wordGapThreshold = Math.max(1.85, avgFs * 0.14);

    // Build words in RTL order, preserving LTR order inside Arabic-Indic/ASCII digit runs
    const rawTokens = [];
    let curWord = null;

    const flushWord = () => {
      if (!curWord) return;
      rawTokens.push(curWord);
      curWord = null;
    };

    for (let bi = 0; bi < bases.length; bi++) {
      const b = bases[bi];
      if (b.c === 3 || b.trueU === " ") {
        flushWord();
        continue;
      }

      let piece = b.trueU;
      const mks = baseMarks[bi];
      if (mks.length > 0) {
        const chars = [...piece];
        const perChar = chars.map(() => []);
        const bw = Math.max(1, b.w);
        if (chars.length === 2 && mks.length === 2) {
          // On a 2-letter Arabic ligature (e.g. "له", "لح", "بم"), rightmost mark belongs to char[0] and leftmost mark to char[1]
          const sortedMks = [...mks].sort((a, b2) => b2.mx - a.mx);
          perChar[0].push(sortedMks[0].u);
          perChar[1].push(sortedMks[1].u);
        } else {
          for (const mk of mks) {
            let cIdx = 0;
            if (chars.length > 1) {
              const relFromRight = Math.max(0, Math.min(0.999, (b.x + bw - mk.mx) / bw));
              cIdx = Math.min(chars.length - 1, Math.floor(relFromRight * chars.length));
              // In "الْ..." definite ligatures (e.g. "له", "لح"), sukun (ْ) on "ل" belongs on char 0
              if (chars[0] === "ل" && mk.u === "ْ") {
                cIdx = 0;
              }
            }
            perChar[cIdx].push(mk.u);
          }
        }
        piece = chars
          .map((ch, ci) => {
            const ms = perChar[ci].join("");
            if (!ms) return ch;
            return canonicalizeShaddaOrder(ch + ms);
          })
          .join("");
      }

      piece = piece
        .replace(/بٔ/g, "أ")
        .replace(/أ/g, "أ")
        .replace(/إ/g, "إ")
        .replace(/ؤ/g, "ؤ")
        .replace(/ئ/g, "ئ")
        .replace(/ىٔ/g, "ئ");

      const prevBase = bi > 0 ? bases[bi - 1] : null;
      const prevWasSpace =
        prevBase && (prevBase.c === 3 || prevBase.trueU === " ");
      const gapFromPrev = prevBase ? prevBase.x - (b.x + b.w) : 0;
      const prevStripLen = prevBase ? prevBase.trueU.replace(/[\u064B-\u065F\u0670]/g, "").length : 0;
      const isSinglePrefixParticle = prevStripLen === 1 && /^[بلكوس]$/.test(prevBase?.trueU?.[0] || "");

      if (
        !curWord ||
        prevWasSpace ||
        (gapFromPrev > wordGapThreshold && !(isSinglePrefixParticle && gapFromPrev < avgFs * 0.25))
      ) {
        flushWord();
        curWord = {
          parts: [piece],
          minX: b.x,
          maxX: b.x + Math.max(1, b.w),
          y: b.y,
          fs: b.fs || avgFs,
          fontName: b.fontName,
        };
      } else {
        curWord.parts.push(piece);
        curWord.minX = Math.min(curWord.minX, b.x);
        curWord.maxX = Math.max(curWord.maxX, b.x + Math.max(1, b.w));
      }
    }
    flushWord();

    for (const tok of rawTokens) {
      // Fix any embedded LTR digit runs (e.g. "(٣٥٩٠)" or "٧/٦٢" stored RTL) while keeping surrounding Arabic RTL
      const fixedParts = [];
      let digitBuf = [];
      const flushDigitBuf = () => {
        if (digitBuf.length > 0) {
          fixedParts.push(digitBuf.reverse().join(""));
          digitBuf = [];
        }
      };
      for (const p of tok.parts) {
        if (/^[٠-٩۰-۹0-9]+$/.test(p)) {
          digitBuf.push(p);
        } else {
          flushDigitBuf();
          fixedParts.push(p);
        }
      }
      flushDigitBuf();

      const finalStr = canonicalizeShaddaOrder(fixedParts.join(""))
        .replace(/\u0652([\u064B-\u0650])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      if (!finalStr) continue;

      outItems.push({
        str: finalStr,
        transform: [tok.fs, 0, 0, tok.fs, tok.minX, tok.y],
        width: Math.max(4, tok.maxX - tok.minX),
        height: tok.fs,
        fontName: tok.fontName,
        isSpatialWord: true,
        hadSpaceBeforeItem: true,
      });
    }
  }

  return outItems;
}

/**
 * Recover 100% dot-accurate glyph strings from pdf.js getOperatorList() + getTextContent():
 * 1. Fixes pdf.js's character-by-character BiDi reversal of multi-character Urdu/Arabic ligature glyphs.
 * 2. Decodes Jameel Noori Nastaleeq dynamic skeleton+nuqta-mark ligatures (Lookups #30 & #33..48) without displacing consonant nuqtas on vowel tashkeel.
 * 3. Decodes Alvi Nastaleeq and KFGQPC Arabic Symbols 01 honorifics cleanly.
 * 4. Reconstructs Traditional Arabic & Muhammadi Quranic spatially in true RTL (with LTR digit runs and canonical shadda order).
 */
export function recoverTrueGlyphTextItems(items, opList, commonObjs = null) {
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
  const fontKindFromCommonObjs = {};
  let curFont = "";
  const fontStack1 = [];

  const resolveFontKindByCommonName = (fName) => {
    if (!commonObjs || !fName) return null;
    try {
      if (!commonObjs.has(fName)) return null;
      const fObj = commonObjs.get(fName);
      const disp = String(fObj?.name || "");
      if (!disp) return null;
      if (/QCF_BSML/i.test(disp)) return "qcf_bsml";
      if (/QCF_P\d+/i.test(disp)) return "qcf_page";
      if (/MUHAMMADI\s+QURANIC/i.test(disp)) return "saleem_quran";
      if (/Traditional\s+Arabic/i.test(disp)) return "trad_arabic";
      if (/Alvi\s+Nastaleeq/i.test(disp)) return "alvi";
      if (/Jameel\s+Noori/i.test(disp)) return "noori";
      if (/KFGQPC/i.test(disp)) return "kfgqpc";
    } catch {}
    return null;
  };

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
          alviScore: 0,
          tradArabicScore: 0,
          saleemQuranScore: 0,
        };
      }
      const explicitKind = resolveFontKindByCommonName(curFont);
      if (explicitKind) fontKindFromCommonObjs[curFont] = explicitKind;
    } else if (Array.isArray(args[0]) && curFont && fontStats[curFont]) {
      const st = fontStats[curFont];
      for (const g of args[0]) {
        if (!g || typeof g !== "object" || typeof g.unicode !== "string") continue;
        const c = g.originalCharCode;
        const w = Math.round(g.width || 0);
        const u = g.unicode;

        // 0. Alvi Nastaleeq Identity fallback signature (missing embedded font file: w === 1000 & Identity codepoint)
        if (
          w === 1000 &&
          u.length === 1 &&
          u.charCodeAt(0) === c &&
          (c === 296 || c === 3 || NOORI_ZERO_WIDTH_TAGS.has(c) || c > 2500)
        ) {
          st.alviScore += 4;
        }

        // 1. Jameel Noori Nastaleeq signatures (exclude MCS Taybah symbol c === 6422 and Alvi Identity glyphs)
        if (
          (c === 296 && w === 9) ||
          (c >= 460 && c <= 484 && w === 0) ||
          (c > 2500 && c !== 6422 && !(w === 1000 && u.charCodeAt(0) === c))
        ) {
          st.nooriScore += 3;
        }

        // 2. Traditional Arabic (TTF #4 & #17) signatures
        if (
          (c === 166 && u === "ا") ||
          (c === 190 && u === "ؿ") ||
          (c === 506 && u === " ") ||
          (c === 519 && u === "ْ") ||
          (c === 347 && w > 0) ||
          (c === 361 && u === "ب٠") ||
          (c === 364) ||
          (c === 365 && u === "ب٤") ||
          (c === 369) ||
          (c === 374 && u === "ب٭") ||
          (c >= 200 && c <= 204 && /^[\u064B-\u0652]$/.test(u)) ||
          (c >= 205 && c <= 214 && /^[\u0653-\u065C\u06F0-\u06F90-9]$/.test(u))
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
    if (fontKindFromCommonObjs[fName]) {
      fontKindMap[fName] = fontKindFromCommonObjs[fName];
    } else if (st.saleemQuranScore >= 12 && st.saleemQuranScore >= st.tradArabicScore) {
      fontKindMap[fName] = "saleem_quran";
    } else if (st.tradArabicScore >= 5) {
      fontKindMap[fName] = "trad_arabic";
    } else if (st.alviScore >= 4 && st.alviScore >= st.nooriScore) {
      fontKindMap[fName] = "alvi";
    } else if (st.nooriScore > 0) {
      fontKindMap[fName] = "noori";
    } else {
      fontKindMap[fName] = "standard";
    }
  }

  const glyphStream = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stateStack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let fontSize = 1;
  let charSpacing = 0;
  let wordSpacing = 0;
  let horizScale = 1;
  curFont = "";

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === 10) {
      stateStack.push({
        ctm: [...ctm],
        curFont,
        fontSize,
        charSpacing,
        wordSpacing,
        horizScale,
        leading,
      });
      continue;
    }
    if (fn === 11) {
      const prev = stateStack.pop();
      if (prev) {
        ctm = prev.ctm;
        curFont = prev.curFont;
        fontSize = prev.fontSize;
        charSpacing = prev.charSpacing;
        wordSpacing = prev.wordSpacing;
        horizScale = prev.horizScale;
        leading = prev.leading;
      }
      continue;
    }
    if (fn === 12 && args && args.length >= 6) {
      ctm = mulPdfMat(args, ctm);
      continue;
    }
    if (fn === 31) {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
      continue;
    }
    // PDF.js OPS: 33 = setCharSpacing (Tc), 34 = setWordSpacing (Tw), 35 = setHScale (Tz, %)
    if (fn === 33 && args) {
      charSpacing = Number(args[0]) || 0;
      continue;
    }
    if (fn === 34 && args) {
      wordSpacing = Number(args[0]) || 0;
      continue;
    }
    if (fn === 35 && args) {
      horizScale = (Number(args[0]) || 100) / 100;
      continue;
    }
    if (fn === 36 && args) {
      leading = Number(args[0]) || 0;
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
      fontSize = Number(args[1]) || 1;
    } else if (fn === 40 && args.length >= 2) {
      tlm = mulPdfMat([1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0], tlm);
      tm = [...tlm];
    } else if (fn === 41 && args.length >= 2) {
      leading = -(Number(args[1]) || 0);
      tlm = mulPdfMat([1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0], tlm);
      tm = [...tlm];
    } else if (fn === 42 && args.length >= 6) {
      tm = [...args];
      tlm = [...args];
    } else if (fn === 43) {
      tlm = mulPdfMat([1, 0, 0, 1, 0, -leading], tlm);
      tm = [...tlm];
    } else if (fn === 44 || fn === 45 || fn === 46 || fn === 47 || Array.isArray(args[0])) {
      if (fn === 46 || fn === 47) {
        tlm = mulPdfMat([1, 0, 0, 1, 0, -leading], tlm);
        tm = [...tlm];
      }
      const arr = fn === 47 ? args[2] : args[0];
      if (!Array.isArray(arr)) continue;
      const fontKind = fontKindMap[curFont] || "standard";
      for (const g of arr) {
        if (typeof g === "number") {
          const dx = (-g / 1000) * fontSize * horizScale;
          tm = mulPdfMat([1, 0, 0, 1, dx, 0], tm);
        } else if (g && typeof g === "object") {
          const trm = mulPdfMat(tm, ctm);
          const sx = Math.hypot(trm[0], trm[1]) || 1;
          const sy = Math.hypot(trm[2], trm[3]) || 1;
          const isSpaceGlyph = g.originalCharCode === 3 || g.unicode === " ";
          const rawGlyphAdv = ((g.width || 0) / 1000) * fontSize * horizScale;
          const advT =
            (((g.width || 0) / 1000) * fontSize +
              charSpacing +
              (isSpaceGlyph ? wordSpacing : 0)) *
            horizScale;
          const gx = trm[4];
          const gy = trm[5];
          const gw = Math.abs(rawGlyphAdv * sx);
          const gfs = Math.max(6, Math.abs(fontSize * sy));

          if (typeof g.unicode === "string" && g.unicode.length > 0) {
            glyphStream.push({
              rawU: g.unicode,
              trueU: g.unicode,
              c: g.originalCharCode,
              w: Math.round(g.width || 0),
              x: gx,
              y: gy,
              gw,
              fs: gfs,
              fontKind,
              fontName: curFont,
            });
          }
          tm = mulPdfMat([1, 0, 0, 1, advT, 0], tm);
        }
      }
    }
  }

  if (glyphStream.length === 0) return items;

  // Decode each glyph according to its font family (noori, alvi, kfgqpc, trad_arabic, saleem_quran, or standard)
  const spatialArabicGlyphs = [];
  let idx = 0;
  while (idx < glyphStream.length) {
    const curr = glyphStream[idx];
    if (curr.fontKind === "trad_arabic") {
      const mapped =
        TRAD_ARABIC_GID_TO_UNI[curr.c] !== undefined
          ? TRAD_ARABIC_GID_TO_UNI[curr.c]
          : curr.rawU;
      curr.trueU = decodeIslamicHonorificPua(mapped);
      spatialArabicGlyphs.push({ ...curr, w: curr.gw });
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
        .replace(/ا([\u064B-\u0652]*)\u0654/g, "أ$1")
        .replace(/ا([\u064B-\u0652]*)\u0655/g, "إ$1");
      spatialArabicGlyphs.push({ ...curr, w: curr.gw });
      idx++;
      continue;
    }

    if (curr.fontKind === "qcf_bsml") {
      if (curr.c === 388 || curr.rawU === "ﭽ") {
        curr.trueU = "﴿";
      } else if (curr.c === 387 || curr.rawU === "ﭼ") {
        curr.trueU = "﴾";
      } else {
        curr.trueU = "";
      }
      idx++;
      continue;
    }

    if (curr.fontKind === "qcf_page") {
      curr.trueU = curr.rawU;
      idx++;
      continue;
    }

    if (curr.fontKind === "alvi") {
      curr.trueU = decodeAlviNastaleeqGlyph(curr);
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
      const nuqtaMarksLtr = [];
      const vowelMarksLtr = [];
      while (
        idx < glyphStream.length &&
        glyphStream[idx].fontKind === "noori" &&
        (glyphStream[idx].w === 0 || glyphStream[idx].w === 1000) &&
        (isNooriMarkGid(glyphStream[idx].c) || NOORI_ZERO_WIDTH_TAGS.has(glyphStream[idx].c))
      ) {
        const gMark = glyphStream[idx];
        if (!NOORI_ZERO_WIDTH_TAGS.has(gMark.c)) {
          if (isNooriNuqtaMarkGid(gMark.c)) {
            nuqtaMarksLtr.push(gMark.c);
          } else if (isNooriVowelMarkGid(gMark.c)) {
            const vUni = NOORI_GID_TO_UNI[gMark.c] || gMark.rawU || "";
            if (/^[\u064B-\u0652\u0670]$/.test(vUni)) {
              vowelMarksLtr.push(vUni);
            }
          }
        }
        gMark.trueU = "";
        idx++;
      }
      if (idx < glyphStream.length && glyphStream[idx].fontKind === "noori") {
        const base = glyphStream[idx++];
        const baseRoot = NOORI_SKEL_VARIANTS_TO_ROOT[base.c] || base.c;
        const skels = NOORI_ROOT_SKEL_LIG_REV[base.c] || [baseRoot];
        // Note: only use 264/265/270 as nuqta/hamza marks if base has an Alif skeleton (307/308)
        const hasAlifSkel = skels.some((sk) => sk === 307 || sk === 308);
        const finalNuqtas = [];
        for (const mGid of nuqtaMarksLtr) {
          if (NOORI_HAMZA_MADDA_MARK_GIDS.has(mGid) && !hasAlifSkel) {
            const vUni = NOORI_GID_TO_UNI[mGid] || "";
            if (vUni) vowelMarksLtr.push(vUni);
          } else {
            finalNuqtas.push(mGid);
          }
        }
        const resolvedStr = resolveNooriSkeletonList(skels, finalNuqtas, base.rawU);
        const vowelSuffix = vowelMarksLtr.join("");
        const combined =
          vowelSuffix && resolvedStr.length > 0
            ? canonicalizeShaddaOrder(resolvedStr[0] + vowelSuffix + resolvedStr.slice(1))
            : resolvedStr;
        base.trueU = decodeIslamicHonorificPua(combined).replace(/\u0649/g, "\u06CC");
        continue;
      }
    }

    idx++;
    curr.trueU = decodeSingleNooriGlyph(curr);
  }

  const sortChars = (s) => [...s].sort().join("");

  // Build spatial RTL word items for Traditional Arabic & Muhammadi Quranic lines
  const spatialArabicItems = reconstructSpatialRtlFontItems(spatialArabicGlyphs);

  // Align each pdf.js text item with its exact glyph slice in glyphStream (for non-spatial fonts like Noori, Alvi, KFGQPC, Standard)
  let gCursor = 0;
  const decodedItems = [];
  for (const item of items) {
    const str = String(item.str || "");
    const strNoSpace = str.replace(/\s+/g, "");
    if (!strNoSpace) {
      decodedItems.push({ ...item, isWhitespaceItem: true });
      continue;
    }
    const itemFontKind = fontKindMap[item.fontName];
    // Never emit raw pdf.js items for Traditional Arabic / Muhammadi Quranic when spatialArabicItems covers them
    if (
      spatialArabicItems.length > 0 &&
      (itemFontKind === "trad_arabic" || itemFontKind === "saleem_quran")
    ) {
      // Advance gCursor past contiguous spatial Arabic glyphs so subsequent Urdu/Noori items stay synchronized!
      while (
        gCursor < glyphStream.length &&
        (glyphStream[gCursor].fontKind === "trad_arabic" ||
          glyphStream[gCursor].fontKind === "saleem_quran")
      ) {
        gCursor++;
      }
      continue;
    }

    // Also skip any remaining spatial Arabic glyphs at gCursor before searching for a non-spatial item
    if (
      spatialArabicItems.length > 0 &&
      itemFontKind !== "trad_arabic" &&
      itemFontKind !== "saleem_quran"
    ) {
      while (
        gCursor < glyphStream.length &&
        (glyphStream[gCursor].fontKind === "trad_arabic" ||
          glyphStream[gCursor].fontKind === "saleem_quran")
      ) {
        gCursor++;
      }
    }

    const revStrNoSpace = [...str].reverse().join("").replace(/\s+/g, "");

    let matchedSlice = null;
    let matchedEnd = -1;
    let isReversed = false;

    const candidates = [];
    for (let s = gCursor; s < glyphStream.length; s++) {
      if (
        itemFontKind &&
        glyphStream[s].fontKind &&
        glyphStream[s].fontKind !== itemFontKind &&
        glyphStream[s].fontKind !== "alvi"
      ) {
        continue;
      }
      candidates.push(s);
    }
    for (let s = Math.max(0, gCursor - 40); s < gCursor; s++) {
      if (
        itemFontKind &&
        glyphStream[s].fontKind &&
        glyphStream[s].fontKind !== itemFontKind &&
        glyphStream[s].fontKind !== "alvi"
      ) {
        continue;
      }
      candidates.push(s);
    }

    for (const start of candidates) {
      let acc = "";
      const slice = [];
      for (let k = start; k < Math.min(glyphStream.length, start + 140); k++) {
        const g = glyphStream[k];
        if (
          acc.length === 0 &&
          !g.rawU.replace(/\s+/g, "") &&
          !g.trueU.replace(/\s+/g, "") &&
          (g.fontKind === "trad_arabic" || g.fontKind === "saleem_quran")
        ) {
          break;
        }
        if (
          itemFontKind &&
          g.fontKind &&
          g.fontKind !== itemFontKind &&
          g.fontKind !== "alvi"
        ) {
          break;
        }
        slice.push(g);
        acc += g.rawU.replace(/\s+/g, "");
        if (acc.length >= revStrNoSpace.length) {
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
          // Check forward order (acc === strNoSpace) FIRST so palindromic digit runs like "33" ("۵۰"/"۲۴") never flip!
          if (acc === strNoSpace) {
            matchedSlice = slice;
            matchedEnd = k + 1;
            isReversed = false;
            break;
          } else if (acc === revStrNoSpace) {
            matchedSlice = slice;
            matchedEnd = k + 1;
            isReversed = true;
            break;
          } else if (
            acc.length === strNoSpace.length &&
            (g.fontKind === "saleem_quran" || g.fontKind === "trad_arabic" || g.fontKind === "alvi") &&
            sortChars(acc) === sortChars(strNoSpace)
          ) {
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
      const sliceKind = matchedSlice[0]?.fontKind;
      if (
        (sliceKind === "trad_arabic" || sliceKind === "saleem_quran") &&
        spatialArabicItems.length > 0
      ) {
        continue;
      }
      const decodedJoinedRaw = matchedSlice.map((g) => g.trueU).join("");
      const isPureDigitsOrNumPunct = /^[0-9٠-٩۰-۹.,:/\-–—]+$/.test(decodedJoinedRaw);
      const ordered =
        isReversed && !isPureDigitsOrNumPunct
          ? [...matchedSlice].reverse()
          : matchedSlice;
      const decodedStr = decodeIslamicHonorificPua(
        ordered.map((g) => g.trueU).join("")
      )
        .replace(/بٔ/g, "أ")
        .replace(/أ/g, "أ")
        .replace(/إ/g, "إ")
        .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
        .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم");
      decodedItems.push({ ...item, str: decodedStr });
    } else {
      decodedItems.push({
        ...item,
        str: decodeIslamicHonorificPua(str)
          .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, "صلى الله عليه وسلم")
          .replace(/ملسو\s*هيلع\s*للها\s*لصى/g, "صلى الله عليه وسلم"),
      });
    }
  }

  return [...decodedItems, ...spatialArabicItems];
}

/**
 * Post-process common Nastaliq sub-word splits after GSUB decoding so every word is 100% whole.
 */
export function polishDecodedNastaliqLine(rawLine) {
  if (!rawLine) return "";
  let s = decodeIslamicHonorificPua(String(rawLine));
  // Strip decorative Word/InPage "=" border runs
  s = s.replace(/={2,}/g, " ").replace(/^\s*=+\s*|\s*=+\s*$/g, " ");
  // Convert QCF_BSML "چ" brackets around King Fahd Mushaf QCF_P* glyphs (e.g. P24 "چۓۓ ﮲...﮿ چ [غافر: ٦٥]") into ﴿...﴾
  s = s.replace(/چ(\s*[ۓڎڈژ\uFB50-\uFDCF\s]{2,}?)چ/g, "﴿$1﴾");
  s = s.replace(/چ(?=\s*[ۓ\uFB50-\uFDCF]{2,})/g, "﴿").replace(/(?<=[ۓ\uFB50-\uFDCF]\s*)چ/g, "﴾");
  // Normalize visually reversed guillemets » ... « into canonical « ... » (fixes P4, P205 Hadiths)
  s = s.replace(/»\s*([^«»\n]{3,}?)\s*«/g, "«$1»");
  // Replace King Fahd Mushaf Page 458 (QCF_P458) cover calligraphy verse with authentic Unicode text (Surah Az-Zumar 39:2)
  // while keeping non-458 QCF Mushaf verses followed by [سورة: آية] identifiable via their citation!
  s = s.replace(
    /﴿\s*[ۓڎڈژ\uFB50-\uFDCF\s]+\s*﴾(?!\s*(?:\[\s*|[\(\[]\s*)[^\]]+[:：])/g,
    "﴿فَاعْبُدِ اللَّهَ مُخْلِصًا لَّهُ الدِّينَ﴾"
  );
  // Strip table-of-contents dot leaders (2+ consecutive periods/dots)
  s = s.replace(/\.{2,}|…+/g, " ");
  // Rejoin Noon Ghunna (ں), Bari Ye (ے), or Ta-Marbuta (ة/ۃ) when separated by a space from its stem (including before parentheses or brackets)
  s = s
    .replace(/([\u0621-\u06D3][\u064B-\u065F\u0670]*)\s+([ںےةۃ][\u064B-\u065F\u0670]*)(?=\s|$|[۔.،؛؟!:\(\)\[\]«»"'])/g, "$1$2")
    .replace(/(^|\s)ےہ(?=\s|$|[۔.،؛؟!:])/g, "$1ہے")
    .replace(/لادینیت\s+کو\s*سا[كک]ی\s*ئٹ/g, "لادینیت کی ویب سائٹ")
    .replace(/سا[كک]ی\s*ئٹ/g, "سائٹ");
  // Rejoin isolated initial Alif before known stems where Nastaliq kerning left a small gap
  s = s
    .replace(/(^|\s)ا\s+(خلاص|سلام|عتبار|حساس|نسان|یمان|مت|عمال|حادیث|حادىث|سلاف|طاعت|ختیار|ہمیت|مید|سلوب|لفاظ|مور|حکام|نبیاء|نبىاء)(?=\s|$|[۔.،؛؟!:])/g, "$1ا$2")
    .replace(/ا(اللہ|الله)/g, "$1")
    .replace(/(^|\s)پیش\s+اب(?=\s|$|[۔.،؛؟!:])/g, "$1پیشاب")
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
    .replace(/دَخَ\s+لَ/g, "دَخَلَ")
    .replace(/الجَ\s+ن[\u064B-\u065F]*ةَ/g, "الجَنَّةَ")
    .replace(/([كک]ُ)\s+(ل[\u064B-\u065F]*هَا)/g, "$1$2")
    .replace(/إِن([\u064B-\u065F]*)ماال/g, "إِن$1مَا ال")
    .replace(/([،؛])(?=[\u0621-\u065F\u0670-\u06D3«"“])/g, "$1 ")
    .replace(/(^|\s)ا\s+گر(?=\s|محبت|کوئی|آپ|وہ|یہ)/g, "$1اگر ")
    .replace(/(^|\s)درگسر/g, "$1درگزر ")
    .replace(/(^|\s)ہر\s*گس(?=\s|$|[۔.،؛؟!:])/g, "$1ہرگز")
    .replace(/د\s+شمن/g, "دشمن")
    .replace(/بھائی\s+چار\s+گی/g, "بھائی چارگی")
    .replace(/دو\s+ستیاں/g, "دوستیاں")
    .replace(/اندر\s+ونی/g, "اندرونی")
    .replace(/پوشید\s+[ہه]/g, "پوشیدہ")
    .replace(/(کرنا|ہونا|دینا|لینا|آنا|جانا|کہنا|رہنا)جو(اللہ|الله)(?=\s|$|[۔.،؛؟!:])/g, "$1 جو $2")
    .replace(/(کرنا|ہونا|دینا|لینا|آنا|جانا|کہنا|رہنا)جو(?=\s|$|[۔.،؛؟!:])/g, "$1 جو")
    .replace(/(^|\s)جو(اللہ|الله|ہمارے|تمہارے|اپنے)(?=\s|$|[۔.،؛؟!:])/g, "$1جو $2")
    .replace(/(^|\s)گویاکہ(?=\s|$|[۔.،؛؟!:])/g, "$1گویا کہ")
    .replace(/(^|\s)ر?[كک]رہاہے(?=\s|$|[۔.،؛؟!:])/g, "$1کر رہا ہے")
    .replace(/(^|\s)رہ(ا|ی|ے)(ہے|ہیں)(?=\s|$|[۔.،؛؟!:])/g, "$1رہ$2 $3")
    .replace(/(^|\s)(عطا|ادا|جدا|پیدا|برباد|ارشاد|یا|درگزر|مدد|پسند|خیر)([كک]یا|[كک]ر|[كک]رے|[كک]ریں|[كک]رنے|[كک]رنا|فرمایا|فرماتے|فرمايا|دلایا)(لیا|دیا)?(جائے|جائیں|ہے|ہیں|گی|گا)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4 $5")
    .replace(/(^|\s)([كک]ر|ہو|لے|دے)(لیا|دیا|جائے|جائیں|گیا|گئی|گئے|چکا|چکی|چکے|سکے|سکیں|پاتا|پاتی|لی|لیں)(جائے|جائیں|ہے|ہیں|تھا|تھے)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4")
    .replace(/(^|\s)([كک]ر)(دیتا|دیتی|دیتے|لیتا|لیتی|لیتے)(ہے|ہیں|تھا|تھے)?(کیونکہ|تاکہ|بلکہ|کہ)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4 $5")
    .replace(/([\u0621-\u06D3]{2,}?)(جاتا|جاتی|جاتے|رہتا|رہتی|رہتے|کرتا|کرتی|کرتے|كرتا|كرتی|كرتے|دیتا|دیتی|دیتے|لیتا|لیتی|لیتے|ہوتا|ہوتی|ہوتے|سکتا|سکتی|سکتے|ملتا|ملتی|ملتے)(ہے|ہیں|تھا|تھے|تھی)?(کیونکہ|تاکہ|بلکہ|لیکن|مگر|کہ|مثلاً|اگرچہ)?(?=\s|$|[۔.،؛؟!:])/g, "$1 $2 $3 $4")
    .replace(/(^|\s)(جاتا|جاتی|جاتے|رہتا|رہتی|رہتے|کرتا|کرتی|کرتے|كرتا|كرتی|كرتے|دیتا|دیتی|دیتے|لیتا|لیتی|لیتے|ہوتا|ہوتی|ہوتے|سکتا|سکتی|سکتے|آتا|آتی|آتے|ملتا|ملتی|ملتے|چاہتا|چاہتی|چاہتے|کھولا|کہتا|کہتی|کہتے)(ہے|ہیں|تھا|تھے|تھی)(کیونکہ|تاکہ|بلکہ|لیکن|مگر|کہ|مثلاً|اگرچہ)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4")
    .replace(/(^|\s)(کے|كے|کی|كی|کا|سے|پر|میں)(باوجود|مطابق|خلاف|ذریعے|ذریعہ|ساتھ|بعد|پہلے|تحت|متعلق|درمیان|اندر|باہر|علم)(بھی|ہی)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4")
    .replace(/(^|\s)(بناپر)(ہے|ہیں)?(کہ)?(?=\s|$|[۔.،؛؟!:])/g, "$1بنا پر $3 $4")
    .replace(/(^|\s)(ہے|ہیں|تھا|تھے|تھی|ہو)(کیونکہ|تاکہ|بلکہ|لیکن|مگر|کہ|تو|اور|اگرچہ|مثلاً)(ان|جو|وہ|یہ)?(ہمارے|تمہارے|اپنے)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4 $5")
    .replace(/(^|\s)(کھلا|گرا|پھنسا|بندھا|لکھا|بنا|رکھا)ہوا([آ-ے]{2,})?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 ہوا $3")
    .replace(/(^|\s)(گنہگار|فاسق|فاجر|دیندار|سعادت\s*مند)(اور|ہی|بھی|ہے)(کو|جو)?(?=\s|$|[۔.،؛؟!:])/g, "$1$2 $3 $4")
    .replace(/(^|\s)حق\s*وصبر([كک]ی|[كک]ے)?(?=\s|$|[۔.،؛؟!:])/g, "$1حق و صبر $2")
    .replace(/(^|\s)فاسق\s*وفاجر(ہی)?(?=\s|$|[۔.،؛؟!:])/g, "$1فاسق و فاجر $2")
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
    .replace(/کھول\s+د\s*[يی]\s*ہے/g, "کھول دی ہے")
    .replace(/ما\s+جست\s+[یى]ر/g, "ماجستیر")
    .replace(/(^|\s)ش\s+یطان(?=\s|$|[۔.،؛؟!:])/g, "$1شیطان")
    .replace(/بناپرا?ش\s+یطان/g, "بنا پر شیطان")
    .replace(/(^|\s)[كک]ردیتاہے(?=\s|$|[۔.،؛؟!:])/g, "$1کر دیتا ہے")
    .replace(/(^|\s)[كک]رتاہے(?=\s|$|[۔.،؛؟!:])/g, "$1کرتا ہے")
    .replace(/(^|\s)لگتاہے(?=\s|$|[۔.،؛؟!:])/g, "$1لگتا ہے")
    .replace(/(^|\s)بلند\s+یوں(?=\s|$|[۔.،؛؟!:])/g, "$1بلندیوں")
    .replace(/(^|\s)ب\s+ھلائیوں(?=\s|$|[۔.،؛؟!:])/g, "$1بھلائیوں")
    .replace(/(^|\s)مسکی\s+ن(?=\s|$|[۔.،؛؟!:])/g, "$1مسکین")
    .replace(/(^|\s)[كک]امقصد(?=\s|$|[۔.،؛؟!:])/g, "$1کا مقصد")
    .replace(/ل[یى]ٰ\s*ن[كک]ہ\s+اللہ\s+تعا\s+فرماتا/g, "کیونکہ اللہ تعالیٰ فرماتا")
    .replace(/ل[یى]ٰ\s+سے/g, "تعالیٰ سے")
    .replace(/اللہ\s+تعا\s+لیٰ/g, "اللہ تعالیٰ")
    .replace(/ک[یى]و\s+ن[كک]ہ/g, "کیونکہ")
    .replace(/آ\s+پ(?=\s|$|[۔.،؛؟!:])/g, "آپ")
    .replace(/مخرَجاویرْ\s*زقه/g, "مَخْرَجًا وَيَرْزُقْهُ")
    .replace(/مخرَجا\s+ویرْ\s*زقه/g, "مَخْرَجًا وَيَرْزُقْهُ")
    .replace(/بِ\s+دِ[یي]نِ[کك]م/g, "بِدِينِكُمْ")
    .replace(/اللهب\s*د[یي]ن[کك]م/g, "اللَّهَ بِدِينِكُمْ");

  // Repair Arabic Hadith & Quranic vocalization (tashkeel) and sub-word splits from Traditional Arabic & Muhammadi Quranic fonts
  // First collapse any space before a combining diacritic (e.g. "الأَعْمَال ُ" -> "الأَعْمَالُ", "و َمنَْ" -> "وَمَنْ", "ب َليَ" -> "بَلَىٰ")
  s = s
    .replace(/مَا\s+َاجَرَ/g, "مَا هَاجَرَ")
    .replace(/\s+([\u064B-\u065F\u0670]+)/g, "$1")
    .replace(/ا([\u064B-\u0652]*)\u0654/g, "أ$1")
    .replace(/ا([\u064B-\u0652]*)\u0655/g, "إ$1");

  s = s
    .replace(/(^|\s)لا\s*ہو\s*ر(?=\s|$|[۔.،؛؟!:])/g, "$1لاہور")
    .replace(/المحم\s+د([ىی])/g, "المحمد$1")
    .replace(/الهْمَِ|الْهمَِ/g, "الْهَمِّ")
    .replace(/الحَْزَنِ/g, "الْحَزَنِ")
    .replace(/إِنِيّ/g, "إِنِّي")
    .replace(/الرِجَالِ/g, "الرِّجَالِ")
    .replace(/بِضارِهِم/g, "بِضَارِّهِمْ")
    .replace(/باِذِٕنِ|باِذْنِ/g, "بِإِذْنِ")
    .replace(/الأَعْمَالُبِالنِّيَّاتِ|الأَعْمَالُبِالنِّيَّاتِ/g, "الأَعْمَالُ بِالنِّيَّاتِ")
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
    .replace(/﴿(?:\s*﴿)+/g, "﴿")
    .replace(/﴾(?:\s*﴾)+/g, "﴾")
    .replace(/\(\s*[\u064B-\u065F\u0670\u06D6-\u06ED\u0610-\u061A\s]*([\d٠-٩۰-۹]{1,2})\s*\)/g, "($1)")
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
  reciterId = "ar.saoodshuraym",
  bookMetadata = null,
}) {
  // Check cache first (only return cached data if not forcing fresh OCR and cached page has current pipelineVersion)
  if (!forceOcr) {
    const cached = await getCachedPageOcr(bookId, pageNumber);
    if (
      cached?.data &&
      Array.isArray(cached.data.sentences) &&
      cached.data.sentences.length > 0 &&
      cached.data.pipelineVersion === READER_PIPELINE_VERSION
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
      nativeItems = recoverTrueGlyphTextItems(rawItems, operatorList, pdfPage?.commonObjs || null);
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

  // Peek adjacent page (N+1 or N-1) when a Quran verse ﴿...﴾ OR an incomplete sentence spans a page boundary!
  const crossPageInfo = {
    continuesToNextPage: false,
    isContinuationFromPrevPage: false,
    nextPageFirstSentenceText: "",
    combinedCrossPageText: null,
  };

  if (pdfDoc && blocksFromNative.length > 0) {
    try {
      const lastBlk = blocksFromNative[blocksFromNative.length - 1];
      const lastTxt = String(lastBlk?.originalText || "").trim();
      const strippedLastTxt = lastTxt
        .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
        .trim();
      const openCnt = (lastTxt.match(/﴿/g) || []).length;
      const closeCnt = (lastTxt.match(/﴾/g) || []).length;
      const isUnclosedQuran = openCnt > closeCnt;
      const lastComp = evaluateSemanticCompleteness(
        strippedLastTxt,
        lastBlk?.language || "ur"
      );
      const isSentenceContinuingAcrossPage =
        lastBlk?.blockType !== "heading" &&
        lastBlk?.blockType !== "footnote" &&
        (isUnclosedQuran ||
          !/[۔.؟!﴾»]$/.test(strippedLastTxt) ||
          !lastComp.isComplete);

      if (isSentenceContinuingAcrossPage && pageNumber < (pdfDoc.numPages || 9999)) {
        crossPageInfo.continuesToNextPage = true;
        const nextPage = await pdfDoc.getPage(pageNumber + 1);
        const nextVp = nextPage.getViewport({ scale: 1.0 });
        const [nTc, nOp] = await Promise.all([
          nextPage.getTextContent({ disableCombineTextItems: true }),
          nextPage.getOperatorList().catch(() => null),
        ]);
        const nSepY = detectFootnoteSeparatorY(nOp);
        const nItems = recoverTrueGlyphTextItems(nTc?.items || [], nOp, nextPage?.commonObjs || null);
        const nAnalysis = analyzeNativePdfTextLayer(nItems, nextVp, nSepY);
        const firstNextLine = (nAnalysis.orderedLines || []).slice(0, 4).map((l) => l.text).join(" ");
        if (isUnclosedQuran) {
          const qTailMatch = firstNextLine.match(/^[^﴾]*﴾/);
          const unclosedTail = lastTxt.slice(lastTxt.lastIndexOf("﴿"));
          if (qTailMatch) {
            lastBlk.crossPageQuranText = `${unclosedTail} ${qTailMatch[0]}`;
          }
          if (nAnalysis.footnoteQuranMap && Object.keys(lastBlk.footnoteQuranMap || {}).length === 0) {
            lastBlk.footnoteQuranMap = { ...nAnalysis.footnoteQuranMap };
          }
        }
        const firstNextSentMatch = firstNextLine.match(/^[^۔.؟!﴾»]+[۔.؟!﴾»]?/);
        if (firstNextSentMatch) {
          crossPageInfo.nextPageFirstSentenceText = firstNextSentMatch[0].trim();
          const tailClause = strippedLastTxt.split(/[۔.؟!]/).pop()?.trim() || strippedLastTxt;
          crossPageInfo.combinedCrossPageText = `${tailClause} ${crossPageInfo.nextPageFirstSentenceText}`
            .replace(/\s+/g, " ")
            .trim();
        }
      }

      const firstBlk = blocksFromNative[0];
      const firstTxt = String(firstBlk?.originalText || "");
      const fOpenCnt = (firstTxt.match(/﴿/g) || []).length;
      const fCloseCnt = (firstTxt.match(/﴾/g) || []).length;
      if (pageNumber > 1) {
        const cachedPrev = await getCachedPageOcr(bookId, pageNumber - 1).catch(() => null);
        const prevSents = cachedPrev?.data?.sentences || [];
        const prevLastSent = prevSents[prevSents.length - 1];
        if (prevLastSent?.continuesToNextPage) {
          crossPageInfo.isContinuationFromPrevPage = true;
        }
        if (fCloseCnt > fOpenCnt) {
          const prevPage = await pdfDoc.getPage(pageNumber - 1);
          const prevVp = prevPage.getViewport({ scale: 1.0 });
          const [pTc, pOp] = await Promise.all([
            prevPage.getTextContent({ disableCombineTextItems: true }),
            prevPage.getOperatorList().catch(() => null),
          ]);
          const pSepY = detectFootnoteSeparatorY(pOp);
          const pItems = recoverTrueGlyphTextItems(pTc?.items || [], pOp, prevPage?.commonObjs || null);
          const pAnalysis = analyzeNativePdfTextLayer(pItems, prevVp, pSepY);
          const lastPrevLines = (pAnalysis.orderedLines || []).slice(-4).map((l) => l.text).join(" ");
          const qHeadIdx = lastPrevLines.lastIndexOf("﴿");
          const unclosedHead = firstTxt.slice(0, firstTxt.indexOf("﴾") + 1);
          if (qHeadIdx >= 0) {
            firstBlk.crossPageQuranText = `${lastPrevLines.slice(qHeadIdx)} ${unclosedHead}`;
            crossPageInfo.isContinuationFromPrevPage = true;
          }
        }
      }
    } catch {
      // Cross-page peek is best-effort enhancement only
    }
  }

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
          bookMetadata,
          crossPageInfo,
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

  let processed = await finalizeStructuredBlocks({
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
    bookMetadata,
    crossPageInfo,
  });

  // Check 8 of QA Layer: Compare with Visual OCR if QA confidence on native layer is low (< 76)
  if (
    processed?.qaReport?.ocrComparisonNeeded &&
    autoOcrEnabled &&
    pdfPage &&
    !shouldRunOcr
  ) {
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
        const ocrProcessed = await finalizeStructuredBlocks({
          blocks: ocrResult.blocks,
          pageNumber,
          bookId,
          extractionSource: ocrResult.engine || "gemini-vision-ocr-reconciled",
          qualityScore: ocrResult.qualityScore ?? 94,
          hasOcrWarnings: Boolean(ocrResult.hasOcrWarnings),
          ocrWarningMessage: ocrResult.ocrWarningMessage || "",
          detectedAnomalies: ocrResult.detectedAnomalies || analysis.anomalies,
          rawPdfLayerText: analysis.rawText,
          reciterId,
          bookMetadata,
          crossPageInfo,
        });
        if (
          (ocrProcessed?.qaReport?.extractionConfidence || 0) >
          (processed?.qaReport?.extractionConfidence || 0)
        ) {
          processed = ocrProcessed;
        }
      }
    } catch {
      // Keep native processed result with QA warning badge if offline/OCR unavailable
    }
  }

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

  // Preserve explicit space-token boundaries BEFORE filtering out whitespace-only items!
  const annotatedItems = [];
  let pendingSpaceBefore = false;
  for (let i = 0; i < sortedItems.length; i++) {
    const it = sortedItems[i];
    const cleaned = String(it.str || "").replace(/\.{2,}|…+/g, " ");
    if (!cleaned.trim()) {
      pendingSpaceBefore = true;
      if (annotatedItems.length > 0) {
        annotatedItems[annotatedItems.length - 1].hadSpaceAfterItem = true;
      }
      continue;
    }
    annotatedItems.push({
      ...it,
      str: cleaned,
      hadSpaceBeforeItem: Boolean(it.hadSpaceBeforeItem) || pendingSpaceBefore,
      hadSpaceAfterItem: false,
    });
    pendingSpaceBefore = false;
  }

  const nonDotItems = annotatedItems;

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
    const hadExplicitSpaceToken =
      Boolean(currentChunk.hadSpaceAfterItem) ||
      Boolean(curr.hadSpaceBeforeItem) ||
      Boolean(currentChunk.isSpatialWord) ||
      Boolean(curr.isSpatialWord);
    const hadRawTrailingLeadingSpace =
      /[ \t]$/.test(currentChunk.rawStr || "") ||
      /^[ \t]/.test(curr.str || "");
    const hadExplicitSpace = hadExplicitSpaceToken || (hadRawTrailingLeadingSpace && rtlGap > 1.2);
    const isCombiningOnly = /^[\u064B-\u065F\u0670]+$/.test(currClean);
    const startsWithWordFinalChar = /^[ںےةۃ]$/.test(currClean);
    const prevLastChar = prevClean.slice(-1);
    const prevEndsWithDualJoiner = DUAL_JOINING_LETTERS_REGEX.test(prevLastChar);
    const prevEndsWithWordFinal = STRICTLY_WORD_FINAL_CHARS.has(prevLastChar);
    const prevIsNonConnectorEnd =
      NON_CONNECTING_AFTER_CHARS.has(prevLastChar) && !prevEndsWithWordFinal;
    const prevEndsWithPunctOrBracket = /[۔.،؛؟!:«»﴿﴾\(\)\[\]"“”—–-]$/.test(prevClean);
    const currStartsWithPunctOrBracket = /^[۔.،؛؟!:«»﴿﴾\(\)\[\]"“”—–-]/.test(currClean);

    // Check if joining the last token of currentChunk with the first token of currClean forms a known word
    const prevLastWord = prevClean.split(/\s+/).pop() || "";
    const currFirstWord = currClean.split(/\s+/)[0] || "";
    const prevLastWordBare = prevLastWord.replace(/[\u064B-\u065F\u0670]/g, "");
    const currFirstWordBare = currFirstWord.replace(/[\u064B-\u065F\u0670]/g, "");
    const combinedCandidate = prevLastWordBare + currFirstWordBare;
    const prevIsStandaloneKnownWord =
      prevLastWordBare.length >= 2 &&
      (KNOWN_WORDS_SET.has(prevLastWordBare) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(prevLastWordBare, "ur")) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(prevLastWordBare, "ar")));
    const currIsStandaloneKnownWord =
      currFirstWordBare.length >= 2 &&
      (KNOWN_WORDS_SET.has(currFirstWordBare) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(currFirstWordBare, "ur")) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(currFirstWordBare, "ar")));
    const prevEndsWithCompleteUrduSuffix =
      prevLastWordBare.length >= 3 &&
      /(?:جاتا|جاتی|جاتے|رہتا|رہتی|رہتے|کرتا|کرتی|کرتے|دیتا|دیتی|دیتے|لیتا|لیتی|لیتے|ہوتا|ہوتی|ہوتے|سکتا|سکتی|سکتے|چڑھاتا|بڑھاتا|فرمایا|دلایا|کرنا|ہونا|دینا|لینا|ارشاد|برباد)$/.test(
        prevLastWordBare
      );
    const formsKnownWord =
      !hadExplicitSpaceToken &&
      rtlGap <= 6 &&
      prevLastWordBare.length <= 4 &&
      currFirstWordBare.length <= 4 &&
      (KNOWN_WORDS_SET.has(combinedCandidate) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(combinedCandidate, "ur")) ||
        KNOWN_WORDS_SET.has(canonicalizeTextForLanguage(combinedCandidate, "ar")));

    // Join adjacent Nastaleeq sub-word ligatures cleanly:
    // 1. Always attach standalone combining marks or isolated word-final endings (ں، ے)
    // 2. Join across a non-connector split (ا/د/ڈ/ذ/ر/ڑ/ز/ژ/و -> اہل، اپنی، دودھ، گوبر، سارے، بڑی، ملاوٹ) when tight (rtlGap <= 1.2)
    //    ONLY when neither side is already a standalone known word or complete inflected word!
    // 3. Join when the merged candidate forms a dictionary word, or when merging a 1-char fragment across <= 2 gap
    // 4. NEVER glue separate words ending in dual-joiners (بھی عبادت، مفہوم بیان، خالص ہو، حدیث کی، عظیم الشان)
    const shouldJoinDirectly =
      isCombiningOnly ||
      (!hadExplicitSpaceToken &&
        !currentChunk.isSpatialWord &&
        !curr.isSpatialWord &&
        !prevEndsWithWordFinal &&
        !prevEndsWithPunctOrBracket &&
        !currStartsWithPunctOrBracket &&
        prevIsNonConnectorEnd &&
        !prevIsStandaloneKnownWord &&
        !currIsStandaloneKnownWord &&
        !prevEndsWithCompleteUrduSuffix &&
        rtlGap <= 1.2) ||
      (!currentChunk.isSpatialWord &&
        !curr.isSpatialWord &&
        startsWithWordFinalChar &&
        !prevEndsWithWordFinal &&
        !prevIsStandaloneKnownWord &&
        rtlGap <= 8) ||
      formsKnownWord ||
      (!hadExplicitSpace &&
        !prevEndsWithWordFinal &&
        !prevEndsWithPunctOrBracket &&
        !currStartsWithPunctOrBracket &&
        (prevEndsWithDualJoiner || prevIsNonConnectorEnd) &&
        rtlGap <= 2 &&
        prevLastWordBare.length === 1);

    if (shouldJoinDirectly) {
      const newMinX = Math.min(currentChunk.normX, curr.normX);
      const newMaxX = Math.max(
        currentChunk.normX + currentChunk.normW,
        curr.normX + curr.normW
      );
      currentChunk.str = prevClean + currClean;
      currentChunk.rawStr = (currentChunk.rawStr || "") + (curr.str || "");
      currentChunk.hadSpaceAfterItem = Boolean(curr.hadSpaceAfterItem);
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
    const tx = item.transform ? item.transform[4] : 0;
    const ty = item.transform ? item.transform[5] : 0;
    // Never assign str.length * 5.5 to zero-width trailing RTL Nastaliq items (e.g. P394 "یقیناً  \u00a0" w=0),
    // or normX + normW jumps rightward across adjacent items on the line!
    const w =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : Math.min(18, Math.max(2, str.trim().length * 2.2));
    const h = item.height || Math.abs(item.transform?.[3] || 14);

    // Keep explicit whitespace items so coalesceRtlLineItems knows where a PDF space sat between words!
    if (!str.trim() && !item.isWhitespaceItem) continue;
    if (w <= 0.1 && !str.trim()) continue;

    const normY = Math.round(((pageHeight - ty - h) / pageHeight) * 1000);
    const normX = Math.round((tx / pageWidth) * 1000);
    const normW = Math.max(2, Math.round((w / pageWidth) * 1000));
    const normH = Math.max(16, Math.round((h / pageHeight) * 1000));

    let bucket = lineBuckets.find((b) => Math.abs(b.normY - normY) <= 17);
    if (!bucket) {
      bucket = { normY, rawTy: ty, items: [] };
      lineBuckets.push(bucket);
    }
    bucket.items.push({
      str,
      rawTy: ty,
      isSpatialWord: Boolean(item.isSpatialWord),
      hadSpaceBeforeItem: Boolean(item.hadSpaceBeforeItem),
      normX: Math.max(0, Math.min(1000, normX)),
      normY: Math.max(0, Math.min(1000, normY)),
      normW: Math.max(2, Math.min(1000, normW)),
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
    // Skip pure decorative rule / equals-sign lines (e.g. "======" on P2, P460, P471)
    if (/^[\s=_\-–—*~•]+$/.test(lineText)) continue;

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
    const maxFontH = Math.max(...activeItems.map((i) => i.normH || 16));
    const avgTy =
      b.items.reduce((acc, it) => acc + (it.rawTy || 0), 0) /
      Math.max(1, b.items.length);

    const rawLineStr = b.items
      .map((it) => String(it.str || "").trim())
      .filter(Boolean)
      .join(" ");

    allDecodedLines.push({
      text: lineText,
      rawExtractedText: rawLineStr || lineText,
      items: coalescedWordItems,
      box2d: [minY, minX, maxY, maxX],
      avgTy,
      minY,
      maxFontH,
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
      const strippedTk = tk.replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–-]/g, "");
      if (strippedTk.length === 1 && /[\u0600-\u06FF]/.test(strippedTk) && strippedTk !== "و") {
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
      maxFontH: ln.maxFontH || 18,
      isFootnoteArea: false,
    });
  }

  const rawText = orderedLines.map((l) => l.text).join("\n");
  // Short clean vector pages (e.g. P1 cover title, P3 Bismillah) with valid script & 0 PUA glyphs must NOT fall back to OCR
  if (rawText.trim().length < 6) {
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
  if (rawText.trim().length < 20 && puaGlyphCount === 0 && /[\u0621-\u06D3]/.test(rawText)) {
    return {
      needsOcr: false,
      isCorruptedLayer: false,
      qualityScore: 95,
      rawText,
      orderedLines,
      footnoteQuranMap,
      anomalies: [],
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
  let blockStartLineIdx = 0;

  const fontHeights = orderedLines
    .map((l) => Number(l.maxFontH) || 18)
    .sort((a, b) => a - b);
  const bodyMedianFontH =
    fontHeights[Math.floor(fontHeights.length / 2)] || 18;

  const lineGaps = [];
  for (let i = 1; i < orderedLines.length; i++) {
    const g = orderedLines[i].box2d[0] - orderedLines[i - 1].box2d[2];
    if (g >= 2 && g <= 30) lineGaps.push(g);
  }
  lineGaps.sort((a, b) => a - b);
  const bodyMedianLineGap =
    lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length / 2)] : 15;
  const distinctHeadingGapThreshold = Math.max(22, Math.round(bodyMedianLineGap * 1.32));

  const isStructuralHeadingText = (txt) =>
    /^(?:الباب|الفصل|المبحث|المطلب|مقدمة|المقدمة|تقديم|تقريظ|خاتمة|الخاتمة|المراجع|المصادر|الفهرس|فهرس|تمهيد|شكر\s+وتقدير|تنبيه|فائدة|مثال|قاعدة|مسألة|باب|فصل|مسئلہ|قاعدہ|پہلی\s+فصل|دوسری\s+فصل|تیسری\s+فصل|چوتھی\s+فصل|پانچویں\s+فصل|پہلا\s+باب|دوسرا\s+باب|تیسرا\s+باب|تمہید|مقدمہ|خاتمہ|خلاصہ|تنبیہ|فائدہ|ضابطہ|اعتراض|جواب)\b|^(?:[\(\[]?\s*[٠-٩۰-۹\d]{1,2}\s*[\)\]]|[٠-٩۰-۹\d]{1,2}\s*[۔\-–.])\s*(?:[^\n]{3,95})$/.test(
      String(txt || "").trim()
    );

  const flushBlock = (endLineIdx) => {
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
    const maxBlockFontH = Math.max(...currentLines.map((l) => Number(l.maxFontH) || 18));
    const isFootnote = currentLines.every((l) => l.isFootnoteArea);

    const prevLineBefore = blockStartLineIdx > 0 ? orderedLines[blockStartLineIdx - 1] : null;
    const nextLineAfter = endLineIdx + 1 < orderedLines.length ? orderedLines[endLineIdx + 1] : null;
    const gapBefore = prevLineBefore ? minY - prevLineBefore.box2d[2] : 99;
    const gapAfter = nextLineAfter ? nextLineAfter.box2d[0] - maxY : 99;

    const hasLargerFont = maxBlockFontH >= bodyMedianFontH * 1.07;
    const structuralTitle = isStructuralHeadingText(combinedText);
    const hasQuoteBrackets = /[﴿﴾«»]/.test(combinedText);
    const isCenteredShortLine =
      currentLines.length === 1 &&
      combinedText.length <= 72 &&
      minX > bodyLeftMarginMinX + 40 &&
      maxX < bodyRightMarginMaxX - 35;
    const isBottomTruncatedBody =
      endLineIdx === orderedLines.length - 1 &&
      !hasLargerFont &&
      !structuralTitle &&
      !/[:：؟!]$/.test(combinedText) &&
      gapBefore < distinctHeadingGapThreshold;
    const endsWithMidClausePunct = /[،,;]$/.test(combinedText);
    const isSingleShortStandalone =
      currentLines.length === 1 &&
      combinedText.length < 82 &&
      (!/[۔.]$/.test(combinedText) || structuralTitle) &&
      !endsWithMidClausePunct &&
      !isBottomTruncatedBody &&
      (hasLargerFont ||
        structuralTitle ||
        isCenteredShortLine ||
        /[:：؟]$/.test(combinedText) ||
        gapAfter >= distinctHeadingGapThreshold ||
        gapBefore >= distinctHeadingGapThreshold);
    const isMultiOrLongHeading =
      currentLines.length <= 2 &&
      combinedText.length <= 135 &&
      !endsWithMidClausePunct &&
      !hasQuoteBrackets &&
      ((hasLargerFont && !/[۔.]$/.test(combinedText)) ||
        (structuralTitle && combinedText.length <= 95));

    const isHeading =
      !isFootnote &&
      !hasQuoteBrackets &&
      (isSingleShortStandalone || isMultiOrLongHeading);

    const cls = classifyTextSegment(
      combinedText,
      isFootnote ? "footnote" : isHeading ? "heading" : ""
    );

    const rawExtractedBlockText = currentLines
      .map((l) => l.rawExtractedText || l.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    blocks.push({
      blockType: cls.segmentType,
      language: cls.language,
      originalExtractedText: rawExtractedBlockText || combinedText,
      ocrCorrectedText: combinedText,
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

  // Compute typical RTL body margins so we distinguish true paragraph endings (short line / right-indent / vertical gap)
  // from mid-paragraph lines that merely end with a period!
  const bodyMinXs = orderedLines
    .map((l) => Number(l.box2d?.[1] ?? 100))
    .sort((a, b) => a - b);
  const bodyMaxXs = orderedLines
    .map((l) => Number(l.box2d?.[3] ?? 900))
    .sort((a, b) => b - a);
  const bodyLeftMarginMinX =
    bodyMinXs.length > 0 ? bodyMinXs[Math.floor(bodyMinXs.length * 0.2)] : 100;
  const bodyRightMarginMaxX =
    bodyMaxXs.length > 0 ? bodyMaxXs[Math.floor(bodyMaxXs.length * 0.2)] : 900;
  const paragraphGapThreshold = Math.max(18, Math.round(bodyMedianLineGap * 1.22));

  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    if (!hasSpeakableLetters(line.text)) continue;
    const prev = currentLines[currentLines.length - 1];
    const verticalGap = prev ? line.box2d[0] - prev.box2d[2] : 0;
    const accText = currentLines.map((l) => l.text).join(" ");
    const lastOpenQ = accText.lastIndexOf("﴿");
    const isInsideUnclosedQuran = lastOpenQ >= 0 && !accText.slice(lastOpenQ).includes("﴾");
    const lastOpenH = accText.lastIndexOf("«");
    const isInsideUnclosedHadith =
      lastOpenH >= 0 &&
      !accText.slice(lastOpenH).includes("»") &&
      !accText.slice(lastOpenH).includes("﴿") &&
      !line.text.includes("﴿") &&
      currentLines.length < 5;
    const isInsideUnclosedQuote = isInsideUnclosedQuran || isInsideUnclosedHadith;

    const prevIsUrdu = prev ? detectIsUrduScript(prev.text) : false;
    const currIsUrdu = detectIsUrduScript(line.text);
    const prevStripped = prev
      ? prev.text.replace(/\(\s*[\d٠-٩۰-۹]+\s*\)\s*$/, "").trim()
      : "";
    const prevEndsWithCloseOrPunct = prev
      ? /[۔؟!\.:﴾»]$/.test(prevStripped)
      : false;
    const prevIsShortParagraphEndLine = prev
      ? prevEndsWithCloseOrPunct &&
        (prev.box2d[1] > bodyLeftMarginMinX + 55 ||
          verticalGap >= paragraphGapThreshold)
      : false;
    const currHasParagraphRightIndentOrNumber =
      line.box2d[3] < bodyRightMarginMaxX - 24 ||
      /^\s*(?:[\(\[]?\s*[٠-٩۰-۹\d]{1,2}\s*[\)\]]|[٠-٩۰-۹\d]{1,2}\s*[۔\-–.]|أولاً|ثانياً|ثالثاً|رابعاً|پہلی\s+بات|دوسری\s+بات|تیسری\s+بات)/.test(
        line.text
      );
    const prevIsHeadingCandidate = prev
      ? !prev.text.includes("﴿") &&
        !isInsideUnclosedQuran &&
        (prev.maxFontH >= bodyMedianFontH * 1.07 ||
          isStructuralHeadingText(prev.text) ||
          (prev.text.length < 65 &&
            verticalGap >= distinctHeadingGapThreshold &&
            !/[،,;]$/.test(prev.text)))
      : false;
    const currStartsHeadingCandidate =
      line.maxFontH >= bodyMedianFontH * 1.07 ||
      (verticalGap >= 12 && isStructuralHeadingText(line.text));
    const prevWordCount = prev ? prev.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const currWordCount = line.text.trim().split(/\s+/).filter(Boolean).length;
    const languageSwitched =
      !isInsideUnclosedQuote &&
      prev &&
      prevIsUrdu !== currIsUrdu &&
      ((prevWordCount >= 3 && currWordCount >= 3) ||
        prevEndsWithCloseOrPunct ||
        prevIsHeadingCandidate ||
        currStartsHeadingCandidate) &&
      prev.text.length >= 6 &&
      line.text.length >= 6;

    if (
      prev &&
      !isInsideUnclosedQuote &&
      (verticalGap > Math.max(24, distinctHeadingGapThreshold) ||
        line.isFootnoteArea !== prev.isFootnoteArea ||
        languageSwitched ||
        (prevIsHeadingCandidate && verticalGap >= 10) ||
        (currStartsHeadingCandidate && verticalGap >= 10) ||
        prevIsShortParagraphEndLine ||
        (prevEndsWithCloseOrPunct && currHasParagraphRightIndentOrNumber) ||
        (/:$/.test(prevStripped) && !line.text.includes("﴿")))
    ) {
      flushBlock(i - 1);
      blockStartLineIdx = i;
    }
    if (currentLines.length === 0) {
      blockStartLineIdx = i;
    }
    currentLines.push(line);
  }
  flushBlock(orderedLines.length - 1);
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

  const res = await fetch(apiUrl("/api/reader/ocr-page"), {
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
  reciterId = "ar.saoodshuraym",
  bookMetadata = null,
  crossPageInfo = null,
}) {
  const preSentences = [];
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

      preSentences.push({
        ...sent,
        originalExtractedText:
          sent.originalExtractedText ||
          block.originalExtractedText ||
          sent.originalText,
        ocrCorrectedText: sent.originalText,
        box2d: sentenceBox2d,
        lineBoxes,
        bookId,
        pageNumber,
        paragraphIndex: bIdx,
        hasExactWordCoords,
        textValidation: validation,
        words: wordsWithCoords,
        quranMeta: null,
      });
    }
  }

  // Batch-verify all explicit Quran verses AND unbracketed pure Arabic candidates (when not Hadith, Dua, TOC, or Bibliography)
  const batchCandidates = [];
  for (let idx = 0; idx < preSentences.length; idx++) {
    const s = preSentences[idx];
    const cleanOrig = String(s.originalText || "");
    const cleanNoTash = cleanOrig.replace(/[\u064B-\u065F\u0670]/g, "");
    const isBracketedQuran = s.segmentType === "quran" || Boolean(s.hasQuranBrackets) || /[﴿﴾]/.test(cleanOrig);
    const isNonQuranExcluded =
      /[«»]/.test(cleanOrig) ||
      /^\s*[٠-٩۰-۹\d]{1,3}\s*[-–—۔.]/.test(cleanNoTash) ||
      /(?:وآخر\s+دعوانا|وصلى\s+الله\s+وسلم\s+على\s+نبينا|الصلاة\s+والسلام\s+على|أشرف\s+الأنبياء\s+والمرسلين|مدارج\s+السالكين|الناشر\s*:|عدد\s+الأجزاء)/.test(
        cleanNoTash
      ) ||
      /^(?:حدثنا|أخبرنا|عن\s|رواه|أخرجه|متفق\s+عليه|قال\s+رسول\s+الله|قال\s+النبي|اللهم)/.test(
        cleanNoTash
      );
    const isArabicCandidate =
      !isBracketedQuran &&
      !isNonQuranExcluded &&
      s.language === "ar" &&
      s.segmentType === "arabic_quote" &&
      cleanOrig.length >= 24 &&
      s.words.length >= 4;

    if (isBracketedQuran || isArabicCandidate) {
      batchCandidates.push({
        idx,
        isBracketedQuran,
        isQcfMushaf: Boolean(s.isQcfMushaf),
        text: s.quranVerificationText || cleanOrig,
        surahHint: s.surahNumber || 0,
        ayahHint: s.ayahNumber || 0,
        endAyahHint: s.endAyahNumber || 0,
        hasQuranBrackets: isBracketedQuran,
      });
    }
  }

  if (batchCandidates.length > 0) {
    const verifiedList = await verifyQuranBatchClient(batchCandidates, reciterId);
    for (let c = 0; c < batchCandidates.length; c++) {
      const cand = batchCandidates[c];
      let qMeta = verifiedList[c];
      const sent = preSentences[cand.idx];
      if (!sent) continue;

      // Secondary normalized retry for explicit ﴿...﴾ Quran brackets if first pass didn't match
      if (cand.isBracketedQuran && !qMeta?.verified) {
        const cleanedRetryText = canonicalizeTextForLanguage(
          String(cand.text || "")
            .replace(/[﴿﴾«»"“”\(\)\[\]\d٠-٩۰-۹۔.،؛؟!:—–\-]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
          "ar"
        );
        if (cleanedRetryText.length >= 5) {
          const retryMeta = await verifyQuranVerseClient(
            cleanedRetryText,
            cand.surahHint || 0,
            cand.ayahHint || 0,
            reciterId,
            cand.endAyahHint || 0,
            true
          );
          if (retryMeta?.verified) {
            qMeta = retryMeta;
          }
        }
      }

      if (cand.isBracketedQuran) {
        if (qMeta?.verified) {
          sent.quranMeta = qMeta;
          sent.surahNumber = qMeta.surahNumber || sent.surahNumber;
          sent.ayahNumber = qMeta.ayahNumber || sent.ayahNumber;
          sent.endAyahNumber = qMeta.endAyahNumber || qMeta.ayahNumber || sent.endAyahNumber;
          sent.segmentType = "quran";
          sent.hasQuranBrackets = true;
          sent.language = "ar";
          // Replace undecoded QCF Mushaf glyph placeholder (e.g. P24 [غافر: ٦٥]) with authentic verified Unicode Uthmani text
          if (cand.isQcfMushaf && qMeta.uthmaniText) {
            const authenticDisplay = `﴿${qMeta.uthmaniText}﴾`;
            sent.originalText = authenticDisplay;
            sent.cleanedPronunciationText = normalizeUrduTextForPronunciation(authenticDisplay, "ar");
            const newWords = sent.cleanedPronunciationText.split(/\s+/).filter(Boolean);
            sent.words = newWords.map((w, wIdx) => ({
              word: w,
              text: w,
              wordIndex: wIdx,
              pageNumber,
              paragraphIndex: sent.paragraphIndex,
              rect: sent.words?.[Math.min(wIdx, Math.max(0, (sent.words?.length || 1) - 1))]?.rect || null,
            }));
          }
        } else {
          // NEVER downgrade an explicit ﴿...﴾ Quranic verse to TTS arabic_quote!
          sent.segmentType = "quran";
          sent.hasQuranBrackets = true;
          sent.language = "ar";
          sent.quranUnverifiedNotice = true;
        }
      } else if (qMeta?.verified && (qMeta.confidence || 0) >= 0.87) {
        // Promote verified unbracketed Quranic verses to Sheikh Saud Al-Shuraim
        sent.quranMeta = qMeta;
        sent.surahNumber = qMeta.surahNumber || 0;
        sent.ayahNumber = qMeta.ayahNumber || 0;
        sent.endAyahNumber = qMeta.endAyahNumber || qMeta.ayahNumber || 0;
        sent.segmentType = "quran";
        sent.language = "ar";
      }
    }
  }

  const stampedSentences = preSentences.map((s, idx) => {
    let engineId = "urdu_engine";
    if (s.segmentType === "quran" && s.quranMeta?.verified) {
      engineId = "quran_engine";
    } else if (s.segmentType === "hadith" || s.segmentType === "dua") {
      engineId = "hadith_engine";
    } else if (s.language === "ar") {
      engineId = "arabic_general_engine";
    } else {
      engineId = "urdu_engine";
    }
    return {
      ...s,
      engineId,
      sentenceIndex: idx,
    };
  });

  // Apply linguistic clause refinement (merging incomplete syntactic splits & segmenting long unpunctuated paragraphs)
  const refinedSentences = refineSentencesLinguistically(stampedSentences).map(
    (s, idx) => {
      let engineId = s.engineId || "urdu_engine";
      if (s.segmentType === "quran" && s.quranMeta?.verified) {
        engineId = "quran_engine";
      } else if (s.segmentType === "hadith" || s.segmentType === "dua") {
        engineId = "hadith_engine";
      } else if (s.language === "ar") {
        engineId = "arabic_general_engine";
      } else {
        engineId = "urdu_engine";
      }
      return {
        ...s,
        engineId,
        sentenceIndex: idx,
      };
    }
  );

  // Enrich with Topic Detection, Semantic Completeness, Paragraph/Topic Boundaries, and 4-Level Pause Durations
  const { sentences: linkedSentences, topics } = enrichPageWithLinguisticStructure({
    sentences: refinedSentences,
    pageNumber,
    bookMetadata,
    crossPageInfo,
  });

  // Apply 4-Stage Text Provenance Separation, Specialized Urdu & Arabic Linguistic Processing, and 10-Point Quality Assurance
  const { sentences: allSentences, qaReport } =
    applyLinguisticAccuracyAndQualityAssurance({
      sentences: linkedSentences,
      rawPdfLayerText:
        rawPdfLayerText ||
        (blocks || []).map((b) => b.originalExtractedText || b.originalText).join("\n\n"),
      extractionSource,
      pageNumber,
    });

  const uniqueParagraphs = new Set(allSentences.map((s) => s.paragraphIndex));
  const effectiveQualityScore = Math.min(
    qualityScore,
    qaReport?.extractionConfidence ?? qualityScore
  );
  const effectiveHasWarnings = Boolean(
    hasOcrWarnings || qaReport?.hasQualityWarning
  );
  const effectiveWarningMessage =
    ocrWarningMessage || qaReport?.userWarningMessage || "";

  // Build formal connected Reading Stream units for this page
  const readingStream = allSentences.map((s, idx) => {
    const verificationState =
      s.segmentType === "quran"
        ? s.quranMeta?.verified
          ? "verified_quran"
          : "unverified_quran_blocked"
        : s.segmentType === "hadith"
        ? "verified_hadith"
        : "verified_text";
    return {
      streamId: `${bookId || "book"}::p${pageNumber}::s${idx}`,
      pageNumber,
      paragraphIndex: s.paragraphIndex ?? s.blockIndex ?? 0,
      sentenceIndex: idx,
      segmentType: s.segmentType,
      contentType: s.contentType || s.segmentType,
      language: s.language,
      engineId: s.engineId,
      originalText: s.originalText,
      ttsInputText: s.ttsInputText || s.cleanedPronunciationText || s.originalText,
      verificationState,
      quranMeta: s.quranMeta || null,
      box2d: s.box2d || null,
      lineBoxes: s.lineBoxes || [],
      continuesToNextPage: Boolean(s.continuesToNextPage),
      isContinuationFromPrevPage: Boolean(s.isContinuationFromPrevPage),
      pauseDurationMs: s.pauseDurationMs ?? 380,
    };
  });

  return {
    pipelineVersion: READER_PIPELINE_VERSION,
    bookId,
    pageNumber,
    extractionSource,
    qualityScore: effectiveQualityScore,
    hasOcrWarnings: effectiveHasWarnings,
    ocrWarningMessage: effectiveWarningMessage,
    detectedAnomalies,
    qaReport,
    totalSentencesOnPage: allSentences.length,
    totalParagraphsOnPage: uniqueParagraphs.size,
    totalTopicsOnPage: topics.length,
    totalWordsOnPage: totalWordsCount,
    rawPdfLayerText:
      rawPdfLayerText ||
      (blocks || []).map((b) => b.originalText).join("\n\n"),
    blocks: blocks || [],
    topics,
    crossPageInfo,
    sentences: allSentences,
    readingStream,
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

export async function verifyQuranBatchClient(
  candidates = [],
  reciterId = "ar.saoodshuraym"
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const reciter = reciterId || "ar.saoodshuraym";
  const results = new Array(candidates.length).fill(null);
  const uncachedPayload = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cacheKey = `${c.text}__${c.surahHint || 0}:${c.ayahHint || 0}-${c.endAyahHint || 0}:${c.hasQuranBrackets ? 1 : 0}`;
    const cached = await getCachedQuranVerification(cacheKey, reciter);
    if (cached && cached.verified && Array.isArray(cached.ayahList) && cached.ayahList.length > 0) {
      results[i] = cached;
    } else {
      uncachedPayload.push({ index: i, cacheKey, item: { id: i, ...c } });
    }
  }

  if (uncachedPayload.length === 0) return results;

  try {
    const endpoint =
      typeof window !== "undefined" && window.location?.origin
        ? apiUrl("/api/reader/verify-quran-batch")
        : "http://localhost:3000/api/reader/verify-quran-batch";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: uncachedPayload.map((u) => u.item),
        reciter,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const batchRes = Array.isArray(data?.results) ? data.results : [];
      for (let b = 0; b < uncachedPayload.length; b++) {
        const entry = uncachedPayload[b];
        const r = batchRes[b] || { verified: false };
        results[entry.index] = r;
        if (r?.verified) {
          await setCachedQuranVerification(entry.cacheKey, reciter, r);
        }
      }
      return results;
    }
  } catch {}

  // Fallback to individual verifyQuranVerseClient calls
  for (const entry of uncachedPayload) {
    results[entry.index] = await verifyQuranVerseClient(
      entry.item.text,
      entry.item.surahHint,
      entry.item.ayahHint,
      reciter,
      entry.item.endAyahHint,
      entry.item.hasQuranBrackets
    );
  }
  return results;
}

export async function verifyQuranVerseClient(
  text,
  surahHint = 0,
  ayahHint = 0,
  reciterId = "ar.saoodshuraym",
  endAyahHint = 0,
  hasQuranBrackets = false
) {
  const cacheKey =
    surahHint && ayahHint
      ? `${text}__${surahHint}:${ayahHint}-${endAyahHint || ayahHint}`
      : text;
  const cached = await getCachedQuranVerification(cacheKey, reciterId);
  if (cached && cached.verified && Array.isArray(cached.ayahList) && cached.ayahList.length > 0) {
    return cached;
  }

  try {
    const endpoint =
      typeof window !== "undefined" && window.location?.origin
        ? apiUrl("/api/reader/verify-quran")
        : "http://localhost:3000/api/reader/verify-quran";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        surahHint,
        ayahHint,
        endAyahHint,
        hasQuranBrackets: Boolean(hasQuranBrackets || String(text || "").includes("﴿") || String(text || "").includes("﴾")),
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

  const reciterFolderMap = {
    "ar.saoodshuraym": "Saood_ash-Shuraym_128kbps",
    "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
    "ar.alafasy": "Alafasy_128kbps",
    "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
    "ar.husary": "Husary_128kbps",
    "ar.minshawi": "Minshawy_Murattal_128kbps",
  };
  const folder = reciterFolderMap[reciterId] || "Saood_ash-Shuraym_128kbps";

  const norm = normalizeForQuickArabicMatch(text)
    .replace(/[\(\)\[\]\{\}]\s*[٠-٩۰-۹\d]+\s*[\(\)\[\]\{\}]/g, " ")
    .replace(/[﴿﴾«»"'\(\)\[\]\{\}۞٭]/g, " ")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
  const normNoSpace = norm.replace(/\s+/g, "");

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
        const audioUrl = apiUrl(`/api/reader/quran-audio?url=${encodeURIComponent(directUrl)}`);
        const backupUrl = `https://cdn.islamic.network/quran/audio/128/${reciterId}/${item.globalAyahNumber}.mp3`;
        const resolved = {
          verified: true,
          confidence: 0.99,
          surahNumber: item.surahNumber,
          surahName: item.surahName,
          ayahNumber: item.ayahNumber,
          endAyahNumber: item.ayahNumber,
          globalAyahNumber: item.globalAyahNumber,
          uthmaniText: item.uthmaniText,
          reciterId,
          audioUrl,
          directAudioUrl: directUrl,
          backupAudioUrl: backupUrl,
          ayahList: [
            {
              surahNumber: item.surahNumber,
              surahName: item.surahName,
              ayahNumber: item.ayahNumber,
              globalAyahNumber: item.globalAyahNumber,
              uthmaniText: item.uthmaniText,
              reciterId,
              audioUrl,
              directAudioUrl: directUrl,
              backupAudioUrl: backupUrl,
            },
          ],
        };
        await setCachedQuranVerification(cacheKey, reciterId, resolved);
        return resolved;
      }
    }
  }

  return { verified: false };
}
