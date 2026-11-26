/**
 * DAR AL TAWHID — Intelligent Linguistic Pause, Semantic Completeness,
 * Topic Detection, and Cross-Page Sentence/Paragraph Linker
 *
 * Implements language-independent linguistic analysis for:
 * - Classical & Modern Standard Arabic (ar)
 * - Pakistani Nastaliq Urdu (ur)
 *
 * Core Capabilities:
 * 1. Semantic & Syntactic Completeness Evaluation (Arabic & Urdu independent grammars)
 * 2. Smart Clause Merging & Unpunctuated Paragraph Segmentation
 * 3. Four-Level Linguistic Pause System:
 *    - short_pause (وقف قصير: 150ms)
 *    - medium_pause (وقف متوسط: 350ms)
 *    - long_pause (وقف طويل: 650ms)
 *    - topic_end_pause (وقف نهاية الموضوع: 950ms)
 * 4. Intelligent Topic Detection (Headings, TOC, Discourse Shift Markers, Analytical Title Generation)
 * 5. Cross-Page Sentence, Paragraph, and Topic Linking without word loss or duplication
 */

// ─── Pause Type Definitions ───────────────────────────────────────────────────
export const PAUSE_TYPES = {
  NONE: {
    id: "none",
    labelAr: "اتصال مستمر عبر الصفحة",
    durationMs: 0,
  },
  SHORT: {
    id: "short_pause",
    labelAr: "وقف قصير (ترابط تركيبي)",
    durationMs: 150,
  },
  MEDIUM: {
    id: "medium_pause",
    labelAr: "وقف متوسط (بين الجمل المرتبطة)",
    durationMs: 350,
  },
  LONG: {
    id: "long_pause",
    labelAr: "وقف طويل (اكتمال فكرة أو فقرة)",
    durationMs: 650,
  },
  TOPIC_END: {
    id: "topic_end_pause",
    labelAr: "وقف نهاية الموضوع",
    durationMs: 950,
  },
};

// ─── 1. ARABIC Linguistic Completeness Rules (Independent of Urdu) ────────────

// Arabic prepositions, subordinating particles, conjunctions, demonstratives, relative pronouns,
// and attribution/construct heads that CANNOT end a semantically complete sentence.
const ARABIC_INCOMPLETE_ENDING_WORDS = new Set([
  // حروف الجر والظروف المضافة
  "من", "إلى", "الى", "عن", "على", "في", "فى", "حتى", "منذ", "مذ", "خلا", "عدا", "حاشا",
  "بين", "عند", "مع", "نحو", "دون", "فوق", "تحت", "قبل", "بعد", "أمام", "خلف", "وراء", "حول", "لدى", "لدن",
  // حروف العطف والنصب والجزم والشرط
  "و", "ف", "ثم", "أو", "او", "أم", "ام", "بل", "لكن", "لا", "لم", "لما", "لن", "قد", "لقد", "سوف",
  "إن", "ان", "أن", "كأن", "ليت", "لعل", "لو", "لولا", "لوما", "إذا", "اذا", "إذ", "اذ", "كلما", "حيث", "حيثما",
  "كي", "لكي", "لأن", "لان", "بأن", "كأنما", "إما", "اما", "ألا", "إلا", "الا",
  // الأسماء الموصولة وأسماء الإشارة والاستفهام
  "الذي", "التي", "الذين", "اللاتي", "اللائي", "اللذان", "اللتان", "اللذين", "اللتين",
  "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "أولئك", "ذانك", "تانك", "هذان", "هاتان",
  "ما", "من", "أي", "اي", "كيف", "أين", "اين", "متى", "هل", "كم", "ماذا", "لماذا",
  // أفعال القول والرواية والمضافات الناقصة والنواسخ المجردة
  "قال", "يقول", "قالت", "قالوا", "قوله", "كقوله", "لقوله", "روى", "حدثنا", "أخبرنا", "سمعت",
  "بن", "ابن", "عبد", "أبو", "أبي", "أبا", "ذو", "ذي", "ذا", "ذات",
  "غير", "سوى", "مثل", "كل", "بعض", "جميع", "كلا", "كلتا", "نفس", "عين",
  "كان", "كانت", "يكون", "تكون", "أصبح", "أضحى", "ظل", "أمسى", "بات", "صار", "ليس", "ليست",
]);

const ARABIC_ATTRIBUTION_ENDING_REGEX =
  /(?:قال(?:\s+الله)?(?:\s+تعالى)?|يقول(?:\s+الله)?(?:\s+تعالى)?|قوله(?:\s+تعالى)?|قال\s+رسول\s+الله(?:\s+ﷺ|\s+صلى\s+الله\s+عليه\s+وسلم)?|قال\s+النبي(?:\s+ﷺ|\s+صلى\s+الله\s+عليه\s+وسلم)?|وفي\s+الحديث|ومنها\s+قوله|كقوله|لقوله)\s*[:：،\-–—]*$/;

