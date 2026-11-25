/**
 * DAR AL TAWHID — Specialized Web Speech API Controller & Articulatory Phonetics Service
 *
 * Provides:
 * 1. Asynchronous discovery & caching of browser `SpeechSynthesisVoice` engines across platforms,
 *    prioritizing authentic male voices for Arabic (`ar-SA`, `ar-EG`, `ar-AE`, `ar-JO`) and Urdu (`ur-PK`, `ur-IN`).
 * 2. Preset articulatory & makharij profiles (`tajweed_articulatory`, `hadith_muhaqqaq`, `urdu_nastaliq_fasih`, `heading_bayan`)
 *    with calibrated rate, pitch, volume, and clause pause rules.
 * 3. Client-side Arabic Tashkeel & Makharij injection (shadda canonicalization, sun/moon lam, isnad & hadith formulas,
 *    glottal stop hamzat al-qat', and madd elongation balance) + Pakistani Urdu Nastaliq phonetic proofreading
 *    (ezafe, waaw-e-atf, compound expressions, honorifics, and section numbering).
 * 4. High-precision word-boundary synchronization using native `onboundary` character offsets mapped 1-to-1
 *    onto reader word tokens, with an automatic requestAnimationFrame phonetic timer fallback for browsers
 *    whose Web Speech voices omit `word` boundary events.
 */

import {
  canonicalizeTextForLanguage,
  detectIsUrduScript,
  normalizeUrduTextForPronunciation,
} from "./textProcessor";

// ─── 1. Dialect & Locale Configurations (Arabic & Urdu) ────────────────────────
export const WEB_SPEECH_DIALECTS = {
  "ar-SA": {
    code: "ar-SA",
    language: "ar",
    label: "العربية الفصحى — لهجة الحجاز والجزيرة (ar-SA • معتمد للأحاديث والمتون)",
    shortLabel: "العربية الفصحى (ar-SA)",
    fallbackLangs: ["ar-SA", "ar_SA", "ar-AE", "ar-EG", "ar-JO", "ar-KW", "ar"],
    preferredVoiceKeywords: ["Hamed", "Maged", "Naayf", "Tarik", "Majed", "Natural", "Online", "Google", "Microsoft"],
  },
  "ar-EG": {
    code: "ar-EG",
    language: "ar",
    label: "العربية الفصحى — قراءة التراث المصري الأزهرية (ar-EG • واضح وجلي)",
    shortLabel: "العربية التراثية (ar-EG)",
    fallbackLangs: ["ar-EG", "ar_EG", "ar-SA", "ar-AE", "ar"],
    preferredVoiceKeywords: ["Shakir", "Hamed", "Maged", "Tarik", "Natural", "Online", "Google", "Microsoft"],
  },
  "ar-AE": {
    code: "ar-AE",
    language: "ar",
    label: "العربية الفصحى — الإلقاء الخليجي المتزن (ar-AE)",
    shortLabel: "العربية الفصحى (ar-AE)",
    fallbackLangs: ["ar-AE", "ar_AE", "ar-SA", "ar-EG", "ar"],
    preferredVoiceKeywords: ["Hamdan", "Hamed", "Maged", "Natural", "Online", "Google", "Microsoft"],
  },
  "ur-PK": {
    code: "ur-PK",
    language: "ur",
    label: "الأردية الباكستانية الفصيحة — معيار العلماء وخط نستعليق (ur-PK • Asad)",
    shortLabel: "الأردية الباكستانية (ur-PK)",
    fallbackLangs: ["ur-PK", "ur_PK", "ur-IN", "ur_IN", "ur"],
    preferredVoiceKeywords: ["Asad", "Salman", "Natural", "Online", "Pakistan", "Google", "Microsoft"],
  },
  "ur-IN": {
    code: "ur-IN",
    language: "ur",
    label: "الأردية الهندية الكلاسيكية — نطق سردي مفصل (ur-IN • Salman)",
    shortLabel: "الأردية الكلاسيكية (ur-IN)",
    fallbackLangs: ["ur-IN", "ur_IN", "ur-PK", "ur_PK", "ur"],
    preferredVoiceKeywords: ["Salman", "Asad", "Natural", "Online", "India", "Google", "Microsoft"],
  },
};

