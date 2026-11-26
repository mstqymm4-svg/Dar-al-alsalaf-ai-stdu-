/**
 * DAR AL TAWHID — High-Precision Urdu & Arabic Linguistic Processor & 10-Point Extraction QA Layer
 *
 * Implements:
 * 1. Strict 4-Stage Text Provenance Separation:
 *    - `originalExtractedText`: Raw text extracted from PDF text layer / raw OCR before normalization.
 *    - `ocrCorrectedText`: Deterministically decoded book text (Nastaliq GSUB table / ligature rejoining / verified OCR) without speculative rewriting.
 *    - `linguisticProcessedText`: Linguistically analyzed text (Urdu compound words, Izafat, Atf; Arabic contextual vocalization preserving author tashkeel).
 *    - `ttsInputText`: Final phonetically prepared text for TTS neural engines (honorific expansions, phonetic disambiguation, footnote marker stripping).
 *
 * 2. Urdu Linguistic & Phonological Accuracy Engine:
 *    - Compound word morphology (مركبات أردية: دار، مند، خانہ، گاہ، انگیز، پسند، پرست، شناس، نامہ، زدہ).
 *    - Persian/Arabic Izafat (اضافت: ِ / ۂ / ئے) and Atf (عطف: و between paired nouns).
 *    - Detection & phonetic normalization of words commonly mispronounced by Urdu TTS engines.
 *
 * 3. Arabic Linguistic & Contextual Vocalization Engine:
 *    - 100% preservation of existing author Tashkeel (الحفاظ على التشكيل الموجود).
 *    - Context-aware grammatical case vocalization (حروف الجر، إنّ وأخواتها، أفعال القول والرواية) on unvocalized words.
 *    - Scholarly, Hadith, and theological lexicon vocalization for TTS without altering display text.
 *
 * 4. 10-Point Extraction Quality Assurance (QA) Layer:
 *    - Audits text integrity, garbled words, missing letters, unnatural repetitions, word-order anomalies,
 *      RTL logical direction, extraction confidence (0-100), OCR comparison trigger, TTS distortion blocker,
 *      and clear user warning generation.
 */

import { sanitizeIntraSentenceSyntacticPauses } from "./linguisticLinker";

// ─── 1. Urdu Compound Words & Phonological Normalization Rules ────────────────

/**
 * Common Nastaliq glued Urdu words (verb+auxiliary or postposition+clitic/noun) that occasionally
 * survive raw PDF extraction and must be cleanly spaced for accurate Urdu TTS pronunciation.
 */