const ARABIC_CONTINUATION_START_REGEX =
  /^(?:و(?:لا|لم|لن|ما|إن|أن|قد|إذا|لو|كان|هو|هي|هم|في|من|على|إلى|عن|به|له|بها|لها|بهم|لهم|ذلك|هذا|هذه)\b|ف(?:إن|أن|قد|إذا|لا|لم|لن|هو|هي|هم|كان)\b|ثم\s|أو\s|أم\s|بل\s|لكن\s|لأن\s|حيث\s|كما\s+أن|إذ\s|إلا\s+أن|غير\s+أن|سوى\s+أن|حتى\s|لكي\s|كي\s)/;

const ARABIC_TOPIC_SHIFT_REGEX =
  /^(?:الباب\s|الفصل\s|المبحث\s|المطلب\s|المسألة\s|القاعدة\s|الفرع\s|تنبيه\s*[:：۔.\-]|فائدة\s*[:：۔.\-]|فصل\s+في\b|مسألة\s*[:：۔.\-]|خاتمة\b|مقدمة\b|تمهيد\b|أولاً\s*[:：\-]|ثانياً\s*[:：\-]|ثالثاً\s*[:：\-]|رابعاً\s*[:：\-]|خامساً\s*[:：\-]|[٠-٩\d]{1,2}\s*[-–—.]\s+\S+)/;

function stripArabicDiacriticsAndPunct(word) {
  return String(word || "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .replace(/أ|إ|آ|ٱ/g, "ا")
    .trim();
}

export function analyzeArabicCompleteness(text, nextTextHint = "") {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      isComplete: false,
      completenessScore: 0,
      reason: "empty",
      leadsIntoQuote: false,
    };
  }

  const strippedFootnotes = clean
    .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
    .trim();

  const words = strippedFootnotes.split(/\s+/).filter(Boolean);
  const lastWordRaw = words[words.length - 1] || "";
  const lastWordNorm = stripArabicDiacriticsAndPunct(lastWordRaw);
  const lastWordExact = lastWordRaw
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .trim();

  // Check unclosed quotes or parentheses
  const openQuran = (strippedFootnotes.match(/﴿/g) || []).length;
  const closeQuran = (strippedFootnotes.match(/﴾/g) || []).length;
  const openHadith = (strippedFootnotes.match(/«/g) || []).length;
  const closeHadith = (strippedFootnotes.match(/»/g) || []).length;
  if (openQuran > closeQuran || openHadith > closeHadith) {
    return {
      isComplete: false,
      completenessScore: 20,
      reason: "unclosed_quote",
      leadsIntoQuote: false,
    };
  }

  // Check if ends with attribution colon or quote introducer
  const endsWithColon = /[:：]$/.test(strippedFootnotes);
  const cleanNoTash = strippedFootnotes.replace(/[\u064B-\u065F\u0670]/g, "");
  const isAttributionEnd =
    endsWithColon || ARABIC_ATTRIBUTION_ENDING_REGEX.test(cleanNoTash);
  if (isAttributionEnd) {
    return {
      isComplete: false,
      completenessScore: 35,
      reason: "attribution_head",
      leadsIntoQuote: true,
    };
  }

  // Check if ends with mid-sentence comma or semicolon
  if (/[،,]$/.test(strippedFootnotes)) {
    return {
      isComplete: false,
      completenessScore: 40,
      reason: "mid_clause_comma",
      leadsIntoQuote: false,
    };
  }

  // Check if last word is a syntactic particle/preposition/relative pronoun/mudaf head
  if (
    ARABIC_INCOMPLETE_ENDING_WORDS.has(lastWordExact) ||
    ARABIC_INCOMPLETE_ENDING_WORDS.has(lastWordNorm)
  ) {
    return {
      isComplete: false,
      completenessScore: 25,
      reason: "trailing_particle",
      leadsIntoQuote: false,
    };
  }

  // Very short 1-2 word non-heading fragment without terminal punctuation
  const hasStrongTerminalPunct = /[۔.؟!﴾»]$/.test(strippedFootnotes);
  if (words.length <= 2 && !hasStrongTerminalPunct) {
    return {
      isComplete: false,
      completenessScore: 45,
      reason: "short_incomplete_clause",
      leadsIntoQuote: false,
    };
  }

  // Check next sentence hint for direct syntactic dependency when current lacks terminal punctuation
  const nextClean = String(nextTextHint || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .trim();
  if (
    !hasStrongTerminalPunct &&
    nextClean &&
    /^(?:أن\s|إن\s|لأن\s|كي\s|لكي\s|حتى\s|إلا\s|غير\s|سوى\s)/.test(nextClean)
  ) {
    return {
      isComplete: false,
      completenessScore: 50,
      reason: "dependent_next_clause",
      leadsIntoQuote: false,
    };
  }

  const score = hasStrongTerminalPunct ? 96 : words.length >= 5 ? 84 : 72;
  return {
    isComplete: true,
    completenessScore: score,
    reason: "complete",
    leadsIntoQuote: false,
  };
}