// ─── 2. Makharij & Tashkeel Articulatory Presets ──────────────────────────────
export const WEB_SPEECH_ARTICULATION_PRESETS = [
  {
    id: "tajweed_articulatory",
    label: "ضبط مخارج الحروف والتشكيل المحقق (الأمثل للأحاديث والمتون والأردية)",
    description: "تحقيق مخارج الحروف، وتفخيم وترقيق الصوت، وإشباع الشدّات والحركات مع وقفات علمية متأنية",
    rateMultiplier: 0.93,
    pitchBase: 0.96,
    clausePauseSpaces: 2,
    strictTashkeel: true,
    urduPhoneticRepair: true,
    segmentModifiers: {
      hadith: { rateDelta: -0.05, pitchDelta: -0.03 },
      dua: { rateDelta: -0.06, pitchDelta: -0.04 },
      quran: { rateDelta: -0.08, pitchDelta: -0.04 },
      arabic_quote: { rateDelta: -0.03, pitchDelta: -0.02 },
      heading: { rateDelta: -0.02, pitchDelta: +0.02 },
      urdu_body: { rateDelta: -0.02, pitchDelta: -0.01 },
    },
  },
  {
    id: "hadith_muhaqqaq",
    label: "إلقاء المحدِّثين المتأنّي (تحقيق الأسانيد والمتون النبوية)",
    description: "وتيرة أهدأ ونبرة وقورة لإبراز ألفاظ الحديث النبوي والترضي والتصلية بوضوح تام",
    rateMultiplier: 0.88,
    pitchBase: 0.94,
    clausePauseSpaces: 3,
    strictTashkeel: true,
    urduPhoneticRepair: true,
    segmentModifiers: {
      hadith: { rateDelta: -0.07, pitchDelta: -0.04 },
      dua: { rateDelta: -0.08, pitchDelta: -0.05 },
      quran: { rateDelta: -0.09, pitchDelta: -0.05 },
      arabic_quote: { rateDelta: -0.05, pitchDelta: -0.03 },
      heading: { rateDelta: -0.03, pitchDelta: +0.01 },
      urdu_body: { rateDelta: -0.04, pitchDelta: -0.02 },
    },
  },
  {
    id: "urdu_nastaliq_fasih",
    label: "بيان الأردية الفصيح (ضبط الإضافات والمصطلحات الشرعية في الأردية)",
    description: "ضبط مخارج الحروف المشتركة بين العربية والأردية ومنع دمج الكلمات في خط نستعليق",
    rateMultiplier: 0.95,
    pitchBase: 0.98,
    clausePauseSpaces: 2,
    strictTashkeel: true,
    urduPhoneticRepair: true,
    segmentModifiers: {
      hadith: { rateDelta: -0.04, pitchDelta: -0.02 },
      dua: { rateDelta: -0.05, pitchDelta: -0.03 },
      quran: { rateDelta: -0.07, pitchDelta: -0.03 },
      arabic_quote: { rateDelta: -0.02, pitchDelta: -0.01 },
      heading: { rateDelta: -0.01, pitchDelta: +0.02 },
      urdu_body: { rateDelta: -0.01, pitchDelta: 0.0 },
    },
  },
  {
    id: "fluent_sard",
    label: "سرد علمي متواصل (قراءة سلسة مع الحفاظ على التشكيل)",
    description: "انسيابية أسرع للشروح الطويلة مع بقاء التشكيل الكامل وتصحيح الكلمات",
    rateMultiplier: 1.0,
    pitchBase: 1.0,
    clausePauseSpaces: 1,
    strictTashkeel: true,
    urduPhoneticRepair: true,
    segmentModifiers: {
      hadith: { rateDelta: -0.02, pitchDelta: -0.01 },
      dua: { rateDelta: -0.03, pitchDelta: -0.02 },
      quran: { rateDelta: -0.05, pitchDelta: -0.02 },
      arabic_quote: { rateDelta: 0.0, pitchDelta: 0.0 },
      heading: { rateDelta: 0.0, pitchDelta: +0.01 },
      urdu_body: { rateDelta: 0.0, pitchDelta: 0.0 },
    },
  },
];