const URDU_GLUED_WORD_REPAIRS = [
  { pattern: /(^|\s)کیاجاتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کیا جاتا ہے" },
  { pattern: /(^|\s)دیاجاتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1دیا جاتا ہے" },
  { pattern: /(^|\s)لیاجاتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1لیا جاتا ہے" },
  { pattern: /(^|\s)ہوجاتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ہو جاتا ہے" },
  { pattern: /(^|\s)ہوسکتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ہو سکتا ہے" },
  { pattern: /(^|\s)کرسکتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کر سکتا ہے" },
  { pattern: /(^|\s)کردیتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کر دیتا ہے" },
  { pattern: /(^|\s)کرلیتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کر لیتا ہے" },
  { pattern: /(^|\s)کرتارہتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کرتا رہتا ہے" },
  { pattern: /(^|\s)ہوتارہتاہے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ہوتا رہتا ہے" },
  { pattern: /(^|\s)کےلیے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے لیے" },
  { pattern: /(^|\s)کےلئے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے لیے" },
  { pattern: /(^|\s)اسلیے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اس لیے" },
  { pattern: /(^|\s)اسلئے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اس لیے" },
  { pattern: /(^|\s)کےساتھ(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے ساتھ" },
  { pattern: /(^|\s)کےبعد(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے بعد" },
  { pattern: /(^|\s)کےبغیر(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے بغیر" },
  { pattern: /(^|\s)کےپاس(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے پاس" },
  { pattern: /(^|\s)کےبارے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے بارے" },
  { pattern: /(^|\s)کےذریعے(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے ذریعے" },
  { pattern: /(^|\s)کےمطابق(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے مطابق" },
  { pattern: /(^|\s)کےخلاف(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے خلاف" },
  { pattern: /(^|\s)کےتحت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے تحت" },
  { pattern: /(^|\s)کےدرمیان(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کے درمیان" },
  { pattern: /(^|\s)(کو|سے|میں|پر|نے|تو|یہ|وہ)بھی(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 بھی" },
];

function canonicalizeShaddaOrderLocal(str) {
  return String(str || "")
    .replace(/\u0640/g, "")
    .replace(/\s+([\u064B-\u065F\u0670]+)/g, "$1")
    .replace(/([\u064B-\u0650\u0652\u0670]+)\u0651/g, "\u0651$1")
    .replace(/([\u064B-\u0652\u0670])\1+/g, "$1");
}

/**
 * Urdu compound suffixes (لاحقے) that form compound words (مركبات).
 * If glued tightly without boundary or separated awkwardly, we normalize them to clean Urdu orthography
 * so the Urdu neural TTS pronounces both root and suffix naturally.
 */
const URDU_COMPOUND_SUFFIX_RULES = [
  // -دار compounds
  { pattern: /(^|\s)(ایمان|ذمہ|دیانت|امانت|وفا|جان|مال|شام|داغ|حصہ|عہدے|دکان|زمین|قرض|علم|عمل|سمجھ)دار(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 دار" },
  // -مند compounds
  { pattern: /(^|\s)(عقل|درد|فائدہ|حاجت|ضرورت|دولت|سعادت|غیرت|ہنر|ارزو|آرزو|خرد)مند(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 مند" },
  // -گاہ compounds
  { pattern: /(^|\s)(عبادت|درس|آرام|بندر|خواب|پناہ|نماز|عید|قربان|گزر|شکار|نظر)گاہ(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 گاہ" },
  // -خانہ compounds
  { pattern: /(^|\s)(عبادت|کتب|شفا|قید|ڈاک|باورچی|دوا|کار|مهمان|مہمان|چھاپہ)خانہ(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 خانہ" },
  // -انگیز / -آمیز / -بخش / -شناس / -پرست / -پسند
  { pattern: /(^|\s)(حیرت|درد|شر|فتنہ|ولولہ|جذبہ|شوق|عبرت)انگیز(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 انگیز" },
  { pattern: /(^|\s)(حکمت|مسرت|نصیحت|محبت|نفرت|طنز)آمیز(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 آمیز" },
  { pattern: /(^|\s)(فرحت|سکون|اطمینان|تسکین|شفا|روح|حیات)بخش(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 بخش" },
  { pattern: /(^|\s)(حق|قدر|مزاج|نبض|فرض|موقع)شناس(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 شناس" },
  { pattern: /(^|\s)(بت|خود|دنیا|مفاد|نفس|حق)پرست(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 پرست" },
  { pattern: /(^|\s)(امن|انصاف|حق|ترقی|سہولت|عافیت)پسند(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 پسند" },
  // -زدہ / -نامہ
  { pattern: /(^|\s)(خوف|غم|حیرت|مصیبت|آفت|دہشت|رنج)زدہ(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 زدہ" },
  { pattern: /(^|\s)(اقرار|معاہدہ|وصیت|اجازت|سفارش|سفر|شہادت)نامہ(?=\s|$|[۔.،؛؟!:])/g, replace: "$1$2 نامہ" },
];

/**
 * Paired Urdu Atf (`و`) compounds that frequently appear in Islamic texts and must have a clean space
 * around `و` so TTS reads `o` (conjunction) rather than fusing them into an unknown word.
 */
const URDU_ATF_COMPOUND_RULES = [
  { pattern: /(^|\s)قرآن\s*وسنت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1قرآن و سنت" },
  { pattern: /(^|\s)کتاب\s*وسنت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کتاب و سنت" },
  { pattern: /(^|\s)ایمان\s*واخلاص(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ایمان و اخلاص" },
  { pattern: /(^|\s)ایمان\s*وعمل(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ایمان و عمل" },
  { pattern: /(^|\s)علم\s*وعمل(?=\s|$|[۔.،؛؟!:])/g, replace: "$1علم و عمل" },
  { pattern: /(^|\s)قول\s*وعمل(?=\s|$|[۔.،؛؟!:])/g, replace: "$1قول و عمل" },
  { pattern: /(^|\s)قول\s*وفعل(?=\s|$|[۔.،؛؟!:])/g, replace: "$1قول و فعل" },
  { pattern: /(^|\s)اجر\s*وثواب(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اجر و ثواب" },
  { pattern: /(^|\s)دنیا\s*وآخرت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1دنیا و آخرت" },
  { pattern: /(^|\s)اطاعت\s*وعبادت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اطاعت و عبادت" },
  { pattern: /(^|\s)توحید\s*وسنت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1توحید و سنت" },
  { pattern: /(^|\s)شرک\s*وبدعت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1شرک و بدعت" },
  { pattern: /(^|\s)حق\s*وباطل(?=\s|$|[۔.،؛؟!:])/g, replace: "$1حق و باطل" },
  { pattern: /(^|\s)خیر\s*وشر(?=\s|$|[۔.،؛؟!:])/g, replace: "$1خیر و شر" },
  { pattern: /(^|\s)نفع\s*ونقصان(?=\s|$|[۔.،؛؟!:])/g, replace: "$1نفع و نقصان" },
  { pattern: /(^|\s)شب\s*وروز(?=\s|$|[۔.،؛؟!:])/g, replace: "$1شب و روز" },
  { pattern: /(^|\s)لیل\s*ونہار(?=\s|$|[۔.،؛؟!:])/g, replace: "$1لیل و نہار" },
  { pattern: /(^|\s)خوف\s*ورجا(?=\s|$|[۔.،؛؟!:])/g, replace: "$1خوف و رجا" },
  { pattern: /(^|\s)شکوک\s*وشبہات(?=\s|$|[۔.،؛؟!:])/g, replace: "$1شکوک و شبہات" },
  { pattern: /(^|\s)ہم\s*وغم(?=\s|$|[۔.،؛؟!:])/g, replace: "$1ہم و غم" },
];

/**
 * Common Urdu Izafat constructions in Islamic books where adding the explicit Izafat kasra (`ِ`)
 * or canonical Hamza-Heh (`ۂ`) prevents TTS from dropping the relational vowel.
 */
const URDU_IZAFAT_RULES = [
  { pattern: /(^|\s)اہل[\u0650]?\s+سنت(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اہلِ سنت" },
  { pattern: /(^|\s)اہل[\u0650]?\s+ایمان(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اہلِ ایمان" },
  { pattern: /(^|\s)اہل[\u0650]?\s+علم(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اہلِ علم" },
  { pattern: /(^|\s)اہل[\u0650]?\s+توحید(?=\s|$|[۔.،؛؟!:])/g, replace: "$1اہلِ توحید" },
  { pattern: /(^|\s)رسول[\u0650]?\s+اکرم(?=\s|$|[۔.،؛؟!:])/g, replace: "$1رسولِ اکرم" },
  { pattern: /(^|\s)رسول[\u0650]?\s+مقبول(?=\s|$|[۔.،؛؟!:])/g, replace: "$1رسولِ مقبول" },
  { pattern: /(^|\s)نبی[\u0650]?\s+کریم(?=\s|$|[۔.،؛؟!:])/g, replace: "$1نبیِ کریم" },
  { pattern: /(^|\s)کتاب[\u0650]?\s+توحید(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کتابِ توحید" },
  { pattern: /(^|\s)کلمہ[\u0654]?\s+توحید(?=\s|$|[۔.،؛؟!:])/g, replace: "$1کلمۂ توحید" },
  { pattern: /(^|\s)نقطہ[\u0654]?\s+نظر(?=\s|$|[۔.،؛؟!:])/g, replace: "$1نقطۂ نظر" },
];

/**
 * Words that Urdu TTS engines frequently mispronounce if left with non-standard codepoints
 * or ambiguous orthography.
 */
const URDU_TTS_PRONUNCIATION_FIXES = [
  { pattern: /ﷺ/g, tts: " صلی اللہ علیہ وسلم ", flag: "honorific_saw" },
  { pattern: /ﷻ/g, tts: " جل جلالہ ", flag: "honorific_jj" },
  { pattern: /(^|\s)ان\s*شاء\s*اللہ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1ان شاء اللہ", flag: "inshaallah" },
  { pattern: /(^|\s)ما\s*شاء\s*اللہ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1ما شاء اللہ", flag: "mashaallah" },
  { pattern: /(^|\s)سبحٰن(?=\s|$|[۔.،؛؟!:])/g, tts: "$1سبحان", flag: "khari_zabar_subhan" },
  { pattern: /(^|\s)رحمٰن(?=\s|$|[۔.،؛؟!:])/g, tts: "$1رحمان", flag: "khari_zabar_rahman" },
  { pattern: /(^|\s)اسمٰعیل(?=\s|$|[۔.،؛؟!:])/g, tts: "$1اسماعیل", flag: "khari_zabar_ismail" },
  { pattern: /(^|\s)ابرٰہیم(?=\s|$|[۔.،؛؟!:])/g, tts: "$1ابراہیم", flag: "khari_zabar_ibrahim" },
  { pattern: /(^|\s)اسحٰق(?=\s|$|[۔.،؛؟!:])/g, tts: "$1اسحاق", flag: "khari_zabar_ishaq" },
  { pattern: /(^|\s)لہذا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1لہٰذا", flag: "lihadha" },
  { pattern: /(^|\s)تعالی(?=\s|$|[۔.،؛؟!:])/g, tts: "$1تعالیٰ", flag: "taala" },
  { pattern: /(^|\s)زکوٰۃ|زکوۃ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1زکات", flag: "zakat_phonetic" },
  { pattern: /(^|\s)صلوٰۃ|صلوۃ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1صلات", flag: "salat_phonetic" },
  { pattern: /(^|\s)حیوٰۃ|حیوۃ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1حیات", flag: "hayat_phonetic" },
  { pattern: /(^|\s)مشکوٰۃ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1مشکات", flag: "mishkat_phonetic" },
  { pattern: /(^|\s)توراۃ|تورٰۃ(?=\s|$|[۔.،؛؟!:])/g, tts: "$1تورات", flag: "tawrat_phonetic" },
  { pattern: /(^|\s)مثلا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1مثلاً", flag: "tanwin_masalan" },
  { pattern: /(^|\s)عموما(?=\s|$|[۔.،؛؟!:])/g, tts: "$1عموماً", flag: "tanwin_umuman" },
  { pattern: /(^|\s)خصوصا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1خصوصاً", flag: "tanwin_khususan" },
  { pattern: /(^|\s)فورا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1فوراً", flag: "tanwin_fauran" },
  { pattern: /(^|\s)تقریبا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1تقریباً", flag: "tanwin_taqriban" },
  { pattern: /(^|\s)یقینا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1یقیناً", flag: "tanwin_yaqinan" },
  { pattern: /(^|\s)قطعا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1قطعاً", flag: "tanwin_qatan" },
  { pattern: /(^|\s)اصلا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1اصلاً", flag: "tanwin_aslan" },
  { pattern: /(^|\s)عقلا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1عقلاً", flag: "tanwin_aqlan" },
  { pattern: /(^|\s)نقلا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1نقلاً", flag: "tanwin_naqlan" },
  { pattern: /(^|\s)شرعا(?=\s|$|[۔.،؛؟!:])/g, tts: "$1شرعاً", flag: "tanwin_sharan" },
];

/**
 * Process Urdu text through:
 * 1. Linguistic Compound & Izafat Analysis (`linguisticProcessedText`)
 * 2. Phonetic TTS Disambiguation (`ttsInputText`)
 */
export function processUrduLinguisticsAndPhonetics(ocrCorrectedText) {
  if (!ocrCorrectedText) {
    return {
      linguisticProcessedText: "",
      ttsInputText: "",
      detectedCompounds: [],
      pronunciationFlags: [],
    };
  }

  let linguistic = canonicalizeShaddaOrderLocal(String(ocrCorrectedText))
    // Canonicalize Urdu letters (ك -> ک, ي/ى -> ی, ه -> ہ)
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u0647/g, "\u06C1")
    // Normalize Urdu Teh Marbuta (ة -> ہ in Urdu loanwords like مسئلة -> مسئلہ, فائدة -> فائدہ, عقیدة -> عقیدہ)
    .replace(/(مسئل|فائد|قاعد|عقید|دائر|معامل|مرتب|طریق|وسوس|حاشي|حاشی|مقدم|نتیج|ذریع)\u0629/g, "$1ہ");

  const detectedCompounds = [];

  for (const rule of URDU_GLUED_WORD_REPAIRS) {
    if (rule.pattern.test(linguistic)) {
      rule.pattern.lastIndex = 0;
      linguistic = linguistic.replace(rule.pattern, rule.replace);
    }
  }

  for (const rule of URDU_COMPOUND_SUFFIX_RULES) {
    if (rule.pattern.test(linguistic)) {
      rule.pattern.lastIndex = 0;
      const matches = linguistic.match(rule.pattern) || [];
      matches.forEach((m) => detectedCompounds.push(m.trim()));
      linguistic = linguistic.replace(rule.pattern, rule.replace);
    }
  }

  for (const rule of URDU_ATF_COMPOUND_RULES) {
    if (rule.pattern.test(linguistic)) {
      rule.pattern.lastIndex = 0;
      const matches = linguistic.match(rule.pattern) || [];
      matches.forEach((m) => detectedCompounds.push(m.trim()));
      linguistic = linguistic.replace(rule.pattern, rule.replace);
    }
  }

  for (const rule of URDU_IZAFAT_RULES) {
    if (rule.pattern.test(linguistic)) {
      rule.pattern.lastIndex = 0;
      const matches = linguistic.match(rule.pattern) || [];
      matches.forEach((m) => detectedCompounds.push(m.trim()));
      linguistic = linguistic.replace(rule.pattern, rule.replace);
    }
  }

  // Ensure clean punctuation spacing
  linguistic = linguistic
    .replace(/\s+([۔،؛؟!:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Build TTS Input Text from Linguistic Processed Text
  let tts = linguistic
    // Strip isolated footnote markers like (1), (١), )١(, [١]
    .replace(/\[\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\]/g, " ")
    .replace(/\(\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\)/g, " ")
    .replace(/\)\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\(/g, " ")
    // Strip visual decorative brackets/guillemets so TTS doesn't pause unnaturally or read symbol names
    .replace(/[«»"“”﴿﴾~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ");

  const pronunciationFlags = [];
  for (const fix of URDU_TTS_PRONUNCIATION_FIXES) {
    if (fix.pattern.test(tts)) {
      fix.pattern.lastIndex = 0;
      pronunciationFlags.push(fix.flag);
      tts = tts.replace(fix.pattern, fix.tts);
    }
  }

  // Strip any misplaced PDF commas sitting inside connected Urdu syntactic constructions!
  const pauseSanitized = sanitizeIntraSentenceSyntacticPauses(tts, "ur");
  tts = (pauseSanitized.text || tts)
    .replace(/\s+([۔،؛؟!:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    linguisticProcessedText: linguistic,
    ttsInputText: tts,
    detectedCompounds: [...new Set(detectedCompounds)],
    pronunciationFlags: [...new Set(pronunciationFlags)],
  };
}

// ─── 2. Arabic Linguistic & Contextual Vocalization Processor ─────────────────

/**
 * Unambiguous Classical Arabic scholarly & Hadith vocabulary vocalization map.
 * Applied ONLY when the word in the text has NO existing Tashkeel, preserving 100% of author diacritics.
 */
const ARABIC_UNVOCALIZED_LEXICON = new Map([
  ["الإخلاص", "الإِخْلَاص"],
  ["والإخلاص", "وَالإِخْلَاص"],
  ["التوحيد", "التَّوْحِيد"],
  ["والتوحيد", "وَالتَّوْحِيد"],
  ["الشرك", "الشِّرْك"],
  ["والشرك", "وَالشِّرْك"],
  ["الرياء", "الرِّيَاء"],
  ["والرياء", "وَالرِّيَاء"],
  ["النية", "النِّيَّة"],
  ["النيات", "النِّيَّات"],
  ["بالنيات", "بِالنِّيَّاتِ"],
  ["العبادة", "العِبَادَة"],
  ["العبادات", "العِبَادَات"],
  ["الصلاة", "الصَّلَاة"],
  ["الزكاة", "الزَّكَاة"],
  ["الصيام", "الصِّيَام"],
  ["الحج", "الحَجّ"],
  ["الإيمان", "الإِيمَان"],
  ["الإحسان", "الإِحْسَان"],
  ["التقوى", "التَّقْوَى"],
  ["اليقين", "اليَقِين"],
  ["التوكل", "التَّوَكُّل"],
  ["الوسوسة", "الوَسْوَسَة"],
  ["الوسواس", "الوَسْوَاس"],
  ["الشيطان", "الشَّيْطَان"],
  ["الشياطين", "الشَّيَاطِين"],
  ["الجنة", "الجَنَّة"],
  ["النار", "النَّار"],
  ["الدنيا", "الدُّنْيَا"],
  ["الآخرة", "الآخِرَة"],
  ["القرآن", "القُرْآن"],
  ["السنة", "السُّنَّة"],
  ["الحديث", "الحَدِيث"],
  ["الأحاديث", "الأَحَادِيث"],
  ["النبي", "النَّبِيّ"],
  ["الرسول", "الرَّسُول"],
  ["المؤمن", "المُؤْمِن"],
  ["المؤمنين", "المُؤْمِنِينَ"],
  ["المسلم", "المُسْلِم"],
  ["المسلمين", "المُسْلِمِينَ"],
  ["العلماء", "العُلَمَاء"],
  ["الصحابة", "الصَّحَابَة"],
  ["البخاري", "البُخَارِيّ"],
  ["مسلم", "مُسْلِم"],
  ["الترمذي", "التِّرْمِذِيّ"],
  ["أحمد", "أَحْمَد"],
  ["هريرة", "هُرَيْرَةَ"],
  ["عائشة", "عَائِشَةَ"],
  ["عباس", "عَبَّاسٍ"],
  ["سبحانه", "سُبْحَانَهُ"],
  ["وتعالى", "وَتَعَالَى"],
  ["تعالى", "تَعَالَى"],
  ["اللهم", "اللَّهُمَّ"],
  ["إنما", "إِنَّمَا"],
  ["الأعمال", "الْأَعْمَالُ"],
  ["النفاق", "النِّفَاق"],
  ["البدعة", "الْبِدْعَة"],
  ["العقيدة", "الْعَقِيدَة"],
  ["القلب", "الْقَلْب"],
  ["النفس", "النَّفْس"],
  ["الرسالة", "الرِّسَالَة"],
  ["الهجرة", "الْهِجْرَة"],
  ["العلم", "الْعِلْم"],
  ["العمل", "الْعَمَل"],
  ["الصدق", "الصِّدْق"],
  ["الكذب", "الْكَذِب"],
  ["الذكر", "الذِّكْر"],
  ["الدعاء", "الدُّعَاء"],
  ["الاستغفار", "الِاسْتِغْفَار"],
  ["التوبة", "التَّوْبَة"],
  ["النسائي", "النَّسَائِيّ"],
  ["داود", "دَاوُدَ"],
  ["أنس", "أَنَسٍ"],
  ["جابر", "جَابِرٍ"],
  ["عمر", "عُمَرَ"],
  ["عثمان", "عُثْمَانَ"],
  ["حدثنا", "حَدَّثَنَا"],
  ["أخبرنا", "أَخْبَرَنَا"],
  ["فقال", "فَقَالَ"],
  ["قال", "قَالَ"],
  ["يقول", "يَقُولُ"],
  ["روى", "رَوَى"],
]);

const ARABIC_PREPOSITIONS = new Set([
  "من", "إلى", "عن", "على", "في", "عند", "بين", "مع", "دون", "قبل", "بعد", "تحت", "فوق",
]);

const ARABIC_INNA_SISTERS = new Set([
  "إن", "أن", "لعل", "لكن", "كأن", "ليت",
]);

const ARABIC_SPEECH_VERBS = new Set([
  "قال", "قالت", "يقول", "روى", "أخرج", "رواه", "أخرجه", "حدثنا", "أخبرنا",
]);

function hasArabicTashkeel(word) {
  return /[\u064B-\u0652\u0670]/.test(word);
}

/**
 * Process Arabic text through:
 * 1. Canonical Arabic codepoint normalization (`ك، ي، ه، ة`) while strictly preserving existing Tashkeel.
 * 2. Context-aware grammatical & lexical vocalization on unvocalized words (`linguisticProcessedText`).
 * 3. Honorific expansion & phonetic preparation (`ttsInputText`).
 */
export function processArabicLinguisticsAndVocalization(ocrCorrectedText, segmentType = "arabic_quote") {
  if (!ocrCorrectedText) {
    return {
      linguisticProcessedText: "",
      ttsInputText: "",
      vocalizationAppliedCount: 0,
      preservedTashkeelCount: 0,
    };
  }

  // Canonicalize Arabic codepoints & Shadda order without dropping any author diacritics
  let canonical = canonicalizeShaddaOrderLocal(String(ocrCorrectedText))
    .replace(/\u06C1/g, "\u0647") // ہ -> ه
    .replace(/\u06A9/g, "\u0643") // ک -> ك
    .replace(/\u06CC/g, "\u064A") // ی -> ي
    .replace(/\u06D2/g, "\u0649") // ے -> ى
    .replace(/[\u06C2\u06C3]/g, "\u0629") // ۂ/ۃ -> ة
    .replace(/\u06D4/g, "."); // ۔ -> .

  // For verified Quranic verses, preserve the exact Uthmani text untouched
  if (segmentType === "quran") {
    const cleanQuranTts = canonical
      .replace(/^[﴿\s]+|[﴾\s]+$/g, "")
      .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/g, "")
      .trim();
    return {
      linguisticProcessedText: canonical,
      ttsInputText: cleanQuranTts,
      vocalizationAppliedCount: 0,
      preservedTashkeelCount: (canonical.match(/[\u064B-\u0652\u0670]/g) || []).length,
    };
  }

  const preservedTashkeelCount = (canonical.match(/[\u064B-\u0652\u0670]/g) || []).length;
  let vocalizationAppliedCount = 0;

  // Apply formulaic phrase-level vocalization where words are unvocalized
  let linguistic = canonical
    .replace(/(^|\s)قال\s+رسول\s+الله(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " قَالَ رَسُولُ اللَّهِ";
    })
    .replace(/(^|\s)قال\s+النبي(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 2;
      return " قَالَ النَّبِيُّ";
    })
    .replace(/(^|\s)صلى\s+الله\s+عليه\s+وسلم(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 4;
      return " صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ";
    })
    .replace(/(^|\s)رضي\s+الله\s+عنه(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " رَضِيَ اللَّهُ عَنْهُ";
    })
    .replace(/(^|\s)رضي\s+الله\s+عنها(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " رَضِيَ اللَّهُ عَنْهَا";
    })
    .replace(/(^|\s)رضي\s+الله\s+عنهم(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " رَضِيَ اللَّهُ عَنْهُمْ";
    })
    .replace(/(^|\s)رضي\s+الله\s+عنهما(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " رَضِيَ اللَّهُ عَنْهُمَا";
    })
    .replace(/(^|\s)رحمه\s+الله(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 2;
      return " رَحِمَهُ اللَّهُ";
    })
    .replace(/(^|\s)عز\s+وجل(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 2;
      return " عَزَّ وَجَلَّ";
    })
    .replace(/(^|\s)عن\s+أبي\s+هريرة(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " عَنْ أَبِي هُرَيْرَةَ";
    })
    .replace(/(^|\s)رواه\s+البخاري\s+ومسلم(?=\s|$|[.،؛؟!:])/g, () => {
      vocalizationAppliedCount += 3;
      return " رَوَاهُ الْبُخَارِيُّ وَمُسْلِمٌ";
    });

  // Token-by-token contextual grammatical case & lexicon vocalization (strictly skipping words that already have Tashkeel!)
  const tokens = linguistic.split(/\s+/).filter(Boolean);
  const vocalizedTokens = tokens.map((tok, idx) => {
    const match = tok.match(/^([«"“\(\[]*)([\u0621-\u065F\u0670-\u06D3]+)([»"”\)\].،؛؟!:]*)$/);
    if (!match) return tok;
    const [, prefixPunct, coreWord, suffixPunct] = match;

    // Rule 1: NEVER overwrite existing author Tashkeel
    if (hasArabicTashkeel(coreWord)) {
      return tok;
    }

    const prevRaw = idx > 0 ? tokens[idx - 1].replace(/[«"“\(\[»"”\)\].،؛؟!:[\u064B-\u0652\u0670]/g, "") : "";
    let vocalizedCore = ARABIC_UNVOCALIZED_LEXICON.get(coreWord) || coreWord;

    if (vocalizedCore !== coreWord) {
      vocalizationAppliedCount++;
    }

    // Rule 2: Contextual Grammatical Case (إعراب السياق) on definite nouns or "الله"
    if (coreWord === "الله") {
      if (ARABIC_PREPOSITIONS.has(prevRaw) || prevRaw === "رسول" || prevRaw === "كتاب" || prevRaw === "سبيل" || prevRaw === "باسم" || prevRaw === "عبد") {
        vocalizedCore = "اللَّهِ";
        vocalizationAppliedCount++;
      } else if (ARABIC_INNA_SISTERS.has(prevRaw)) {
        vocalizedCore = "اللَّهَ";
        vocalizationAppliedCount++;
      } else if (ARABIC_SPEECH_VERBS.has(prevRaw)) {
        vocalizedCore = "اللَّهُ";
        vocalizationAppliedCount++;
      } else {
        vocalizedCore = "اللَّهِ";
      }
    } else if (
      ARABIC_PREPOSITIONS.has(prevRaw) &&
      /^ال[\u0621-\u064A]{2,}$/.test(coreWord) &&
      !/[يىواة]$/.test(coreWord) &&
      !/[\u064B-\u0652]$/.test(vocalizedCore)
    ) {
      // Genitive kasra after preposition on sound definite noun
      vocalizedCore = `${vocalizedCore}\u0650`;
      vocalizationAppliedCount++;
    } else if (
      ARABIC_INNA_SISTERS.has(prevRaw) &&
      /^ال[\u0621-\u064A]{2,}$/.test(coreWord) &&
      !/[يىوا]$/.test(coreWord) &&
      !/[\u064B-\u0652]$/.test(vocalizedCore)
    ) {
      // Accusative fatha after Inna & sisters on sound definite noun
      vocalizedCore = `${vocalizedCore}\u064E`;
      vocalizationAppliedCount++;
    }

    return `${prefixPunct}${vocalizedCore}${suffixPunct}`;
  });

  linguistic = vocalizedTokens.join(" ").replace(/\s+/g, " ").trim();

  // Build final TTS input text for Arabic neural engine
  let tts = linguistic
    .replace(/ﷺ/g, " صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ ")
    .replace(/ﷻ/g, " جَلَّ جَلَالُهُ ")
    // Strip footnote indices like (١), [1], )١( so TTS never speaks footnote numbers inside a Hadith or sentence
    .replace(/\[\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\]/g, " ")
    .replace(/\(\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\)/g, " ")
    .replace(/\)\s*[\u064B-\u065F\u0670\u06D6-\u06ED\s]*[\d٠-٩۰-۹]+\s*\(/g, " ")
    // Strip decorative guillemets/brackets
    .replace(/[«»"“”﴿﴾~^|¦§¨©ª¬®°±²³´µ¶·¸¹º¼½¾¿×÷]+/g, " ")
  // Strip any misplaced PDF commas sitting inside connected Arabic syntactic constructions!
  const pauseSanitized = sanitizeIntraSentenceSyntacticPauses(tts, "ar");
  tts = (pauseSanitized.text || tts)
    .replace(/\s+([.،؛؟!:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    linguisticProcessedText: linguistic,
    ttsInputText: tts,
    vocalizationAppliedCount,
    preservedTashkeelCount,
  };
}

// ─── 3. 10-Point Text Extraction Quality Assurance (QA) Engine ────────────────

const VALID_SINGLE_LETTER_TOKENS = new Set(["و", "ب", "ل", "ك", "ف", "أ"]);
const URDU_NON_INITIAL_POSTPOSITIONS = new Set(["کا", "کے", "کی", "کو", "سے", "نے", "پر"]);

/**
 * Audit a single sentence across the 10 Quality Assurance criteria.
 */
export function auditSentenceExtractionQuality(sentence) {
  const text = String(sentence?.ocrCorrectedText || sentence?.originalText || "").trim();
  const lang = sentence?.language === "ar" ? "ar" : "ur";

  if (!text) {
    return {
      textIntegrityPassed: false,
      extractionConfidence: 0,
      confidenceLevel: "critical",
      garbledWords: [],
      missingLettersWords: [],
      unnaturalRepetitions: [],
      wordOrderAnomalies: [],
      rtlDirectionValid: true,
      ocrComparisonNeeded: true,
      blockTtsExecution: true,
      hasQualityWarning: true,
      userWarningMessage: "النص المستخرج فارغ — يتطلب المسح البصري (OCR).",
    };
  }

  const rawTokens = text.split(/\s+/).filter(Boolean);
  const cleanWords = rawTokens
    .map((w) => w.replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]—–-\d٠-٩۰-۹]/g, ""))
    .filter(Boolean);

  const garbledWords = [];
  const missingLettersWords = [];
  const unnaturalRepetitions = [];
  const wordOrderAnomalies = [];
  let rtlViolations = 0;

  for (let i = 0; i < cleanWords.length; i++) {
    const w = cleanWords[i];
    const bare = w.replace(/[\u064B-\u065F\u0670]/g, "");

    // Check 2: Garbled words (PUA glyphs, replacement chars, mixed Latin+Arabic noise, or repeated identical consonant 4+ times)
    if (
      /[\uE000-\uF8FF\uFFFD]/.test(w) ||
      (/[a-zA-Z]/.test(w) && /[\u0600-\u06FF]/.test(w)) ||
      /(.)\1{3,}/.test(bare)
    ) {
      garbledWords.push(w);
    }

    // Check 3: Missing letters / isolated fragments / orphaned diacritics
    if (
      (bare.length === 1 && !VALID_SINGLE_LETTER_TOKENS.has(bare)) ||
      /^[\u064B-\u065F\u0670]+$/.test(w)
    ) {
      missingLettersWords.push(w);
    }

    // Check 4: Unnatural consecutive word repetition (e.g., overlapping PDF text layer)
    if (i > 0) {
      const prevBare = cleanWords[i - 1].replace(/[\u064B-\u065F\u0670]/g, "");
      if (
        bare.length >= 2 &&
        bare === prevBare &&
        bare !== "اللہ" &&
        bare !== "الله" &&
        bare !== "آمین" &&
        bare !== "سند"
      ) {
        unnaturalRepetitions.push(w);
      }
    }

    // Check 6: RTL logical direction check (no word can start with strictly word-final letters ے، ں، ة، ۃ)
    if (/^[ےںةۃ]/.test(bare)) {
      rtlViolations++;
    }
  }

  // Check 5: Word order anomalies
  // In Urdu, a genuine complete sentence cannot begin with an isolated postposition like "کا", "کے", "کی", "کو", "نے"
  // unless it is a cross-page continuation from the previous page.
  if (
    lang === "ur" &&
    cleanWords.length >= 3 &&
    !sentence?.isContinuationFromPrevPage
  ) {
    const firstBare = cleanWords[0].replace(/[\u064B-\u065F\u0670]/g, "");
    if (URDU_NON_INITIAL_POSTPOSITIONS.has(firstBare)) {
      wordOrderAnomalies.push(`بدء الجملة بحرف ربط لاحق (${firstBare})`);
    }
  }

  const totalWords = Math.max(1, cleanWords.length);
  const garbledRatio = garbledWords.length / totalWords;
  const missingRatio = missingLettersWords.length / totalWords;
  const repetitionRatio = unnaturalRepetitions.length / totalWords;
  const rtlDirectionValid = rtlViolations === 0;

  // Check 7: Compute Extraction Confidence (0 - 100)
  let confidence = 100;
  confidence -= garbledWords.length * 18;
  confidence -= missingLettersWords.length * 10;
  confidence -= unnaturalRepetitions.length * 8;
  confidence -= wordOrderAnomalies.length * 12;
  confidence -= rtlViolations * 25;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const confidenceLevel =
    confidence >= 88
      ? "high"
      : confidence >= 72
      ? "medium"
      : confidence >= 45
      ? "low"
      : "critical";

  // Check 8: Should OCR comparison be triggered?
  const ocrComparisonNeeded =
    confidence < 75 || !rtlDirectionValid || garbledRatio > 0.15;

  // Check 9: Prevent severely distorted text from being sent to TTS
  const blockTtsExecution =
    confidence < 42 ||
    garbledRatio > 0.35 ||
    (!rtlDirectionValid && rtlViolations >= 2) ||
    (totalWords >= 4 && missingRatio > 0.45);

  // Check 10: Clear warning message when accuracy cannot be guaranteed
  const hasQualityWarning = confidence < 78 || blockTtsExecution || !rtlDirectionValid;
  let userWarningMessage = null;
  if (blockTtsExecution) {
    userWarningMessage =
      "تم إيقاف قراءة هذا المقطع تلقائياً لوجود تشوه في استخراج النص — يرجى استخدام المسح البصري (OCR).";
  } else if (hasQualityWarning) {
    userWarningMessage =
      "تنبيه دقة النص: بعض الكلمات المستخرجة في هذا المقطع قد تحتاج إلى مراجعة بصرية.";
  }

  return {
    textIntegrityPassed: !blockTtsExecution && rtlDirectionValid && garbledWords.length === 0,
    extractionConfidence: confidence,
    confidenceLevel,
    garbledWords,
    missingLettersWords,
    unnaturalRepetitions,
    wordOrderAnomalies,
    rtlDirectionValid,
    garbledRatio: Math.round(garbledRatio * 100) / 100,
    missingRatio: Math.round(missingRatio * 100) / 100,
    repetitionRatio: Math.round(repetitionRatio * 100) / 100,
    ocrComparisonNeeded,
    blockTtsExecution,
    hasQualityWarning,
    userWarningMessage,
  };
}

/**
 * Remove accidental consecutive duplicate shadow tokens emitted by double-stamped PDF layers
 * ONLY when two adjacent identical words occur cleanly without changing legitimate emphasis.
 */
export function deduplicateShadowPdfTokens(text) {
  if (!text) return "";
  const tokens = String(text).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return String(text).trim();

  const deduped = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const curr = tokens[i];
    const prev = tokens[i - 1];
    const currBare = curr.replace(/[\u064B-\u065F\u0670۔.،؛؟!:]/g, "");
    const prevBare = prev.replace(/[\u064B-\u065F\u0670۔.،؛؟!:]/g, "");
    // Deduplicate consecutive identical function/content words caused by PDF double-rendering
    if (
      curr === prev &&
      currBare.length >= 2 &&
      currBare !== "اللہ" &&
      currBare !== "الله" &&
      currBare !== "آمین" &&
      currBare !== "كلا" &&
      currBare !== "هيهات"
    ) {
      continue;
    }
    deduped.push(curr);
  }
  return deduped.join(" ");
}

/**
 * Enrich all sentences on a page with:
 * - Strict 4-Stage Text Provenance (`originalExtractedText`, `ocrCorrectedText`, `linguisticProcessedText`, `ttsInputText`)
 * - Language-specific Urdu & Arabic linguistic processing
 * - 10-Point Quality Assurance report per sentence and page-wide (`qaReport`)
 */
export function applyLinguisticAccuracyAndQualityAssurance({
  sentences = [],
  rawPdfLayerText = "",
  extractionSource = "native",
  pageNumber = 1,
}) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return {
      sentences: [],
      qaReport: {
        pageNumber,
        extractionSource,
        textIntegrityPassed: false,
        extractionConfidence: 0,
        confidenceLevel: "critical",
        garbledWordsCount: 0,
        missingLettersCount: 0,
        unnaturalRepetitionsCount: 0,
        wordOrderAnomaliesCount: 0,
        rtlDirectionValid: true,
        ocrComparisonNeeded: true,
        blockedSentencesCount: 0,
        hasQualityWarning: true,
        userWarningMessage: "لم يتم العثور على نص قابل للقراءة في هذه الصفحة.",
      },
    };
  }

  let totalConfidence = 0;
  let garbledWordsCount = 0;
  let missingLettersCount = 0;
  let unnaturalRepetitionsCount = 0;
  let wordOrderAnomaliesCount = 0;
  let blockedSentencesCount = 0;
  let allRtlValid = true;
  const pageGarbledSamples = [];

  const processedSentences = sentences.map((s) => {
    const rawExtracted = String(
      s.originalExtractedText || s.rawExtractedText || s.originalText || ""
    ).trim();
    const ocrCorrected = deduplicateShadowPdfTokens(
      String(s.ocrCorrectedText || s.originalText || rawExtracted).trim()
    );

    const isArabic = s.language === "ar" || s.segmentType === "quran" || s.segmentType === "hadith" || s.segmentType === "dua";

    let linguisticProcessedText = ocrCorrected;
    let ttsInputText = s.cleanedPronunciationText || ocrCorrected;
    let linguisticMeta = {};

    if (isArabic) {
      const arRes = processArabicLinguisticsAndVocalization(
        ocrCorrected,
        s.segmentType
      );
      linguisticProcessedText = arRes.linguisticProcessedText;
      ttsInputText = arRes.ttsInputText;
      linguisticMeta = {
        vocalizationAppliedCount: arRes.vocalizationAppliedCount,
        preservedTashkeelCount: arRes.preservedTashkeelCount,
      };
    } else {
      const urRes = processUrduLinguisticsAndPhonetics(ocrCorrected);
      linguisticProcessedText = urRes.linguisticProcessedText;
      ttsInputText = urRes.ttsInputText;
      linguisticMeta = {
        detectedCompounds: urRes.detectedCompounds,
        pronunciationFlags: urRes.pronunciationFlags,
      };
    }

    const sentenceWithStages = {
      ...s,
      // Strict 4-Stage Text Provenance Separation:
      originalExtractedText: rawExtracted,
      ocrCorrectedText: ocrCorrected,
      linguisticProcessedText,
      ttsInputText,
      textProvenance: {
        originalExtractedText: rawExtracted,
        ocrCorrectedText: ocrCorrected,
        linguisticProcessedText,
        ttsInputText,
        extractionSource,
      },
      // Backward-compatible display & TTS bindings:
      // Display text (`originalText`) is ALWAYS `ocrCorrectedText` (exact book words, zero speculative rewriting).
      // Spoken text (`cleanedPronunciationText`) is ALWAYS `ttsInputText` (phonetically & contextually prepared for TTS).
      originalText: ocrCorrected,
      cleanedPronunciationText: ttsInputText,
      linguisticMeta,
    };

    const qa = auditSentenceExtractionQuality(sentenceWithStages);
    totalConfidence += qa.extractionConfidence;
    garbledWordsCount += qa.garbledWords.length;
    missingLettersCount += qa.missingLettersWords.length;
    unnaturalRepetitionsCount += qa.unnaturalRepetitions.length;
    wordOrderAnomaliesCount += qa.wordOrderAnomalies.length;
    if (!qa.rtlDirectionValid) allRtlValid = false;
    if (qa.blockTtsExecution) blockedSentencesCount++;
    if (qa.garbledWords.length > 0 && pageGarbledSamples.length < 5) {
      pageGarbledSamples.push(...qa.garbledWords.slice(0, 2));
    }

    return {
      ...sentenceWithStages,
      qaAudit: qa,
      extractionConfidence: qa.extractionConfidence,
      blockTtsExecution: qa.blockTtsExecution,
    };
  });

  const avgConfidence = Math.round(totalConfidence / processedSentences.length);
  const confidenceLevel =
    avgConfidence >= 88
      ? "high"
      : avgConfidence >= 72
      ? "medium"
      : avgConfidence >= 45
      ? "low"
      : "critical";

  const ocrComparisonNeeded =
    avgConfidence < 76 || !allRtlValid || blockedSentencesCount > 0;
  const hasQualityWarning =
    avgConfidence < 78 || !allRtlValid || blockedSentencesCount > 0;

  let userWarningMessage = null;
  if (blockedSentencesCount > 0) {
    userWarningMessage = `تنبيه مراجعة الجودة: تم حجب ${blockedSentencesCount} مقطع شديد التشوه من القراءة الصوتية لضمان عدم نطق نص غير سليم.`;
  } else if (hasQualityWarning) {
    userWarningMessage =
      "تنبيه مراجعة الجودة: ثقة استخراج النص في هذه الصفحة متوسطة؛ يوصى بالمطابقة البصرية مع الصفحة الأصلية.";
  }

  const qaReport = {
    pageNumber,
    extractionSource,
    textIntegrityPassed:
      blockedSentencesCount === 0 && allRtlValid && garbledWordsCount === 0,
    extractionConfidence: avgConfidence,
    confidenceLevel,
    garbledWordsCount,
    garbledSamples: pageGarbledSamples,
    missingLettersCount,
    unnaturalRepetitionsCount,
    wordOrderAnomaliesCount,
    rtlDirectionValid: allRtlValid,
    ocrComparisonNeeded,
    blockedSentencesCount,
    hasQualityWarning,
    userWarningMessage,
  };

  return {
    sentences: processedSentences,
    qaReport,
  };
}