// ─── 2. URDU Linguistic Completeness Rules (Independent of Arabic) ────────────

// Pakistani Urdu postpositions, conjunctions, relative markers, demonstratives, and incomplete verb parts
const URDU_INCOMPLETE_ENDING_WORDS = new Set([
  // حروفِ جار و اضافت (Postpositions)
  "کا", "کے", "کی", "کو", "سے", "میں", "پر", "تک", "نے", "لیے", "لئے", "واسطے",
  "ساتھ", "بغیر", "ذریعے", "ذریعہ", "تحت", "مطابق", "خلاف", "بعد", "پہلے", "قبل",
  "اندر", "باہر", "اوپر", "نیچے", "آگے", "پیچھے", "درمیان", "تئیں", "بابت", "متعلق",
  // حروفِ عطف، شرط، علت و بیان (Conjunctions & Subordinators)
  "اور", "یا", "نیز", "و", "کہ", "کیونکہ", "چونکہ", "تاکہ", "اگر", "اگرچہ", "مگر", "لیکن", "بلکہ",
  "جب", "جہاں", "جیسے", "جو", "جس", "جن", "جنہوں", "جسے", "جنہیں", "جتنا", "جتنے", "جتنی", "جوں",
  // ضمائر و اشاراتِ ناقصہ (Demonstratives & modifiers requiring head noun)
  "یہ", "وہ", "اس", "ان", "اسی", "انہی", "ایسا", "ایسے", "ایسی", "ہر", "کچھ", "کوئی", "تمام", "سب", "بعض", "کئی", "چند",
  // ناقص افعال و مرکبات
  "کر", "ہو", "بنا", "لگا", "رہا", "رہے", "رہی",
]);