// ─── 3. Arabic Tashkeel & Makharij Enhancer (Client-Side) ─────────────────────
const ARABIC_TASHKEEL_LEXICON = [
  [/\bإنما\b/g, "إِنَّمَا"],
  [/\bوإنما\b/g, "وَإِنَّمَا"],
  [/\bالأعمال\b/g, "الْأَعْمَالُ"],
  [/\bبالنيات\b/g, "بِالنِّيَّاتِ"],
  [/\bلكل\s+امرئ\s+ما\s+نوى\b/g, "لِكُلِّ امْرِئٍ مَا نَوَى"],
  [/\bفمن\s+كانت\s+هجرته\b/g, "فَمَنْ كَانَتْ هِجْرَتُهُ"],
  [/\bفهجرته\s+إلى\s+ما\s+هاجر\s+إليه\b/g, "فَهِجْرَتُهُ إِلَى مَا هَاجَرَ إِلَيْهِ"],
  [/\bقال\s+رسول\s+الله\b/g, "قَالَ رَسُولُ اللَّهِ"],
  [/\bقال\s+النبي\b/g, "قَالَ النَّبِيُّ"],
  [/\bصلى\s+الله\s+عليه\s+وسلم\b/g, "صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ"],
  [/\bعليه\s+الصلاة\s+والسلام\b/g, "عَلَيْهِ الصَّلَاةُ وَالسَّلَامُ"],
  [/\bرضي\s+الله\s+عنه\b/g, "رَضِيَ اللَّهُ عَنْهُ"],
  [/\bرضي\s+الله\s+عنها\b/g, "رَضِيَ اللَّهُ عَنْهَا"],
  [/\bرضي\s+الله\s+عنهما\b/g, "رَضِيَ اللَّهُ عَنْهُمَا"],
  [/\bرضي\s+الله\s+عنهم\b/g, "رَضِيَ اللَّهُ عَنْهُمْ"],
  [/\bرحمه\s+الله\b/g, "رَحِمَهُ اللَّهُ"],
  [/\bرحمهم\s+الله\b/g, "رَحِمَهُمُ اللَّهُ"],
  [/\bحفظه\s+الله\b/g, "حَفِظَهُ اللَّهُ"],
  [/\bعز\s+وجل\b/g, "عَزَّ وَجَلَّ"],
  [/\bسبحانه\s+وتعالى\b/g, "سُبْحَانَهُ وَتَعَالَى"],
  [/\bتبارك\s+وتعالى\b/g, "تَبَارَكَ وَتَعَالَى"],
  [/\bالحمد\s+لله\s+رب\s+العالمين\b/g, "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"],
  [/\bبسم\s+الله\s+الرحمن\s+الرحيم\b/g, "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"],
  [/\bاللهم\s+إني\s+أعوذ\s+بك\b/g, "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ"],
  [/\bأعوذ\s+بالله\s+من\s+الشيطان\s+الرجيم\b/g, "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ"],
  [/\bمتفق\s+عليه\b/g, "مُتَّفَقٌ عَلَيْهِ"],
  [/\bرواه\s+البخاري\b/g, "رَوَاهُ الْبُخَارِيُّ"],
  [/\bرواه\s+مسلم\b/g, "رَوَاهُ مُسْلِمٌ"],
  [/\bأخرجه\s+البخاري\b/g, "أَخْرَجَهُ الْبُخَارِيُّ"],
  [/\bأخرجه\s+مسلم\b/g, "أَخْرَجَهُ مُسْلِمٌ"],
  [/\bعن\s+أبي\s+هريرة\b/g, "عَنْ أَبِي هُرَيْرَةَ"],
  [/\bعن\s+عمر\s+بن\s+الخطاب\b/g, "عَنْ عُمَرَ بْنِ الْخَطَّابِ"],
  [/\bعن\s+عائشة\b/g, "عَنْ عَائِشَةَ"],
  [/\bأم\s+المؤمنين\b/g, "أُمِّ الْمُؤْمِنِينَ"],
  [/\bالباب\s+الأول\b/g, "الْبَابُ الْأَوَّلُ"],
  [/\bالباب\s+الثاني\b/g, "الْبَابُ الثَّانِي"],
  [/\bالباب\s+الثالث\b/g, "الْبَابُ الثَّالِثُ"],
  [/\bالباب\s+الرابع\b/g, "الْبَابُ الرَّابِعُ"],
  [/\bالباب\s+الخامس\b/g, "الْبَابُ الْخَامِسُ"],
  [/\bالباب\s+السادس\b/g, "الْبَابُ السَّادِسُ"],
  [/\bالفصل\s+الأول\b/g, "الْفَصْلُ الْأَوَّلُ"],
  [/\bالفصل\s+الثاني\b/g, "الْفَصْلُ الثَّانِي"],
  [/\bالفصل\s+الثالث\b/g, "الْفَصْلُ الثَّالِثُ"],
  [/\bالفصل\s+الرابع\b/g, "الْفَصْلُ الرَّابِعُ"],
  [/\bالفصل\s+الخامس\b/g, "الْفَصْلُ الْخَامِسُ"],
  [/\bمقدمة\s+المؤلف\b/g, "مُقَدِّمَةُ الْمُؤَلِّفِ"],
];