// Urdu sentence-final finite verbs, auxiliaries, and honorific completions (SOV grammar)
const URDU_FINITE_CLAUSE_END_REGEX =
  /(?:ہے|ہیں|تھا|تھے|تھی|تھیں|ہو|ہوں|ہوگا|ہوگی|ہوں\s+گے|ہو\s+گی|چاہیے|چاہئے|چاہئیں|گیا|گئی|گئے|رہا|رہی|رہے|سکے|سکتا|سکتے|سکتی|سکتیں|فرمایا|فرماتے|کہا|کہتے|کیا|کی|کیے|کئے|دیا|دی|دیے|دئے|لیا|لی|لیے|پایا|پائی|لایا|آیا|آئے|آئی|بنایا|بتایا|سمجھایا|لکھا|پڑھا|سنا|دیکھا|رکھا|چھوڑا|ڈالا|نکالا|پہنچا|چکا|چکی|چکے|پڑا|پڑی|پڑے|جائے|جائیں|جاتا|جاتے|جاتی|ہوتا|ہوتے|ہوتی|کرتا|کرتے|کرتی|رہتا|رہتے|رہتی|ﷺ|رحمہ\s+اللہ|رضی\s+اللہ\s+عنہ|رضی\s+اللہ\s+عنہم|تعالیٰ)\s*[۔.؟!﴾»"”\)]*$/;

const URDU_ATTRIBUTION_ENDING_REGEX =
  /(?:فرمایا(?:\s+کہ)?|فرماتے\s+ہیں(?:\s+کہ)?|ارشاد\s+ہے(?:\s+کہ)?|ارشاد\s+باری\s+تعالیٰ\s+ہے(?:\s+کہ)?|فرمان\s+ہے(?:\s+کہ)?|کہا(?:\s+کہ)?|کہتے\s+ہیں(?:\s+کہ)?|لکھتے\s+ہیں(?:\s+کہ)?|بیان\s+کیا(?:\s+کہ)?|روایت\s+ہے(?:\s+کہ)?|حدیث\s+میں\s+ہے(?:\s+کہ)?)\s*[:：،\-–—]*$/;

const URDU_TOPIC_SHIFT_REGEX =
  /^(?:باب\s|فصل\s|پہلی\s+فصل|دوسری\s+فصل|تیسری\s+فصل|چوتھی\s+فصل|پہلی\s+بات|دوسری\s+بات|تیسری\s+بات|چوتھی\s+بات|پہلا\s+طریقہ|دوسرا\s+طریقہ|تیسرا\s+طریقہ|خلاصہ\s+کلام|تنبیہ\s*[:：۔.\-]|فائدہ\s*[:：۔.\-]|قاعدہ\s*[:：۔.\-]|مسئلہ\s*[:：۔.\-]|[٠-٩۰-۹\d]{1,2}\s*[۔\-–.]\s+\S+)/;

function stripUrduPunct(word) {
  return String(word || "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .trim();
}

export function analyzeUrduCompleteness(text, nextTextHint = "") {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      isComplete: false,
      completenessScore: 0,
      reason: "empty",
      leadsIntoQuote: false,
    };
  }

  const strippedFootnotes = clean
    .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
    .trim();

  const words = strippedFootnotes.split(/\s+/).filter(Boolean);
  const lastWordRaw = words[words.length - 1] || "";
  const lastWordClean = stripUrduPunct(lastWordRaw);

  // Check unclosed quotes
  const openQuran = (strippedFootnotes.match(/﴿/g) || []).length;
  const closeQuran = (strippedFootnotes.match(/﴾/g) || []).length;
  const openHadith = (strippedFootnotes.match(/«/g) || []).length;
  const closeHadith = (strippedFootnotes.match(/»/g) || []).length;
  if (openQuran > closeQuran || openHadith > closeHadith) {
    return {
      isComplete: false,
      completenessScore: 20,
      reason: "unclosed_quote",
      leadsIntoQuote: false,
    };
  }

  // Check if ends with attribution / quote introducer ("فرماتے ہیں:", "فرمایا کہ", etc.)
  const endsWithColon = /[:：]$/.test(strippedFootnotes);
  if (endsWithColon || URDU_ATTRIBUTION_ENDING_REGEX.test(strippedFootnotes)) {
    return {
      isComplete: false,
      completenessScore: 35,
      reason: "attribution_head",
      leadsIntoQuote: true,
    };
  }

  // Check if ends with mid-clause comma or izafat (زیرِ اضافت / ہمزہ اضافت)
  if (/[،,]$/.test(strippedFootnotes) || /[\u0650\u06C2]$/.test(lastWordClean)) {
    return {
      isComplete: false,
      completenessScore: 35,
      reason: "mid_clause_or_izafat",
      leadsIntoQuote: false,
    };
  }

  // Check if last word is an Urdu postposition, subordinating particle, or incomplete modifier
  if (URDU_INCOMPLETE_ENDING_WORDS.has(lastWordClean)) {
    return {
      isComplete: false,
      completenessScore: 25,
      reason: "trailing_postposition_or_conjunction",
      leadsIntoQuote: false,
    };
  }

  // Check if nextTextHint starts with an Urdu postposition or auxiliary that belongs to this clause
  const nextFirstWord = stripUrduPunct(
    String(nextTextHint || "").trim().split(/\s+/)[0] || ""
  );
  const hasStrongTerminalPunct = /[۔.؟!﴾»]$/.test(strippedFootnotes);
  const hasFiniteVerbEnd = URDU_FINITE_CLAUSE_END_REGEX.test(strippedFootnotes);

  if (
    !hasStrongTerminalPunct &&
    nextFirstWord &&
    /^(?:کا|کے|کی|کو|سے|میں|پر|تک|نے|ہے|ہیں|تھا|تھے|تھی|تھیں|ہو|ہوگا|ہوگی|چاہیے|چاہئے|گیا|گئی|گئے)$/.test(
      nextFirstWord
    )
  ) {
    return {
      isComplete: false,
      completenessScore: 30,
      reason: "split_before_postposition_or_auxiliary",
      leadsIntoQuote: false,
    };
  }

  if (!hasStrongTerminalPunct && !hasFiniteVerbEnd && words.length < 4) {
    return {
      isComplete: false,
      completenessScore: 45,
      reason: "missing_finite_predicate",
      leadsIntoQuote: false,
    };
  }

  const score =
    hasStrongTerminalPunct && hasFiniteVerbEnd
      ? 98
      : hasStrongTerminalPunct || hasFiniteVerbEnd
      ? 90
      : 74;

  return {
    isComplete: true,
    completenessScore: score,
    reason: "complete",
    leadsIntoQuote: false,
  };
}

/**
 * Dispatch semantic completeness analysis to the appropriate language grammar (Arabic vs Urdu).
 */
export function evaluateSemanticCompleteness(text, language = "ur", nextTextHint = "") {
  if (language === "ar" || language === "ar-SA") {
    return analyzeArabicCompleteness(text, nextTextHint);
  }
  return analyzeUrduCompleteness(text, nextTextHint);
}

// ─── 3. Unpunctuated Long Clause Splitter & Incomplete Clause Merger ──────────

const URDU_CLAUSE_FINITE_AUX = new Set([
  "ہے", "ہیں", "تھا", "تھے", "تھی", "تھیں", "ہوگا", "ہوگی", "چاہیے", "چاہئے", "فرمایا", "گیا", "گئی", "گئے",
]);
const URDU_CLAUSE_TRANSITION_NEXT = new Set([
  "اور", "لیکن", "مگر", "بلکہ", "چنانچہ", "لہٰذا", "لہذا", "نیز", "پھر", "البتہ", "کیونکہ", "چونکہ", "حالانکہ", "اگرچہ", "جبکہ",
]);

const ARABIC_CLAUSE_TRANSITION_NEXT = new Set([
  "ثم", "ولهذا", "ولذلك", "وكذلك", "وأما", "واما", "فأما", "فاما", "فإذا", "فاذا", "بل", "ولكن", "والمقصود", "والحاصل",
]);

/**
 * Split a long unpunctuated sentence (> 30 words) ONLY at genuine syntactic clause completion points
 * where the first clause is semantically complete and the second clause begins a new discourse proposition.
 */
function splitLongUnpunctuatedSentenceAtClauseBoundaries(sent) {
  if (!sent || sent.segmentType === "quran" || sent.segmentType === "heading") {
    return [sent];
  }
  const text = String(sent.originalText || "").trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 30) return [sent];

  const lang = sent.language === "ar" ? "ar" : "ur";
  const splitIndices = [];
  let lastSplitIdx = 0;

  for (let i = 9; i < tokens.length - 8; i++) {
    if (i - lastSplitIdx < 10) continue;
    const currTok = tokens[i];
    const nextTok = tokens[i + 1];
    const currBare = lang === "ar" ? stripArabicDiacriticsAndPunct(currTok) : stripUrduPunct(currTok);
    const nextBare = lang === "ar" ? stripArabicDiacriticsAndPunct(nextTok) : stripUrduPunct(nextTok);

    const hasSemicolonOrComma = /[؛،,]$/.test(currTok);
    let isNaturalClauseBoundary = false;

    if (lang === "ur") {
      if (
        (URDU_CLAUSE_FINITE_AUX.has(currBare) &&
          (hasSemicolonOrComma || URDU_CLAUSE_TRANSITION_NEXT.has(nextBare))) ||
        (/؛$/.test(currTok) && !URDU_INCOMPLETE_ENDING_WORDS.has(currBare))
      ) {
        const leftCandidate = tokens.slice(lastSplitIdx, i + 1).join(" ");
        const rightCandidate = tokens.slice(i + 1).join(" ");
        const comp = analyzeUrduCompleteness(leftCandidate, rightCandidate);
        if (comp.isComplete) {
          isNaturalClauseBoundary = true;
        }
      }
    } else {
      if (
        (/؛$/.test(currTok) ||
          (hasSemicolonOrComma && ARABIC_CLAUSE_TRANSITION_NEXT.has(nextBare))) &&
        !ARABIC_INCOMPLETE_ENDING_WORDS.has(currBare)
      ) {
        const leftCandidate = tokens.slice(lastSplitIdx, i + 1).join(" ");
        const rightCandidate = tokens.slice(i + 1).join(" ");
        const comp = analyzeArabicCompleteness(leftCandidate, rightCandidate);
        if (comp.isComplete) {
          isNaturalClauseBoundary = true;
        }
      }
    }

    if (isNaturalClauseBoundary) {
      splitIndices.push(i + 1);
      lastSplitIdx = i + 1;
    }
  }

  if (splitIndices.length === 0) return [sent];

  const subSentences = [];
  let start = 0;
  const allIndices = [...splitIndices, tokens.length];
  for (const end of allIndices) {
    const sliceText = tokens.slice(start, end).join(" ").trim();
    const sliceWords = (sent.words || []).slice(start, end).map((w, idx) => ({
      ...w,
      wordIndex: idx,
    }));
    if (sliceText && sliceWords.length > 0) {
      subSentences.push({
        ...sent,
        originalText: sliceText,
        ocrCorrectedText: sliceText,
        cleanedPronunciationText: sliceText,
        words: sliceWords,
      });
    }
    start = end;
  }

  return subSentences.length > 0 ? subSentences : [sent];
}

/**
 * Refine raw block sentences using Arabic & Urdu linguistic completeness rules:
 * 1. Merge adjacent clauses if the first clause is syntactically incomplete (e.g. split across a line or abbreviation)
 *    and shares the same language and non-Quran segment category.
 * 2. Segment overly long unpunctuated paragraphs at genuine syntactic clause boundaries.
 */