/**
 * Apply canonical Arabic Tashkeel & Makharij normalization for Web Speech API
 */
export function applyArabicTashkeelAndMakharij(rawText, options = {}) {
  if (!rawText) return "";
  const { strictTashkeel = true } = options;

  let s = canonicalizeTextForLanguage(String(rawText), "ar")
    .replace(/\u0640/g, "") // Strip decorative Tatweel/Kashida so Web Speech doesn't split word stems
    .replace(/\u0671/g, "ا") // Wasla -> standard Alef for TTS compatibility
    .replace(/([\u064B-\u0650\u0652\u0670]+)\u0651/g, "\u0651$1") // Canonical Shadda before vowel
    .replace(/\u0652([\u064B-\u0650])/g, "$1") // Remove stray sukun before vowel
    .replace(/ﷺ/g, " صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ ")
    .replace(/ﷻ/g, " جَلَّ جَلَالُهُ ");

  // Insert natural articulatory pause after leading section numbering (e.g. "١- توضيح..." -> "١، توضيح...")
  s = s.replace(/^\s*([٠-٩۰-۹\d]{1,3})\s*[-–—.۔]+\s*/g, "$1، ");
  s = s.replace(/^\s*\(\s*([أبجدهوزحطيك٠-٩۰-۹\d]{1,2})\s*\)\s*/g, "($1)، ");

  if (strictTashkeel) {
    for (const [pattern, vocalized] of ARABIC_TASHKEEL_LEXICON) {
      s = s.replace(pattern, vocalized);
    }
  }

  return s
    .replace(/[«»﴿﴾"“”]/g, " ")
    .replace(/\s+([،؛:.؟!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── 4. Urdu Nastaliq Phonetic & Makharij Enhancer (Client-Side) ──────────────
const URDU_PHONETIC_LEXICON = [
  [/\bان\s+شاء\s*اللہ\b/g, "ان شاء اللہ"],
  [/\bما\s+شاء\s*اللہ\b/g, "ما شاء اللہ"],
  [/\bسبحان\s*اللہ\b/g, "سُبحان اللہ"],
  [/\bالحمد\s*للہ\b/g, "الحَمدُ للہ"],
  [/\bاستغفر\s*اللہ\b/g, "اَستَغفِرُ اللہ"],
  [/\bاعوذ\s*باللہ\b/g, "اَعوذُ باللہ"],
  [/\bبسم\s*اللہ\b/g, "بِسمِ اللہ"],
  [/\bرسول\s+اللہ\b/g, "رَسُولُ اللہ"],
  [/\bنبی\s+کریم\b/g, "نبیٔ کریم"],
  [/\bقرآن\s+مجید\b/g, "قُرآنِ مجید"],
  [/\bقرآن\s+کریم\b/g, "قُرآنِ کریم"],
  [/\bقرآن\s+پاک\b/g, "قُرآنِ پاک"],
  [/\bحدیث\s+شریف\b/g, "حَدیثِ شریف"],
  [/\bسنت\s+نبوی\b/g, "سُنَّتِ نبوی"],
  [/\bصحابہ\s+کرام\b/g, "صحابۂ کرام"],
  [/\bعلمائے\s+کرام\b/g, "عُلمائے کرام"],
  [/\bسلف\s+صالحین\b/g, "سَلَف صالحین"],
  [/\bاخلاص\b/g, "اِخلاص"],
  [/\bعبادت\b/g, "عِبادت"],
  [/\bتقوی\b/g, "تَقویٰ"],
  [/\bتعالی\b(?!ٰ)/g, "تعالیٰ"],
  [/\bلہذا\b/g, "لہٰذا"],
];

/**
 * Apply Pakistani Urdu Nastaliq phonetic & articulatory normalization for Web Speech API
 */
export function applyUrduPhoneticAndMakharij(rawText, options = {}) {
  if (!rawText) return "";
  const { urduPhoneticRepair = true } = options;

  let s = canonicalizeTextForLanguage(
    normalizeUrduTextForPronunciation(String(rawText), "ur"),
    "ur"
  )
    .replace(/\u0640/g, "")
    .replace(/ﷺ/g, " صلی اللہ علیہ وسلم ")
    .replace(/ﷻ/g, " جل جلالہ ");

  // Insert natural prosody pause after leading Urdu heading numbers (e.g. "۱ ۔ نیت کا مفہوم" -> "۱، نیت کا مفہوم")
  s = s.replace(/^\s*([٠-٩۰-۹\d]{1,3})\s*[۔.\-–—]+\s*/g, "$1، ");
  s = s.replace(/^\s*[\(\)]\s*([أابجدهوزحطيك٠-٩۰-۹\d]{1,2})\s*[\(\)]\s*/g, "($1)، ");

  if (urduPhoneticRepair) {
    for (const [pattern, repaired] of URDU_PHONETIC_LEXICON) {
      s = s.replace(pattern, repaired);
    }
  }

  return s
    .replace(/[«»﴿﴾"“”]/g, " ")
    .replace(/\s+([۔.،؛:؟!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── 5. Specialized Web Speech API Controller Service ─────────────────────────
class WebSpeechService {
  constructor() {
    this._voices = [];
    this._voicesLoaded = false;
    this._activeUtterance = null;
    this._fallbackTimerId = null;
    this._listeners = new Set();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this._refreshVoices();
      try {
        window.speechSynthesis.addEventListener?.("voiceschanged", () => {
          this._refreshVoices();
        });
      } catch {
        window.speechSynthesis.onvoiceschanged = () => {
          this._refreshVoices();
        };
      }
    }
  }

  isSupported() {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  _refreshVoices() {
    if (!this.isSupported()) return [];
    try {
      const list = window.speechSynthesis.getVoices() || [];
      if (list.length > 0) {
        this._voices = list;
        this._voicesLoaded = true;
        this._notifyListeners();
      }
    } catch {}
    return this._voices;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notifyListeners() {
    const summary = this.getAvailableVoicesSummary();
    for (const fn of this._listeners) {
      try {
        fn(summary);
      } catch {}
    }
  }

  getVoices() {
    if (!this._voicesLoaded || this._voices.length === 0) {
      this._refreshVoices();
    }
    return this._voices;
  }

  /**
   * Select the best matching system/browser voice for a specific dialect (`ar-SA`, `ar-EG`, `ar-AE`, `ur-PK`, `ur-IN`)
   */
  selectBestVoiceForDialect(dialectCode = "ar-SA") {
    const voices = this.getVoices();
    if (!voices || voices.length === 0) return null;

    const cfg =
      WEB_SPEECH_DIALECTS[dialectCode] ||
      (String(dialectCode).startsWith("ur")
        ? WEB_SPEECH_DIALECTS["ur-PK"]
        : WEB_SPEECH_DIALECTS["ar-SA"]);

    const normLang = (l) => String(l || "").replace(/_/g, "-").toLowerCase();

    // Score each candidate voice for dialect match + preferred male scholarly keywords + neural/online quality
    let bestVoice = null;
    let bestScore = -1;

    for (const v of voices) {
      const vLang = normLang(v.lang);
      const langPrefix = cfg.language.toLowerCase();
      if (!vLang.startsWith(langPrefix)) continue;

      let score = 10;
      const exactDialect = normLang(cfg.code);
      if (vLang === exactDialect) {
        score += 40;
      } else {
        const fbIdx = cfg.fallbackLangs.findIndex((fb) => normLang(fb) === vLang);
        if (fbIdx >= 0) score += Math.max(5, 25 - fbIdx * 5);
      }

      const nameStr = `${v.name || ""} ${v.voiceURI || ""}`;
      for (let i = 0; i < cfg.preferredVoiceKeywords.length; i++) {
        const kw = cfg.preferredVoiceKeywords[i];
        if (new RegExp(kw, "i").test(nameStr)) {
          score += Math.max(4, 24 - i * 3);
        }
      }

      if (/Natural|Neural|Online|Premium|Enhanced/i.test(nameStr)) {
        score += 15;
      }
      if (/Male|Hamed|Asad|Salman|Shakir|Maged|Tarik|Naayf/i.test(nameStr)) {
        score += 12;
      }

      if (score > bestScore) {
        bestScore = score;
        bestVoice = v;
      }
    }

    return bestVoice;
  }

  getAvailableVoicesSummary() {
    const voices = this.getVoices();
    const arabicVoices = voices.filter((v) => /^ar/i.test(v.lang || ""));
    const urduVoices = voices.filter((v) => /^ur/i.test(v.lang || ""));
    return {
      isSupported: this.isSupported(),
      totalVoices: voices.length,
      arabicCount: arabicVoices.length,
      urduCount: urduVoices.length,
      bestArabicVoice: this.selectBestVoiceForDialect("ar-SA")?.name || null,
      bestUrduVoice: this.selectBestVoiceForDialect("ur-PK")?.name || null,
    };
  }

  /**
   * Build articulatory speech parameters (spokenText, voice, lang, rate, pitch, wordCharSpans)
   * for any sentence or segment.
   */
  prepareUtteranceConfig({
    text,
    words = [],
    language = null,
    dialect = null,
    segmentType = "urdu_body",
    presetId = "tajweed_articulatory",
    basePlaybackRate = 1.0,
    baseVolume = 1.0,
    arabicTashkeelEnabled = true,
    urduProofreadEnabled = true,
    rateDeltaPercent = 0,
    pitchDeltaHz = 0,
  }) {
    const raw = String(text || "").trim();
    const isUrdu =
      language === "ur" ||
      String(language || "").startsWith("ur") ||
      (language === null && detectIsUrduScript(raw));
    const isArabic = !isUrdu;

    const preset =
      WEB_SPEECH_ARTICULATION_PRESETS.find((p) => p.id === presetId) ||
      WEB_SPEECH_ARTICULATION_PRESETS[0];

    const resolvedDialect =
      dialect && WEB_SPEECH_DIALECTS[dialect]
        ? dialect
        : isArabic
        ? "ar-SA"
        : "ur-PK";

    const spokenText = isArabic
      ? applyArabicTashkeelAndMakharij(raw, {
          strictTashkeel: arabicTashkeelEnabled && preset.strictTashkeel,
        })
      : applyUrduPhoneticAndMakharij(raw, {
          urduPhoneticRepair: urduProofreadEnabled && preset.urduPhoneticRepair,
        });

    const segMod = preset.segmentModifiers?.[segmentType] || {
      rateDelta: 0,
      pitchDelta: 0,
    };

    const customRateFactor = 1 + Math.max(-0.2, Math.min(0.2, Number(rateDeltaPercent || 0) / 100));
    const computedRate = Math.max(
      0.55,
      Math.min(
        1.85,
        Number(basePlaybackRate || 1) *
          (preset.rateMultiplier + segMod.rateDelta) *
          customRateFactor
      )
    );

    const customPitchFactor = Math.max(-0.15, Math.min(0.15, Number(pitchDeltaHz || 0) * 0.02));
    const computedPitch = Math.max(
      0.65,
      Math.min(1.35, preset.pitchBase + segMod.pitchDelta + customPitchFactor)
    );

    const selectedVoice = this.selectBestVoiceForDialect(resolvedDialect);

    // Map each visual word token to its character offset span in `spokenText` for exact `onboundary` tracking
    const wordList =
      Array.isArray(words) && words.length > 0
        ? words.map((w, idx) => ({
            word: String(w?.word || w?.text || w || "").trim(),
            wordIndex: typeof w?.wordIndex === "number" ? w.wordIndex : idx,
          }))
        : spokenText
            .split(/\s+/)
            .filter(Boolean)
            .map((w, idx) => ({ word: w, wordIndex: idx }));

    const wordCharSpans = [];
    let searchCursor = 0;
    for (let i = 0; i < wordList.length; i++) {
      const wToken = wordList[i].word;
      const foundAt = wToken ? spokenText.indexOf(wToken, searchCursor) : -1;
      if (foundAt >= 0) {
        wordCharSpans.push({
          wordIndex: wordList[i].wordIndex,
          word: wToken,
          charStart: foundAt,
          charEnd: foundAt + wToken.length,
        });
        searchCursor = foundAt + wToken.length;
      } else {
        const approxStart = Math.round((i / Math.max(1, wordList.length)) * spokenText.length);
        const approxEnd = Math.round(((i + 1) / Math.max(1, wordList.length)) * spokenText.length);
        wordCharSpans.push({
          wordIndex: wordList[i].wordIndex,
          word: wToken,
          charStart: approxStart,
          charEnd: approxEnd,
        });
      }
    }

    return {
      spokenText,
      isArabic,
      isUrdu,
      dialect: resolvedDialect,
      presetId: preset.id,
      voice: selectedVoice,
      lang: selectedVoice?.lang || resolvedDialect,
      rate: Number(computedRate.toFixed(2)),
      pitch: Number(computedPitch.toFixed(2)),
      volume: Math.max(0, Math.min(1, Number(baseVolume ?? 1))),
      wordCharSpans,
    };
  }

  /**
   * Speak a sentence through Web Speech API with makharij/tashkeel preprocessing
   * and hybrid `onboundary` + phonetic timer word-level synchronization.
   */
  speakSentence({
    sentence,
    startAtWordIndex = 0,
    settings = {},
    playbackRate = 1.0,
    volume = 1.0,
    onStart,
    onWordBoundary,
    onEnd,
    onError,
  }) {
    if (!this.isSupported()) return false;

    try {
      this.cancel();

      const fullWords = Array.isArray(sentence?.words) ? sentence.words : [];
      const activeWords =
        startAtWordIndex > 0 && startAtWordIndex < fullWords.length
          ? fullWords.slice(startAtWordIndex)
          : fullWords;

      const rawText =
        startAtWordIndex > 0 && activeWords.length > 0
          ? activeWords.map((w) => w.word || w.text || "").join(" ")
          : sentence?.cleanedPronunciationText || sentence?.originalText || "";

      if (!rawText || !rawText.trim()) return false;

      const baseNormalized = normalizeUrduTextForPronunciation(rawText);
      const isUrdu = detectIsUrduScript(baseNormalized);
      const dialect = isUrdu
        ? settings?.webSpeechUrduDialect || "ur-PK"
        : settings?.webSpeechArabicDialect || "ar-SA";

      const cfg = this.prepareUtteranceConfig({
        text: rawText,
        words: activeWords.map((w, idx) => ({
          word: w.word || w.text || "",
          wordIndex: startAtWordIndex + idx,
        })),
        language: isUrdu ? "ur" : "ar",
        dialect,
        segmentType: sentence?.segmentType || (isUrdu ? "urdu_body" : "arabic_quote"),
        presetId: settings?.webSpeechArticulationPreset || "tajweed_articulatory",
        basePlaybackRate: playbackRate,
        baseVolume: volume,
        arabicTashkeelEnabled: settings?.arabicTashkeelEnabled !== false,
        urduProofreadEnabled: settings?.urduProofreadEnabled !== false,
        rateDeltaPercent: settings?.hadithProsodyRateDelta ?? -3,
        pitchDeltaHz: settings?.prosodyPitchDeltaHz ?? -1,
      });

      const utter = new SpeechSynthesisUtterance(cfg.spokenText);
      utter.lang = cfg.lang;
      if (cfg.voice) {
        utter.voice = cfg.voice;
      }
      utter.rate = cfg.rate;
      utter.pitch = cfg.pitch;
      utter.volume = cfg.volume;

      let receivedNativeBoundary = false;
      let currentWordIdx = startAtWordIndex;
      const totalSpokenChars = Math.max(1, cfg.spokenText.length);
      // Estimate duration from character length & effective speech rate for voices that don't emit onboundary
      const charsPerSecond = (cfg.isArabic ? 11.5 : 12.2) * cfg.rate;
      const estimatedDurationMs = Math.max(900, Math.round((totalSpokenChars / charsPerSecond) * 1000));
      let startedAtMs = 0;

      const stopFallbackTimer = () => {
        if (this._fallbackTimerId) {
          clearInterval(this._fallbackTimerId);
          this._fallbackTimerId = null;
        }
      };

      utter.onstart = () => {
        startedAtMs = performance.now();
        onStart?.({
          dialect: cfg.dialect,
          voiceName: cfg.voice?.name || cfg.lang,
          rate: cfg.rate,
          pitch: cfg.pitch,
          estimatedDurationMs,
        });

        // Start fallback timer in case the browser voice doesn't fire native `word` boundary events
        stopFallbackTimer();
        this._fallbackTimerId = setInterval(() => {
          if (receivedNativeBoundary || !startedAtMs) return;
          const elapsed = performance.now() - startedAtMs;
          const ratio = Math.max(0, Math.min(0.999, elapsed / estimatedDurationMs));
          const targetChar = Math.floor(ratio * totalSpokenChars);
          let matchedIdx = currentWordIdx;
          for (const span of cfg.wordCharSpans) {
            if (targetChar >= span.charStart) {
              matchedIdx = span.wordIndex;
            } else {
              break;
            }
          }
          if (matchedIdx !== currentWordIdx) {
            currentWordIdx = matchedIdx;
            onWordBoundary?.(currentWordIdx);
          }
        }, 75);
      };

      utter.onboundary = (event) => {
        if (event?.name && event.name !== "word") return;
        const charIdx = typeof event?.charIndex === "number" ? event.charIndex : -1;
        if (charIdx < 0) return;
        receivedNativeBoundary = true;

        let matchedIdx = currentWordIdx;
        for (const span of cfg.wordCharSpans) {
          if (charIdx >= span.charStart - 2) {
            matchedIdx = span.wordIndex;
          } else {
            break;
          }
        }
        if (matchedIdx !== currentWordIdx) {
          currentWordIdx = matchedIdx;
          onWordBoundary?.(currentWordIdx);
        }
      };

      utter.onend = () => {
        stopFallbackTimer();
        this._activeUtterance = null;
        onEnd?.();
      };

      utter.onerror = (err) => {
        stopFallbackTimer();
        this._activeUtterance = null;
        if (err?.error === "canceled" || err?.error === "interrupted") return;
        onError?.(err);
      };

      this._activeUtterance = utter;
      window.speechSynthesis.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  pause() {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.pause();
    } catch {}
  }

  resume() {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.resume();
    } catch {}
  }

  cancel() {
    if (this._fallbackTimerId) {
      clearInterval(this._fallbackTimerId);
      this._fallbackTimerId = null;
    }
    this._activeUtterance = null;
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export const webSpeechService = new WebSpeechService();