export function refineSentencesLinguistically(rawSentences = []) {
  if (!Array.isArray(rawSentences) || rawSentences.length === 0) return [];

  // Pass 1: Merge syntactically incomplete non-Quran clauses with their immediate continuation in the same block & language
  const merged = [];
  for (let i = 0; i < rawSentences.length; i++) {
    const curr = { ...rawSentences[i] };
    const next = i + 1 < rawSentences.length ? rawSentences[i + 1] : null;

    if (
      next &&
      curr.paragraphIndex === next.paragraphIndex &&
      curr.language === next.language &&
      curr.segmentType !== "quran" &&
      next.segmentType !== "quran" &&
      curr.segmentType !== "heading" &&
      next.segmentType !== "heading"
    ) {
      const comp = evaluateSemanticCompleteness(
        curr.originalText,
        curr.language,
        next.originalText
      );
      const combinedWordCount =
        (curr.words?.length || 0) + (next.words?.length || 0);

      // Merge when the first part is syntactically incomplete (and NOT an attribution introducing a Hadith/Quran quote)
      if (
        !comp.isComplete &&
        !comp.leadsIntoQuote &&
        combinedWordCount <= 42
      ) {
        const joinedOrig = `${curr.originalText} ${next.originalText}`.replace(/\s+/g, " ").trim();
        const joinedRawExt = `${curr.originalExtractedText || curr.originalText} ${
          next.originalExtractedText || next.originalText
        }`
          .replace(/\s+/g, " ")
          .trim();
        const joinedClean = `${curr.cleanedPronunciationText || curr.originalText} ${
          next.cleanedPronunciationText || next.originalText
        }`
          .replace(/\s+/g, " ")
          .trim();
        const joinedWords = [...(curr.words || []), ...(next.words || [])].map(
          (w, idx) => ({
            ...w,
            wordIndex: idx,
          })
        );
        const joinedLineBoxes = [
          ...(curr.lineBoxes || []),
          ...(next.lineBoxes || []),
        ];
        merged.push({
          ...curr,
          originalExtractedText: joinedRawExt,
          ocrCorrectedText: joinedOrig,
          originalText: joinedOrig,
          cleanedPronunciationText: joinedClean,
          words: joinedWords,
          lineBoxes: joinedLineBoxes,
        });
        i++; // skip next
        continue;
      }
    }
    merged.push(curr);
  }

  // Pass 2: Split overly long unpunctuated sentences at true linguistic clause boundaries
  const finalSentences = [];
  for (const s of merged) {
    const parts = splitLongUnpunctuatedSentenceAtClauseBoundaries(s);
    finalSentences.push(...parts);
  }

  return finalSentences;
}

// ─── 4. Intelligent Topic Detection & Cross-Page Topic/Sentence Linker ────────

/**
 * Check if a sentence or block starts a new Topic based on:
 * - Structural heading blockType/segmentType
 * - Book Table of Contents / PDF Outline match
 * - Explicit Arabic or Urdu topic transition markers
 */
function detectTopicBoundaryAtSentence(sent, prevSent, pageOutlineTitles = []) {
  const text = String(sent?.originalText || "").trim();
  const cleanNoTash = text.replace(/[\u064B-\u065F\u0670]/g, "");

  // 1. Explicit Heading segment
  if (sent.segmentType === "heading") {
    return {
      isNewTopic: true,
      title: text,
      isGeneratedTitle: false,
      confidence: "exact",
    };
  }

  // 2. Matches a PDF Outline / Table of Contents title on this page
  for (const outlineTitle of pageOutlineTitles) {
    const normOutline = outlineTitle.replace(/[\u064B-\u065F\u0670۔.،؛؟!]/g, "").trim();
    const normSent = cleanNoTash.replace(/[۔.،؛؟!]/g, "").trim();
    if (
      normOutline.length >= 4 &&
      (normSent.startsWith(normOutline) || normOutline.startsWith(normSent))
    ) {
      return {
        isNewTopic: true,
        title: outlineTitle,
        isGeneratedTitle: false,
        confidence: "exact",
      };
    }
  }

  // 3. Starts a new paragraph with an explicit Arabic or Urdu numbered/discourse topic shift marker
  const isNewParagraph = !prevSent || sent.paragraphIndex !== prevSent.paragraphIndex;
  if (isNewParagraph) {
    const isTopicMarker =
      sent.language === "ar"
        ? ARABIC_TOPIC_SHIFT_REGEX.test(cleanNoTash)
        : URDU_TOPIC_SHIFT_REGEX.test(cleanNoTash);
    if (isTopicMarker) {
      // Extract concise heading label (up to colon/dash or first 8 words)
      const colonIdx = text.search(/[:：\-–—]/);
      const extractedTitle =
        colonIdx > 2 && colonIdx < 55
          ? text.slice(0, colonIdx).trim()
          : text.split(/\s+/).slice(0, 7).join(" ");
      return {
        isNewTopic: true,
        title: extractedTitle,
        isGeneratedTitle: colonIdx <= 0 && text.split(/\s+/).length > 9,
        confidence: "high",
      };
    }
  }

  return { isNewTopic: false };
}

/**
 * Create an internal analytical topic title when a page or topic starts without an explicit heading.
 * Always marked with `isGeneratedTitle: true` so it is never confused with the book's original headings.
 */
function buildAnalyticalTopicTitle(firstSent, pageNumber) {
  const raw = String(firstSent?.originalText || "")
    .replace(/[﴿﴾«»"“”\(\)\[\]]/g, "")
    .trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return `موضوع الصفحة ${pageNumber}`;
  }
  const snippet = words.slice(0, Math.min(6, words.length)).join(" ");
  return `${snippet}${words.length > 6 ? "..." : ""}`;
}

/**
 * Enrich all sentences on a page with:
 * - Semantic completeness (`isMeaningComplete`, `completenessScore`, `completenessReason`)
 * - Sentence-to-sentence & paragraph-to-paragraph links (`prevSentenceIndex`, `nextSentenceIndex`, `isParagraphStart`, `isParagraphEnd`)
 * - Topic detection & assignment (`topicId`, `topicTitle`, `isGeneratedTopicTitle`, `topicConfidence`, `isTopicStart`, `isTopicEnd`)
 * - Intelligent 4-level Pause type (`pauseTypeAfter`, `pauseDurationMs`, `pauseLabelAr`, `relationToNext`)
 * - Cross-page sentence & topic continuation flags (`continuesToNextPage`, `isContinuationFromPrevPage`)
 */
export function enrichPageWithLinguisticStructure({
  sentences = [],
  pageNumber = 1,
  bookMetadata = null,
  crossPageInfo = null,
}) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return { sentences: [], topics: [] };
  }

  // Extract any TOC titles listed for this page in bookMetadata
  const tocList = Array.isArray(bookMetadata?.table_of_contents)
    ? bookMetadata.table_of_contents
    : [];
  const pageOutlineTitles = tocList
    .filter((it) => Number(it.page || it.pageNumber) === Number(pageNumber))
    .map((it) => String(it.title || "").trim())
    .filter(Boolean);

  // Find most recent preceding TOC title if this page is a continuation of a previous chapter/topic
  const inheritedTocEntry = [...tocList]
    .filter((it) => Number(it.page || it.pageNumber) <= Number(pageNumber))
    .sort((a, b) => Number(b.page || b.pageNumber) - Number(a.page || a.pageNumber))[0];

  const topics = [];
  let currentTopic = null;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const prev = i > 0 ? sentences[i - 1] : null;
    const boundary = detectTopicBoundaryAtSentence(s, prev, pageOutlineTitles);

    if (boundary.isNewTopic) {
      if (currentTopic) {
        currentTopic.endSentenceIndex = i - 1;
        currentTopic.endParagraphIndex = prev?.paragraphIndex ?? currentTopic.startParagraphIndex;
        currentTopic.continuesOnNextPage = false;
      }
      const tId = `p${pageNumber}_t${topics.length}`;
      currentTopic = {
        id: tId,
        topicId: tId,
        title: boundary.title,
        isGeneratedTitle: boundary.isGeneratedTitle,
        confidence: boundary.confidence,
        pageNumber,
        startPage: pageNumber,
        endPage: pageNumber,
        startSentenceIndex: i,
        endSentenceIndex: sentences.length - 1,
        startParagraphIndex: s.paragraphIndex ?? 0,
        endParagraphIndex: s.paragraphIndex ?? 0,
        paragraphIndices: [s.paragraphIndex ?? 0],
        continuesFromPrevPage: false,
        continuesOnNextPage: true,
      };
      topics.push(currentTopic);
    } else if (!currentTopic) {
      // First sentence on page has no explicit heading — inherit active TOC chapter or generate analytical topic title
      const hasInheritedToc = Boolean(inheritedTocEntry?.title);
      const tId = `p${pageNumber}_t0`;
      currentTopic = {
        id: tId,
        topicId: tId,
        title: hasInheritedToc
          ? String(inheritedTocEntry.title).trim()
          : buildAnalyticalTopicTitle(s, pageNumber),
        isGeneratedTitle: !hasInheritedToc,
        confidence: hasInheritedToc ? "high" : "approximate",
        pageNumber,
        startPage: hasInheritedToc
          ? Number(inheritedTocEntry.page || inheritedTocEntry.pageNumber || pageNumber)
          : pageNumber,
        endPage: null,
        startSentenceIndex: 0,
        endSentenceIndex: sentences.length - 1,
        startParagraphIndex: s.paragraphIndex ?? 0,
        endParagraphIndex: s.paragraphIndex ?? 0,
        paragraphIndices: [s.paragraphIndex ?? 0],
        continuesFromPrevPage: pageNumber > 1,
        continuesOnNextPage: true,
      };
      topics.push(currentTopic);
    } else {
      const pIdx = s.paragraphIndex ?? 0;
      currentTopic.endSentenceIndex = i;
      currentTopic.endParagraphIndex = pIdx;
      if (!currentTopic.paragraphIndices.includes(pIdx)) {
        currentTopic.paragraphIndices.push(pIdx);
      }
    }
  }

  // Enrich each sentence with completeness, paragraph/topic boundaries, and intelligent pause durations
  const enrichedSentences = sentences.map((s, idx) => {
    const prev = idx > 0 ? sentences[idx - 1] : null;
    const next = idx + 1 < sentences.length ? sentences[idx + 1] : null;

    const isParagraphStart = !prev || s.paragraphIndex !== prev.paragraphIndex;
    const isParagraphEnd = !next || s.paragraphIndex !== next.paragraphIndex;

    const topic =
      topics.find(
        (t) => idx >= t.startSentenceIndex && idx <= t.endSentenceIndex
      ) || topics[0];

    const isTopicStart = topic ? idx === topic.startSentenceIndex : idx === 0;
    const isTopicEnd = topic
      ? idx === topic.endSentenceIndex && !topic.continuesOnNextPage
      : false;

    const nextTextHint = next
      ? next.originalText
      : crossPageInfo?.nextPageFirstSentenceText || "";

    const completeness = evaluateSemanticCompleteness(
      s.originalText,
      s.language,
      nextTextHint
    );

    const isLastOnPage = idx === sentences.length - 1;
    const isFirstOnPage = idx === 0;

    // Cross-page sentence continuation check:
    // If the last sentence on the page lacks terminal punctuation or is syntactically incomplete,
    // link it seamlessly to the first sentence of the next page without pausing at the page break.
    const strippedLast = String(s.originalText || "")
      .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
      .trim();
    const lacksTerminalAtPageBottom =
      isLastOnPage &&
      s.segmentType !== "heading" &&
      (!/[۔.؟!﴾»]$/.test(strippedLast) || !completeness.isComplete);

    const continuesToNextPage = Boolean(
      isLastOnPage &&
        (lacksTerminalAtPageBottom || Boolean(crossPageInfo?.continuesToNextPage))
    );
    const isContinuationFromPrevPage = Boolean(
      isFirstOnPage && Boolean(crossPageInfo?.isContinuationFromPrevPage)
    );

    // Determine semantic relation to next sentence & intelligent pause duration
    let pauseSpec = PAUSE_TYPES.MEDIUM;
    let relationToNext = "related_sentence";

    if (continuesToNextPage) {
      pauseSpec = PAUSE_TYPES.NONE;
      relationToNext = "cross_page_continuation";
    } else if (isTopicEnd) {
      pauseSpec = PAUSE_TYPES.TOPIC_END;
      relationToNext = "topic_boundary";
    } else if (
      s.segmentType === "heading" ||
      completeness.leadsIntoQuote ||
      !completeness.isComplete ||
      (next &&
        (next.segmentType === "quran" || next.segmentType === "hadith") &&
        /[:：]$/.test(strippedLast))
    ) {
      pauseSpec = PAUSE_TYPES.SHORT;
      relationToNext = completeness.leadsIntoQuote
        ? "quote_attribution"
        : !completeness.isComplete
        ? "syntactic_continuation"
        : "heading_to_body";
    } else if (isParagraphEnd) {
      pauseSpec = PAUSE_TYPES.LONG;
      relationToNext = "paragraph_boundary";
    } else {
      pauseSpec = PAUSE_TYPES.MEDIUM;
      relationToNext = "related_sentence";
    }

    return {
      ...s,
      sentenceIndex: idx,
      prevSentenceIndex: idx > 0 ? idx - 1 : null,
      nextSentenceIndex: idx + 1 < sentences.length ? idx + 1 : null,
      isParagraphStart,
      isParagraphEnd,
      paragraphContinuesToNextPage: Boolean(isLastOnPage && continuesToNextPage),
      topicId: topic?.topicId || `p${pageNumber}_t0`,
      topicTitle: topic?.title || "",
      isGeneratedTopicTitle: Boolean(topic?.isGeneratedTitle),
      topicConfidence: topic?.confidence || "approximate",
      isTopicStart,
      isTopicEnd,
      topicContinuesOnNextPage: Boolean(topic?.continuesOnNextPage),
      isMeaningComplete: completeness.isComplete,
      completenessScore: completeness.completenessScore,
      completenessReason: completeness.reason,
      semanticCompleteness: {
        isComplete: completeness.isComplete,
        score: completeness.completenessScore,
        reason: completeness.reason,
      },
      continuesToNextPage,
      isContinuationFromPrevPage,
      crossPageCombinedText:
        isLastOnPage && crossPageInfo?.combinedCrossPageText
          ? crossPageInfo.combinedCrossPageText
          : null,
      relationToNext,
      pauseTypeAfter: pauseSpec.id,
      pauseDurationMs: pauseSpec.durationMs,
      pauseLabelAr: pauseSpec.labelAr,
    };
  });

  return {
    sentences: enrichedSentences,
    topics,
  };
}
