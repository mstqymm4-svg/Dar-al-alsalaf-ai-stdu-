/**
 * DAR AL TAWHID — Intelligent Linguistic Pause, Connected Syntactic Construction Guard,
 * Semantic Completeness, Topic Detection, and Cross-Page Sentence/Paragraph Linker
 *
 * Implements language-specific linguistic analysis for:
 * - Classical & Modern Standard Arabic (ar)
 * - Pakistani Nastaliq Urdu (ur)
 *
 * Core Capabilities:
 * 1. Connected Syntactic Construction Protection (`منع التوقف في منتصف التراكيب اللغوية المتصلة`):
 *    - Arabic: الجار والمجرور، المضاف والمضاف إليه، الصفة والموصوف، الفعل والفاعل، المبتدأ والخبر،
 *      إنّ وكان وأخواتها مع اسمها، أدوات النصب والجزم والشرط مع فعلها، الاسم الموصول وصلته، العطف، النداء.
 *    - Urdu: اسم + حروفِ جار و فاعل (کا/کے/کی/کو/سے/میں/پر/تک/نے...)، اضافتِ فارسی/عربی،
 *      مرکبِ عطفی (و)، صفت و موصوف، فعل + امدادی فعل، نفی + فعل، موصولہ و شرطیہ جملے، مرکباتِ لاحقہ.
 * 2. Intra-Sentence Pause Sanitization (`sanitizeIntraSentenceSyntacticPauses`):
 *    - Automatically strips misplaced PDF commas/pauses inside connected syntactic units so TTS
 *      never pauses unnaturally mid-phrase.
 * 3. Semantic & Syntactic Completeness Evaluation (Arabic & Urdu independent grammars).
 * 4. Smart Clause Merging & Unpunctuated Paragraph Segmentation ONLY at unprotected semantic boundaries.
 * 5. Four-Level Linguistic Pause System:
 *    - none (0ms: اتصال تركيبي أو استمرار عبر الصفحة)
 *    - short_pause (وقف قصير: 150ms)
 *    - medium_pause (وقف متوسط: 350ms)
 *    - long_pause (وقف طويل: 650ms)
 *    - topic_end_pause (وقف نهاية الموضوع: 950ms)
 * 6. Intelligent Topic Detection & Cross-Page Sentence, Paragraph, and Topic Linking.
 */

// ─── Pause Type Definitions ───────────────────────────────────────────────────
export const PAUSE_TYPES = {
  NONE: {
    id: "none",
    labelAr: "اتصال مستمر (تركيب متصل / استمرار الصفحة)",
    durationMs: 0,
  },
  SHORT: {
    id: "short_pause",
    labelAr: "وقف قصير (ترابط معنوي)",
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

// ─── Normalization Helpers ────────────────────────────────────────────────────

function stripArabicDiacriticsAndPunct(word) {
  return String(word || "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\u06C1/g, "\u0647")
    .replace(/\u06A9/g, "\u0643")
    .replace(/\u06CC/g, "\u064A")
    .trim();
}

function stripArabicPunctOnly(word) {
  return String(word || "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .trim();
}

function stripUrduPunct(word) {
  return String(word || "")
    .replace(/[۔.،؛؟!:"'«»﴿﴾\(\)\[\]\{\}—–\-]/g, "")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u0647/g, "\u06C1")
    .trim();
}

function stripUrduDiacriticsAndPunct(word) {
  return stripUrduPunct(word)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .trim();
}

// ─── 1. ARABIC Linguistic Lexicons & Connected Construction Rules ─────────────

// حروف الجر والظروف المضافة (Prepositions & Construct Adverbs)
const ARABIC_PREPOSITIONS_AND_ADVERBS = new Set([
  "من", "الى", "إلى", "عن", "على", "في", "فى", "حتى", "منذ", "مذ", "خلا", "عدا", "حاشا",
  "بين", "عند", "مع", "نحو", "دون", "فوق", "تحت", "قبل", "بعد", "امام", "أمام", "خلف",
  "وراء", "حول", "لدى", "لدن", "عبر", "ضد", "تجاه", "ازاء", "إزاء", "بسبب", "بشان", "بشأن",
  "لاجل", "لأجل", "بغير", "بدون", "مثل", "غير", "سوى", "وسط", "داخل", "خارج",
]);

// النواسخ: إنّ وكان وأخواتهما (Copulas & Emphatic Particles)
const ARABIC_NAWASIKH = new Set([
  "ان", "إن", "أن", "كان", "كأن", "لكن", "ليت", "لعل", "انما", "إنما", "فان", "فإن", "وان", "وإن",
  "لان", "لأن", "بان", "بأن", "كانما", "كأنما", "الا", "ألا", "إلا",
  "كانت", "يكون", "تكون", "كانوا", "يكونون", "كنت", "كنا", "ليس", "ليست", "ليسوا", "لست",
  "اصبح", "أصبح", "اصبحت", "أصبحت", "يصبح", "تصبح", "اضحى", "أضحى", "ظل", "ظلت", "يظل",
  "امسى", "أمسى", "بات", "صار", "صارت", "يصير", "مازال", "لازال", "مايزال", "لايزال",
]);

// أدوات النصب والجزم والشرط والاستفهام والنفي والتسويف (Particles binding tightly to following verb/clause)
const ARABIC_VERB_BINDING_PARTICLES = new Set([
  "لن", "كي", "لكي", "لم", "لما", "لا", "ما", "قد", "لقد", "سوف",
  "اذا", "إذا", "اذ", "إذ", "لو", "لولا", "لوما", "كلما", "حيث", "حيثما", "مهما", "اينما", "أينما",
  "متى", "اين", "أين", "كيف", "هل", "كم", "ماذا", "لماذا", "اي", "أي", "اما", "إما", "أما",
]);

// حروف العطف (Coordinating Conjunctions)
const ARABIC_COORDINATORS = new Set([
  "و", "ف", "ثم", "او", "أو", "ام", "أم", "بل", "لكن", "حتى",
]);

// الأسماء الموصولة وأسماء الإشارة والضمائر المنفصلة (Relative Pronouns, Demonstratives, Subject Pronouns)
const ARABIC_RELATIVES_AND_DEMONSTRATIVES = new Set([
  "الذي", "التي", "الذين", "اللاتي", "اللائي", "اللذان", "اللتان", "اللذين", "اللتين", "من", "ما",
  "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "اولئك", "أولئك", "ذانك", "تانك", "هذان", "هاتان",
  "هو", "هي", "هم", "هن", "هما", "انا", "أنا", "نحن", "انت", "أنت", "انتم", "أنتم", "انتن", "أنتن",
]);

// المضافات الشائعة في الكتب الشرعية (Construct Heads requiring Mudaf Ilayh)
const ARABIC_COMMON_MUDAF_HEADS = new Set([
  "عبد", "ابن", "بن", "ابو", "أبو", "ابي", "أبي", "ابا", "أبا", "ام", "أم", "اخو", "أخو", "اخي", "أخي",
  "ذو", "ذي", "ذا", "ذات", "ذوي", "اولي", "أولي", "اولو", "أولو",
  "كل", "بعض", "جميع", "كلا", "كلتا", "معظم", "اكثر", "أكثر", "اقل", "أقل", "سائر", "اول", "أول", "اخر", "آخر",
  "نفس", "عين", "مثل", "غير", "سوى", "شبه", "قدر", "مقدار", "عدد", "نوع", "انواع", "أنواع", "قسم", "اقسام", "أقسام",
  "رسول", "نبي", "كتاب", "سنة", "حديث", "قول", "كلام", "سورة", "اية", "آية", "اهل", "أهل", "سبيل", "دين",
  "امر", "أمر", "نهي", "حق", "حقوق", "حكم", "احكام", "أحكام", "شرط", "شروط", "ركن", "اركان", "أركان",
  "اصل", "أصل", "اصول", "أصول", "معنى", "تفسير", "شرح", "بيان", "فائدة", "ثمرة", "نتيجة", "سبب", "اسباب", "أسباب",
  "باب", "فصل", "مبحث", "مطلب", "مسالة", "مسألة", "قاعدة", "صحيح", "سنن", "مسند", "موطا", "موطأ",
  "ذكر", "شكر", "طاعة", "عبادة", "محبة", "خوف", "رجاء", "خشية", "تقوى", "اخلاص", "إخلاص", "توحيد", "ايمان", "إيمان",
  "صلاة", "زكاة", "صيام", "حج", "جهاد", "دعاء", "تلاوة", "قراءة", "طلب", "علم", "عمل", "قلب", "قلوب",
  "يوم", "ليلة", "شهر", "سنة", "وقت", "ساعة", "مكان", "موضع", "دار", "عذاب", "رحمة", "فضل", "نعمة", "غضب", "رضا",
  "قوله", "كقوله", "لقوله", "بقوله", "فيما", "مما", "عما",
]);

// أفعال شائعة ترتبط بفاعلها أو مفعولها المباشر (Common Arabic Verbs binding to immediate Subject/Object)
const ARABIC_BOUND_VERBS = new Set([
  "قال", "قالت", "يقول", "تقول", "قالوا", "روى", "روت", "يروي", "اخرج", "أخرج", "حدثنا", "اخبرنا", "أخبرنا",
  "سمعت", "سمع", "رايت", "رأيت", "امر", "أمر", "يامر", "يأمر", "نهى", "ينهى", "خلق", "يخلق", "جعل", "يجعل",
  "ذكر", "يذكر", "بين", "بيّن", "يبين", "اشار", "أشار", "علم", "يعلم", "اعلم", "أعلم", "عرف", "يعرف",
  "يجب", "ينبغي", "يلزم", "يصح", "يجوز", "يحرم", "يكره", "يستحب", "يشرع", "ينفع", "يضر", "يدل", "يقتضي",
  "اراد", "أراد", "يريد", "شاء", "يشاء", "استطاع", "يستطيع", "يمكن", "ينبغى", "ثبت", "ورد", "جاء", "صح",
]);

// أدوات النداء (Vocatives)
const ARABIC_VOCATIVES = new Set(["يا", "ايها", "أيها", "ايتها", "أيتها", "ايا", "أيا", "هيا"]);

// كلمات لا يجوز أن تنتهي بها جملة عربية مكتملة المعنى
const ARABIC_INCOMPLETE_ENDING_WORDS = new Set([
  ...ARABIC_PREPOSITIONS_AND_ADVERBS,
  ...ARABIC_NAWASIKH,
  ...ARABIC_VERB_BINDING_PARTICLES,
  ...ARABIC_COORDINATORS,
  ...ARABIC_RELATIVES_AND_DEMONSTRATIVES,
  ...ARABIC_VOCATIVES,
  "قال", "يقول", "قالت", "قالوا", "قوله", "كقوله", "لقوله", "روى", "حدثنا", "اخبرنا", "أخبرنا", "سمعت",
  "بن", "ابن", "عبد", "ابو", "أبو", "ابي", "أبي", "ابا", "أبا", "ذو", "ذي", "ذا", "ذات",
  "غير", "سوى", "مثل", "كل", "بعض", "جميع", "كلا", "كلتا", "نفس", "عين",
]);

const ARABIC_ATTRIBUTION_ENDING_REGEX =
  /(?:قال(?:\s+الله)?(?:\s+تعالى)?|يقول(?:\s+الله)?(?:\s+تعالى)?|قوله(?:\s+تعالى)?|قال\s+رسول\s+الله(?:\s+ﷺ|\s+صلى\s+الله\s+عليه\s+وسلم)?|قال\s+النبي(?:\s+ﷺ|\s+صلى\s+الله\s+عليه\s+وسلم)?|وفي\s+الحديث|ومنها\s+قوله|كقوله|لقوله|عن\s+النبي(?:\s+ﷺ)?|أنه\s+قال)\s*[:：،\-–—]*$/;

const ARABIC_TOPIC_SHIFT_REGEX =
  /^(?:الباب\s|الفصل\s|المبحث\s|المطلب\s|المسألة\s|القاعدة\s|الفرع\s|تنبيه\s*[:：۔.\-]|فائدة\s*[:：۔.\-]|فصل\s+في\b|مسألة\s*[:：۔.\-]|خاتمة\b|مقدمة\b|تمهيد\b|أولاً\s*[:：\-]|ثانياً\s*[:：\-]|ثالثاً\s*[:：\-]|رابعاً\s*[:：\-]|خامساً\s*[:：\-]|[٠-٩\d]{1,2}\s*[-–—.]\s+\S+)/;

// ─── 2. URDU Linguistic Lexicons & Connected Construction Rules ───────────────

// حروفِ جار، اضافت اور فاعلی علامات (Urdu Postpositions — tightly bind to the PRECEDING noun/pronoun!)
const URDU_POSTPOSITIONS = new Set([
  "کا", "کے", "کی", "کو", "سے", "میں", "پر", "تک", "نے",
  "لیے", "لئے", "واسطے", "ساتھ", "بغیر", "ذریعے", "ذریعہ", "تحت", "مطابق", "خلاف",
  "بعد", "پہلے", "قبل", "اندر", "باہر", "اوپر", "نیچے", "آگے", "پیچھے", "درمیان",
  "نزدیک", "قریب", "پاس", "طرف", "جانب", "باعث", "سبب", "وجہ", "بارے", "تئیں", "بابت", "متعلق", "علاوہ", "سوا", "مانند", "طرح",
]);

// حروفِ اضافت جو اگلے اسم سے جڑتے ہیں (Genitive postpositions binding to FOLLOWING head noun too)
const URDU_GENITIVE_HEAD_BINDERS = new Set(["کا", "کے", "کی", "والا", "والے", "والی"]);

// اردو امدادی و ناقص افعال (Urdu Auxiliaries & Vector Verbs — bind tightly to PRECEDING main verb stem/participle!)
const URDU_AUXILIARY_VERBS = new Set([
  "ہے", "ہیں", "تھا", "تھے", "تھی", "تھیں", "ہو", "ہوں", "ہوگا", "ہوگی", "گا", "گے", "گی",
  "گیا", "گئی", "گئے", "جاتا", "جاتے", "جاتی", "جائے", "جائیں", "جانا", "جانے",
  "رہا", "رہے", "رہی", "رہتا", "رہتے", "رہتی", "رہے گا",
  "سکتا", "سکتے", "سکتی", "سکتیں", "سکے", "سکیں", "سکا", "سکی",
  "چکا", "چکے", "چکی", "چکیں", "پڑا", "پڑی", "پڑے", "پڑتا", "پڑتے", "پڑتی",
  "چاہیے", "چاہئے", "چاہئیں", "دیا", "دی", "دیے", "دئے", "دیتا", "دیتے", "دیتی", "دے", "دیں",
  "لیا", "لی", "لیے", "لیتا", "لیتے", "لیتی", "لے", "لیں",
  "رکھا", "رکھی", "رکھے", "رکھتا", "رکھتے", "رکھتی", "آیا", "آئی", "آئے", "آتا", "آتے", "آتی",
  "ڈالا", "ڈالی", "ڈالے", "بیٹھا", "بیٹھی", "بیٹھے", "اٹھا", "اٹھی", "اٹھے",
]);

// اردو فعل کے ابتدائی اجزاء / اسمِ حالیہ / مصدر (Urdu Verb Stems & Participles requiring following auxiliary/light verb)
const URDU_VERB_STEMS_AND_PARTICIPLES = new Set([
  "کر", "کیا", "کیے", "کئے", "کرتا", "کرتے", "کرتی", "کرنا", "کرنے", "کرنی", "کرکے",
  "ہو", "ہوا", "ہوئے", "ہوئی", "ہوتا", "ہوتے", "ہوتی", "ہونا", "ہونے", "ہوکر",
  "جا", "جاتا", "جاتے", "جاتی", "جانا", "جانے", "گیا", "گئے", "گئی",
  "دے", "دیا", "دیتا", "دیتے", "دیتی", "دینا", "دینے",
  "لے", "لیا", "لیتا", "لیتے", "لیتی", "لینا", "لینے",
  "رہا", "رہے", "رہی", "رہتا", "رہتے", "رہتی", "رہنا", "رہنے",
  "سکتا", "سکتے", "سکتی", "چکا", "چکے", "چکی", "پڑتا", "پڑتے", "پڑتی", "پڑا", "پڑے", "پڑی",
  "فرما", "فرمایا", "فرماتے", "فرماتی", "فرمانا", "کہا", "کہتے", "کہتی", "کہنا",
  "لکھا", "لکھتے", "لکھتی", "پڑھا", "پڑھتے", "پڑھتا", "سنا", "سنتے", "دیکھا", "دیکھتے",
  "بتایا", "بتاتے", "سمجھایا", "سمجھتے", "بنایا", "بناتے", "رکھا", "رکھتے", "رکھتا",
  "آیا", "آتے", "آتا", "لایا", "لاتے", "پایا", "پاتے", "چاہتا", "چاہتے", "چاہتی",
  "ملتا", "ملتے", "ملتی", "ملا", "ملی", "ملے", "دکھاتا", "دکھاتے", "بڑھاتا", "بڑھاتے",
  "عطا", "بیان", "ادا", "حاصل", "ثابت", "ظاہر", "داخل", "خارج", "شامل", "قائم", "مکمل", "واضح", "لازم", "واجب", "فرض", "حرام", "جائز", "ممنوع",
]);

// اردو اسمائے اشارہ و صفاتِ ابتدائی (Demonstratives, Quantifiers & Modifiers binding to FOLLOWING noun)
const URDU_MODIFIERS_AND_DETERMINERS = new Set([
  "یہ", "وہ", "اس", "ان", "اسی", "انہی", "ایسا", "ایسے", "ایسی",
  "ہر", "کچھ", "کوئی", "تمام", "سب", "بعض", "کئی", "چند", "سارے", "سارا", "ساری",
  "ایک", "دو", "تین", "چار", "پانچ", "پہلا", "پہلے", "پہلی", "دوسرا", "دوسرے", "دوسری", "تیسرا", "تیسرے", "تیسری",
  "اچھا", "اچھے", "اچھی", "برا", "برے", "بری", "بڑا", "بڑے", "بڑی", "چھوٹا", "چھوٹے", "چھوٹی",
  "سچا", "سچے", "سچی", "خالص", "مکمل", "صحیح", "عظیم", "اہم", "خاص", "عام", "پاک", "مبارک", "کریم", "عظیم",
  "اپنا", "اپنے", "اپنی", "میرا", "میرے", "میری", "تمہارا", "تمہارے", "تمہاری", "ہمارا", "ہمارے", "ہماری",
]);

// اردو حروفِ نفی (Negation particles binding tightly to verb/predicate)
const URDU_NEGATIONS = new Set(["نہ", "نہیں", "مت", "ہرگز"]);

// اردو حروفِ عطف، شرط، علت و موصول (Subordinators & Conjunctions)
const URDU_SUBORDINATORS_AND_CONJUNCTIONS = new Set([
  "اور", "یا", "نیز", "و", "کہ", "کیونکہ", "چونکہ", "تاکہ", "اگر", "اگرچہ", "مگر", "لیکن", "بلکہ", "تاہم",
  "جب", "جہاں", "جیسے", "جو", "جس", "جن", "جنہوں", "جسے", "جنہیں", "جتنا", "جتنے", "جتنی", "جوں", "جبکہ", "حالانکہ",
]);

// اردو لاحقے (Compound suffixes binding to preceding stem)
const URDU_COMPOUND_SUFFIXES = new Set([
  "دار", "مند", "گاہ", "خانہ", "انگیز", "آمیز", "بخش", "شناس", "پرست", "پسند", "زدہ", "نامہ", "وار", "کار", "گر",
]);

// حروفِ تاکید و تخصیص (Emphatic particles "بھی / ہی / تو" binding to preceding word)
const URDU_CLITICS = new Set(["بھی", "ہی"]);

const URDU_INCOMPLETE_ENDING_WORDS = new Set([
  ...URDU_POSTPOSITIONS,
  ...URDU_SUBORDINATORS_AND_CONJUNCTIONS,
  ...URDU_MODIFIERS_AND_DETERMINERS,
  ...URDU_NEGATIONS,
  "کر", "ہو", "بنا", "لگا", "رہا", "رہے", "رہی", "عطا", "بیان", "حاصل",
]);

const URDU_FINITE_CLAUSE_END_REGEX =
  /(?:ہے|ہیں|تھا|تھے|تھی|تھیں|ہو|ہوں|ہوگا|ہوگی|ہوں\s+گے|ہو\s+گی|چاہیے|چاہئے|چاہئیں|گیا|گئی|گئے|رہا|رہی|رہے|سکے|سکتا|سکتے|سکتی|سکتیں|فرمایا|فرماتے|کہا|کہتے|کیا|کی|کیے|کئے|دیا|دی|دیے|دئے|لیا|لی|لیے|پایا|پائی|لایا|آیا|آئے|آئی|بنایا|بتایا|سمجھایا|لکھا|پڑھا|سنا|دیکھا|رکھا|چھوڑا|ڈالا|نکالا|پہنچا|چکا|چکی|چکے|پڑا|پڑی|پڑے|جائے|جائیں|جاتا|جاتے|جاتی|ہوتا|ہوتے|ہوتی|کرتا|کرتے|کرتی|رہتا|رہتے|رہتی|ﷺ|رحمہ\s+اللہ|رضی\s+اللہ\s+عنہ|رضی\s+اللہ\s+عنہم|تعالیٰ)\s*[۔.؟!﴾»"”\)]*$/;

const URDU_ATTRIBUTION_ENDING_REGEX =
  /(?:فرمایا(?:\s+کہ)?|فرماتے\s+ہیں(?:\s+کہ)?|ارشاد\s+ہے(?:\s+کہ)?|ارشاد\s+باری\s+تعالیٰ\s+ہے(?:\s+کہ)?|فرمان\s+ہے(?:\s+کہ)?|کہا(?:\s+کہ)?|کہتے\s+ہیں(?:\s+کہ)?|لکھتے\s+ہیں(?:\s+کہ)?|بیان\s+کیا(?:\s+کہ)?|روایت\s+ہے(?:\s+کہ)?|حدیث\s+میں\s+ہے(?:\s+کہ)?)\s*[:：،\-–—]*$/;

const URDU_TOPIC_SHIFT_REGEX =
  /^(?:باب\s|فصل\s|پہلی\s+فصل|دوسری\s+فصل|تیسری\s+فصل|چوتھی\s+فصل|پہلی\s+بات|دوسری\s+بات|تیسری\s+بات|چوتھی\s+بات|پہلا\s+طریقہ|دوسرا\s+طریقہ|تیسرا\s+طریقہ|خلاصہ\s+کلام|تنبیہ\s*[:：۔.\-]|فائدہ\s*[:：۔.\-]|قاعدہ\s*[:：۔.\-]|مسئلہ\s*[:：۔.\-]|[٠-٩۰-۹\d]{1,2}\s*[۔\-–.]\s+\S+)/;

// ─── 3. Connected Syntactic Construction Analyzer (Arabic & Urdu) ─────────────

/**
 * Evaluate whether two adjacent tokens `(prevRaw, nextRaw)` form a tightly connected
 * Arabic syntactic construction (`تركيب لغوي عربي متصل`) that MUST NOT be broken by a pause or split.
 */
export function evaluateArabicSyntacticBond(prevRaw, nextRaw) {
  if (!prevRaw || !nextRaw) return { isConnected: false, type: null };

  // Hard sentence terminator on prevRaw breaks syntactic bond (except colon which may introduce a connected quote)
  if (/[۔.؟!﴾»]$/.test(prevRaw.trim())) {
    return { isConnected: false, type: null };
  }

  const prev = stripArabicDiacriticsAndPunct(prevRaw);
  const next = stripArabicDiacriticsAndPunct(nextRaw);
  const prevExact = stripArabicPunctOnly(prevRaw);
  const nextExact = stripArabicPunctOnly(nextRaw);
  if (!prev || !next) return { isConnected: false, type: null };

  // 1. الجار والمجرور / الظرف والمضاف إليه
  if (ARABIC_PREPOSITIONS_AND_ADVERBS.has(prev) || ARABIC_PREPOSITIONS_AND_ADVERBS.has(prevExact)) {
    return { isConnected: true, type: "jar_wa_majrur" };
  }

  // 2. النواسخ مع اسمها (إنّ / كان وأخواتها)
  if (ARABIC_NAWASIKH.has(prev) || ARABIC_NAWASIKH.has(prevExact)) {
    return { isConnected: true, type: "nasikh_wa_ism" };
  }

  // 3. أدوات النصب والجزم والشرط والاستفهام والنفي مع فعلها
  if (ARABIC_VERB_BINDING_PARTICLES.has(prev) || ARABIC_VERB_BINDING_PARTICLES.has(prevExact)) {
    return { isConnected: true, type: "adat_wa_fil" };
  }

  // 4. النداء والمنادى
  if (ARABIC_VOCATIVES.has(prev) || ARABIC_VOCATIVES.has(prevExact)) {
    return { isConnected: true, type: "nida_wa_munada" };
  }

  // 5. الأسماء الموصولة وأسماء الإشارة والضمائر مع ما بعدها (المبتدأ والخبر / الموصول وصلته)
  if (ARABIC_RELATIVES_AND_DEMONSTRATIVES.has(prev) || ARABIC_RELATIVES_AND_DEMONSTRATIVES.has(prevExact)) {
    return { isConnected: true, type: "mubtada_or_mawsool" };
  }

  // 6. حروف العطف مع المعطوف
  if (ARABIC_COORDINATORS.has(prev) || ARABIC_COORDINATORS.has(prevExact)) {
    return { isConnected: true, type: "atf_wa_matuf" };
  }

  // 7. المضاف والمضاف إليه (Explicit scholarly/classical Mudaf heads OR indefinite noun + definite ال... noun)
  if (ARABIC_COMMON_MUDAF_HEADS.has(prev) || ARABIC_COMMON_MUDAF_HEADS.has(prevExact)) {
    return { isConnected: true, type: "mudaf_wa_mudaf_ilayh" };
  }
  if (
    prev.length >= 2 &&
    !prev.startsWith("ال") &&
    !prev.startsWith("وال") &&
    !prev.startsWith("بال") &&
    !prev.startsWith("لل") &&
    (next.startsWith("ال") || next === "الله" || next === "لله") &&
    !ARABIC_BOUND_VERBS.has(prev)
  ) {
    return { isConnected: true, type: "mudaf_wa_mudaf_ilayh" };
  }

  // 8. الصفة والموصوف (Definite + Definite, or Divine/Prophetic Honorifics)
  if (
    (prev === "الله" || prev === "لله" || prev === "بالله") &&
    /^(?:تعالى|سبحانه|عز|جل|الرحمن|الرحيم|تبارك)$/.test(next)
  ) {
    return { isConnected: true, type: "sifa_wa_mawsuf" };
  }
  if (prev === "عز" && next === "وجل") {
    return { isConnected: true, type: "sifa_wa_mawsuf" };
  }
  if (prev === "صلى" && next === "الله") {
    return { isConnected: true, type: "honorific_chain" };
  }
  if (prev === "عليه" && (next === "وسلم" || next === "السلام" || next === "الصلاة")) {
    return { isConnected: true, type: "honorific_chain" };
  }
  if ((prev === "رضي" || prev === "رحمه" || prev === "رحمهم") && next === "الله") {
    return { isConnected: true, type: "honorific_chain" };
  }
  if (
    prev.length >= 4 &&
    next.length >= 4 &&
    (prev.startsWith("ال") || prev.startsWith("بال") || prev.startsWith("لل")) &&
    next.startsWith("ال")
  ) {
    return { isConnected: true, type: "sifa_wa_mawsuf" };
  }

  // 9. الفعل والفاعل المتصل (Bound verb + immediate nominal/pronominal subject)
  if (ARABIC_BOUND_VERBS.has(prev) || ARABIC_BOUND_VERBS.has(prevExact)) {
    if (!next.startsWith("و") || next === "والله") {
      return { isConnected: true, type: "fil_wa_fail" };
    }
  }

  // 10. أسماء الأعلام والنسب (ابن / بن)
  if (next === "بن" || next === "ابن") {
    return { isConnected: true, type: "alam_wa_nasab" };
  }

  return { isConnected: false, type: null };
}

/**
 * Evaluate whether two adjacent tokens `(prevRaw, nextRaw)` form a tightly connected
 * Pakistani Urdu syntactic construction (`اردو متصل ترکیب`) that MUST NOT be broken by a pause or split.
 */
export function evaluateUrduSyntacticBond(prevRaw, nextRaw) {
  if (!prevRaw || !nextRaw) return { isConnected: false, type: null };

  if (/[۔.؟!﴾»]$/.test(prevRaw.trim())) {
    return { isConnected: false, type: null };
  }

  const prevWithMarks = stripUrduPunct(prevRaw);
  const prev = stripUrduDiacriticsAndPunct(prevRaw);
  const next = stripUrduDiacriticsAndPunct(nextRaw);
  if (!prev || !next) return { isConnected: false, type: null };

  // 1. اسم/ضمیر + حرفِ جار یا فاعلی علامت (Noun + Postposition: اللہ نے، دل میں، ایمان کا، اس کے، ان پر...)
  if (URDU_POSTPOSITIONS.has(next)) {
    return { isConnected: true, type: "ism_wa_harf_jar" };
  }

  // 2. حرفِ اضافت یا فاعلی/ظرفی حرف + اگلا اسم یا فعل (کا حکم، نے فرمایا، میں ہوتا، پر عمل)
  if (URDU_GENITIVE_HEAD_BINDERS.has(prev)) {
    return { isConnected: true, type: "izafat_harf_wa_ism" };
  }
  if (
    (prev === "نے" || prev === "میں" || prev === "پر" || prev === "کو" || prev === "سے") &&
    (URDU_VERB_STEMS_AND_PARTICIPLES.has(next) || URDU_AUXILIARY_VERBS.has(next))
  ) {
    return { isConnected: true, type: "postposition_wa_fil" };
  }

  // 2b. فعلِ مرکب (Conjunct Verb: اسم + کرنا/کیا/ہونا/ہوتا/دینا/لینا e.g. عمل کیا، بیان کیا، عطا کیا، پیدا ہوتا)
  if (
    (next === "کیا" ||
      next === "کیے" ||
      next === "کئے" ||
      next === "کرتا" ||
      next === "کرتے" ||
      next === "کرتی" ||
      next === "کرنا" ||
      next === "کرنے" ||
      next === "کر" ||
      next === "ہوتا" ||
      next === "ہوتے" ||
      next === "ہوتی" ||
      next === "ہوا" ||
      next === "ہوئے" ||
      next === "ہوئی" ||
      next === "ہونا" ||
      next === "ہونے" ||
      next === "فرمایا" ||
      next === "فرماتے") &&
    !URDU_SUBORDINATORS_AND_CONJUNCTIONS.has(prev)
  ) {
    return { isConnected: true, type: "conjunct_verb_phrase" };
  }

  // 3. اضافتِ فارسی و عربی (زیرِ اضافت ِ یا ہمزہ اضافت ۂ / ئے: اہلِ سنت، رسولِ اکرم، کلمۂ توحید، علمائے کرام)
  if (/[\u0650\u06C2]$/.test(prevWithMarks) || /ئے$/.test(prev)) {
    return { isConnected: true, type: "izafat_farsi" };
  }

  // 4. مرکبِ عطفی (Noun + و + Noun: قرآن و سنت، ایمان و عمل، دنیا و آخرت)
  if (prev === "و" || next === "و") {
    return { isConnected: true, type: "murakkab_atfi" };
  }

  // 5. فعل + امدادی فعل / مرکب فعل (Main Verb/Participle + Auxiliary/Vector Verb: کر رہا ہے، عطا کیا جاتا ہے، ہو سکتا ہے)
  if (URDU_AUXILIARY_VERBS.has(next)) {
    return { isConnected: true, type: "fil_wa_imdadi_fil" };
  }
  if (URDU_VERB_STEMS_AND_PARTICIPLES.has(prev) && !URDU_SUBORDINATORS_AND_CONJUNCTIONS.has(next)) {
    return { isConnected: true, type: "fil_wa_imdadi_fil" };
  }

  // 6. نفی + فعل / صفت (نہ، نہیں، مت، ہرگز + verb/auxiliary)
  if (URDU_NEGATIONS.has(prev)) {
    return { isConnected: true, type: "nafi_wa_fil" };
  }

  // 7. اسمِ اشارہ / صفتِ عددی و مقداری + موصوف (یہ بات، اس شخص، ہر مسلمان، تمام اعمال، ایک حدیث)
  if (URDU_MODIFIERS_AND_DETERMINERS.has(prev) && !URDU_SUBORDINATORS_AND_CONJUNCTIONS.has(next)) {
    return { isConnected: true, type: "sifat_wa_mawsuf" };
  }

  // 8. حروفِ تاکید و تخصیص (بھی / ہی: وہ بھی، اس میں ہی)
  if (URDU_CLITICS.has(next)) {
    return { isConnected: true, type: "clitic_emphasis" };
  }

  // 9. مرکبِ لاحقہ (ایمان دار، عقل مند، عبادت گاہ، شفا خانہ)
  if (URDU_COMPOUND_SUFFIXES.has(next)) {
    return { isConnected: true, type: "murakkab_lahiqa" };
  }

  // 10. تعظیمی و شرعی القاب (اللہ تعالیٰ، رسول اللہ، نبی کریم، صلی اللہ علیہ وسلم، رضی اللہ عنہ، رحمہ اللہ)
  if (
    (prev === "اللہ" && /^(?:تعالیٰ|تعالی|عزوجل|سبحانہ|جل)$/.test(next)) ||
    ((prev === "رسول" || prev === "نبی" || prev === "رضی" || prev === "رحمہ" || prev === "صلی") &&
      /^(?:اللہ|کریم|اکرم|ﷺ|علیہ)$/.test(next)) ||
    (prev === "علیہ" && /^(?:وسلم|السلام|الصلوٰۃ)$/.test(next)) ||
    (prev === "اللہ" && /^(?:عنہ|عنہا|عنہم|عنہما)$/.test(next))
  ) {
    return { isConnected: true, type: "honorific_chain" };
  }

  // 11. حروفِ شرط و ربط کا اگلے لفظ سے اتصال (اگر + ..., جب + ..., جو + ..., تاکہ + ...)
  if (
    prev === "اگر" ||
    prev === "جب" ||
    prev === "جو" ||
    prev === "جس" ||
    prev === "جن" ||
    prev === "جہاں" ||
    prev === "تاکہ" ||
    prev === "کیونکہ" ||
    prev === "چونکہ" ||
    prev === "کہ"
  ) {
    return { isConnected: true, type: "subordinator_head" };
  }

  return { isConnected: false, type: null };
}

/**
 * Language-dispatched syntactic bond evaluator between two adjacent tokens.
 */
export function evaluateSyntacticBond(prevToken, nextToken, language = "ur") {
  if (language === "ar" || language === "ar-SA") {
    return evaluateArabicSyntacticBond(prevToken, nextToken);
  }
  return evaluateUrduSyntacticBond(prevToken, nextToken);
}

/**
 * Analyze all connected syntactic constructions inside a sentence.
 * Returns the list of protected token-pair indices `(index -> index+1)` where pauses/splits are forbidden.
 */
export function analyzeConnectedSyntacticConstructions(text, language = "ur") {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      tokens: [],
      protectedBoundaries: new Set(),
      constructions: [],
    };
  }

  const tokens = clean.split(/\s+/).filter(Boolean);
  const protectedBoundaries = new Set();
  const constructions = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const bond = evaluateSyntacticBond(tokens[i], tokens[i + 1], language);
    if (bond.isConnected) {
      protectedBoundaries.add(i);
      constructions.push({
        index: i,
        left: tokens[i],
        right: tokens[i + 1],
        type: bond.type,
      });
    }
  }

  return {
    tokens,
    protectedBoundaries,
    constructions,
  };
}

/**
 * Check if a boundary between `leftText` (end of sentence/clause A) and `rightText` (start of sentence/clause B)
 * cuts through the middle of a connected syntactic construction (`تركيب لغوي متصل`) or an unresolved correlative clause.
 */
export function isBoundaryProtectedByConnectedConstruction(
  leftText,
  rightText,
  language = "ur"
) {
  const left = String(leftText || "")
    .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
    .trim();
  const right = String(rightText || "").trim();
  if (!left || !right) return { isProtected: false, reason: null };

  // Never override a genuine strong sentence terminator (full stop / question / exclamation / closing Quran/Hadith bracket)
  if (/[۔.؟!﴾»]$/.test(left)) {
    return { isProtected: false, reason: null };
  }

  const leftTokens = left.split(/\s+/).filter(Boolean);
  const rightTokens = right.split(/\s+/).filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return { isProtected: false, reason: null };
  }

  const lastLeft = leftTokens[leftTokens.length - 1];
  const firstRight = rightTokens[0];

  // 1. Direct adjacent syntactic bond (e.g., Mudaf + Mudaf Ilayh, Jar + Majrur, Noun + Postposition, Verb + Auxiliary)
  const bond = evaluateSyntacticBond(lastLeft, firstRight, language);
  if (bond.isConnected) {
    return { isProtected: true, reason: bond.type };
  }

  // 2. Unresolved Correlative / Conditional Clause across boundary
  if (language === "ur" || language === "ur-PK") {
    const leftNorm = stripUrduDiacriticsAndPunct(left);
    const rightFirst = stripUrduDiacriticsAndPunct(firstRight);
    // e.g. "اگر کوئی شخص اخلاص کے ساتھ عمل کرے" | "تو اللہ اسے..."
    if (
      (/(?:^|\s)(?:اگر|جب|جوں|جیسے)\s/.test(leftNorm) && rightFirst === "تو") ||
      (/(?:^|\s)(?:جو|جس|جن)\s/.test(leftNorm) && /^(?:وہ|اس|ان|اسے|انہیں|تو)$/.test(rightFirst)) ||
      (/(?:^|\s)چونکہ\s/.test(leftNorm) && /^(?:اس|لہٰذا|لہذا|چنانچہ|تو)$/.test(rightFirst)) ||
      (/(?:^|\s)(?:اگرچہ|گو|حالانکہ)\s/.test(leftNorm) && /^(?:مگر|لیکن|تاہم|پھر)$/.test(rightFirst))
    ) {
      return { isProtected: true, reason: "correlative_clause_pair" };
    }
  } else {
    const leftNorm = stripArabicDiacriticsAndPunct(left);
    const rightFirst = stripArabicDiacriticsAndPunct(firstRight);
    // Arabic conditional protasis + apodosis (`إذا/إن/لو/من ... فـ...` or `لـ...`)
    if (
      (/(?:^|\s)(?:اذا|ان|لو|من|مهما|كلما)\s/.test(leftNorm) &&
        /^(?:ف|ل|كان|فان|فقد|فلا|فانه|فانها|فهو|فهي)/.test(rightFirst)) ||
      (/(?:^|\s)اما\s/.test(leftNorm) && /^ف/.test(rightFirst))
    ) {
      return { isProtected: true, reason: "arabic_conditional_apodosis" };
    }
  }

  return { isProtected: false, reason: null };
}

/**
 * Sanitize intra-sentence punctuation for TTS so misplaced commas (`،` / `,`) or colons
 * extracted inside connected Arabic or Urdu syntactic constructions NEVER cause unnatural mid-phrase pauses!
 *
 * Example (Urdu):  "اللہ، کے رسول، نے فرمایا" -> "اللہ کے رسول نے فرمایا"
 * Example (Arabic): "قال، رسول، الله في، الحديث" -> "قال رسول الله في الحديث"
 */
export function sanitizeIntraSentenceSyntacticPauses(text, language = "ur") {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      text: "",
      removedPauseCount: 0,
      protectedConstructionCount: 0,
    };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return {
      text: raw,
      removedPauseCount: 0,
      protectedConstructionCount: 0,
    };
  }

  let removedPauseCount = 0;
  let protectedConstructionCount = 0;
  const outputTokens = [...tokens];

  for (let i = 0; i < outputTokens.length - 1; i++) {
    const curr = outputTokens[i];
    const next = outputTokens[i + 1];

    // Check if `curr` ends with a soft pause mark (comma / Arabic comma / stray dash)
    const hasSoftComma = /[،,]$/.test(curr);
    const currWithoutSoftComma = hasSoftComma ? curr.replace(/[،,]+$/, "") : curr;

    const bond = evaluateSyntacticBond(currWithoutSoftComma, next, language);

    // Also protect 3-token Arabic Nasikh + Ism + Khabar chains (e.g. "إن الله، يحب" -> "إن الله يحب")
    const prevBareAr =
      i > 0 && (language === "ar" || language === "ar-SA")
        ? stripArabicDiacriticsAndPunct(outputTokens[i - 1])
        : "";
    const isArabicNasikhPredicateBond =
      Boolean(prevBareAr) && ARABIC_NAWASIKH.has(prevBareAr);

    if (bond.isConnected || isArabicNasikhPredicateBond) {
      protectedConstructionCount++;
      if (hasSoftComma) {
        // Strip the misplaced comma sitting inside a connected syntactic construction!
        outputTokens[i] = currWithoutSoftComma;
        removedPauseCount++;
      }
    }
  }

  return {
    text: outputTokens.join(" ").replace(/\s+/g, " ").trim(),
    removedPauseCount,
    protectedConstructionCount,
  };
}

// ─── 4. Semantic Completeness Analyzers (Arabic vs Urdu) ──────────────────────

export function analyzeArabicCompleteness(text, nextTextHint = "") {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      isComplete: false,
      completenessScore: 0,
      reason: "empty",
      leadsIntoQuote: false,
      protectedBondType: null,
    };
  }

  const strippedFootnotes = clean
    .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
    .trim();

  const words = strippedFootnotes.split(/\s+/).filter(Boolean);
  const lastWordRaw = words[words.length - 1] || "";
  const lastWordNorm = stripArabicDiacriticsAndPunct(lastWordRaw);
  const lastWordExact = stripArabicPunctOnly(lastWordRaw);

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
      protectedBondType: "unclosed_quote",
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
      protectedBondType: "attribution_head",
    };
  }

  // Check if boundary to nextTextHint cuts a connected Arabic syntactic construction
  const boundaryCheck = isBoundaryProtectedByConnectedConstruction(
    strippedFootnotes,
    nextTextHint,
    "ar"
  );
  if (boundaryCheck.isProtected) {
    return {
      isComplete: false,
      completenessScore: 28,
      reason: `connected_construction:${boundaryCheck.reason}`,
      leadsIntoQuote: false,
      protectedBondType: boundaryCheck.reason,
    };
  }

  // Check if ends with mid-sentence comma
  if (/[،,]$/.test(strippedFootnotes)) {
    return {
      isComplete: false,
      completenessScore: 40,
      reason: "mid_clause_comma",
      leadsIntoQuote: false,
      protectedBondType: "mid_clause_comma",
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
      protectedBondType: "trailing_particle",
    };
  }

  const hasStrongTerminalPunct = /[۔.؟!﴾»]$/.test(strippedFootnotes);
  if (words.length <= 2 && !hasStrongTerminalPunct) {
    return {
      isComplete: false,
      completenessScore: 45,
      reason: "short_incomplete_clause",
      leadsIntoQuote: false,
      protectedBondType: "short_incomplete_clause",
    };
  }

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
      protectedBondType: "dependent_next_clause",
    };
  }

  const score = hasStrongTerminalPunct ? 96 : words.length >= 5 ? 84 : 72;
  return {
    isComplete: true,
    completenessScore: score,
    reason: "complete",
    leadsIntoQuote: false,
    protectedBondType: null,
  };
}

export function analyzeUrduCompleteness(text, nextTextHint = "") {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      isComplete: false,
      completenessScore: 0,
      reason: "empty",
      leadsIntoQuote: false,
      protectedBondType: null,
    };
  }

  const strippedFootnotes = clean
    .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
    .trim();

  const words = strippedFootnotes.split(/\s+/).filter(Boolean);
  const lastWordRaw = words[words.length - 1] || "";
  const lastWordWithMarks = stripUrduPunct(lastWordRaw);
  const lastWordClean = stripUrduDiacriticsAndPunct(lastWordRaw);

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
      protectedBondType: "unclosed_quote",
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
      protectedBondType: "attribution_head",
    };
  }

  // Check if boundary to nextTextHint cuts a connected Urdu syntactic construction
  const boundaryCheck = isBoundaryProtectedByConnectedConstruction(
    strippedFootnotes,
    nextTextHint,
    "ur"
  );
  if (boundaryCheck.isProtected) {
    return {
      isComplete: false,
      completenessScore: 26,
      reason: `connected_construction:${boundaryCheck.reason}`,
      leadsIntoQuote: false,
      protectedBondType: boundaryCheck.reason,
    };
  }

  // Check if ends with mid-clause comma or izafat (زیرِ اضافت / ہمزہ اضافت / ئے)
  if (
    /[،,]$/.test(strippedFootnotes) ||
    /[\u0650\u06C2]$/.test(lastWordWithMarks) ||
    /ئے$/.test(lastWordClean)
  ) {
    return {
      isComplete: false,
      completenessScore: 35,
      reason: "mid_clause_or_izafat",
      leadsIntoQuote: false,
      protectedBondType: "izafat_or_comma",
    };
  }

  // Check if last word is an Urdu postposition, subordinating particle, negation, or incomplete modifier
  if (URDU_INCOMPLETE_ENDING_WORDS.has(lastWordClean)) {
    return {
      isComplete: false,
      completenessScore: 25,
      reason: "trailing_postposition_or_conjunction",
      leadsIntoQuote: false,
      protectedBondType: "trailing_postposition_or_conjunction",
    };
  }

  const hasStrongTerminalPunct = /[۔.؟!﴾»]$/.test(strippedFootnotes);
  const hasFiniteVerbEnd = URDU_FINITE_CLAUSE_END_REGEX.test(strippedFootnotes);

  if (!hasStrongTerminalPunct && !hasFiniteVerbEnd && words.length < 5) {
    return {
      isComplete: false,
      completenessScore: 45,
      reason: "missing_finite_predicate",
      leadsIntoQuote: false,
      protectedBondType: "missing_finite_predicate",
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
    protectedBondType: null,
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

// ─── 5. Unpunctuated Long Clause Splitter & Incomplete Clause Merger ──────────

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
 * Split a long unpunctuated sentence (> 28 words) ONLY at genuine syntactic clause completion points
 * where:
 *  - The boundary `(tokens[i] -> tokens[i+1])` is NOT protected by any connected syntactic construction.
 *  - The left clause is semantically complete (`comp.isComplete === true`).
 *  - The right clause begins a genuine new proposition.
 */
function splitLongUnpunctuatedSentenceAtClauseBoundaries(sent) {
  if (!sent || sent.segmentType === "quran" || sent.segmentType === "heading") {
    return [sent];
  }
  const text = String(sent.originalText || "").trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 28) return [sent];

  const lang = sent.language === "ar" ? "ar" : "ur";
  const { protectedBoundaries } = analyzeConnectedSyntacticConstructions(text, lang);

  const splitIndices = [];
  let lastSplitIdx = 0;

  for (let i = 8; i < tokens.length - 7; i++) {
    if (i - lastSplitIdx < 9) continue;

    // HARD GUARD: Never split in the middle of a connected syntactic construction!
    if (protectedBoundaries.has(i)) continue;

    const currTok = tokens[i];
    const nextTok = tokens[i + 1];
    const currBare =
      lang === "ar" ? stripArabicDiacriticsAndPunct(currTok) : stripUrduDiacriticsAndPunct(currTok);
    const nextBare =
      lang === "ar" ? stripArabicDiacriticsAndPunct(nextTok) : stripUrduDiacriticsAndPunct(nextTok);

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
        const boundaryGuard = isBoundaryProtectedByConnectedConstruction(
          leftCandidate,
          rightCandidate,
          "ur"
        );
        if (!boundaryGuard.isProtected) {
          const comp = analyzeUrduCompleteness(leftCandidate, rightCandidate);
          if (comp.isComplete) {
            isNaturalClauseBoundary = true;
          }
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
        const boundaryGuard = isBoundaryProtectedByConnectedConstruction(
          leftCandidate,
          rightCandidate,
          "ar"
        );
        if (!boundaryGuard.isProtected) {
          const comp = analyzeArabicCompleteness(leftCandidate, rightCandidate);
          if (comp.isComplete) {
            isNaturalClauseBoundary = true;
          }
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
 * Refine raw block sentences using Arabic & Urdu connected syntactic construction & completeness rules:
 * 1. Merge adjacent clauses whenever the boundary cuts inside a connected syntactic construction
 *    OR the first clause is syntactically incomplete (iteratively up to 46 words).
 * 2. Segment overly long unpunctuated paragraphs ONLY at unprotected, semantically complete clause boundaries.
 */
export function refineSentencesLinguistically(rawSentences = []) {
  if (!Array.isArray(rawSentences) || rawSentences.length === 0) return [];

  const merged = [];
  let i = 0;
  while (i < rawSentences.length) {
    let curr = { ...rawSentences[i] };

    // Iteratively absorb any immediate continuation in the same block & language that is syntactically connected
    while (i + 1 < rawSentences.length) {
      const next = rawSentences[i + 1];
      if (
        !next ||
        curr.paragraphIndex !== next.paragraphIndex ||
        curr.language !== next.language ||
        curr.segmentType === "quran" ||
        next.segmentType === "quran" ||
        curr.segmentType === "heading" ||
        next.segmentType === "heading"
      ) {
        break;
      }

      const combinedWordCount =
        (curr.words?.length || 0) + (next.words?.length || 0);
      if (combinedWordCount > 46) break;

      const boundaryGuard = isBoundaryProtectedByConnectedConstruction(
        curr.originalText,
        next.originalText,
        curr.language
      );
      const comp = evaluateSemanticCompleteness(
        curr.originalText,
        curr.language,
        next.originalText
      );

      const shouldMerge =
        (boundaryGuard.isProtected && !comp.leadsIntoQuote) ||
        (!comp.isComplete && !comp.leadsIntoQuote);

      if (!shouldMerge) break;

      const joinedOrig = `${curr.originalText} ${next.originalText}`
        .replace(/\s+/g, " ")
        .trim();
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

      curr = {
        ...curr,
        originalExtractedText: joinedRawExt,
        ocrCorrectedText: joinedOrig,
        originalText: joinedOrig,
        cleanedPronunciationText: joinedClean,
        words: joinedWords,
        lineBoxes: joinedLineBoxes,
      };
      i++;
    }

    merged.push(curr);
    i++;
  }

  // Pass 2: Split overly long unpunctuated sentences ONLY at unprotected linguistic clause boundaries
  const finalSentences = [];
  for (const s of merged) {
    const parts = splitLongUnpunctuatedSentenceAtClauseBoundaries(s);
    finalSentences.push(...parts);
  }

  return finalSentences;
}

// ─── 6. Intelligent Topic Detection & Cross-Page Topic/Sentence Linker ────────

function detectTopicBoundaryAtSentence(sent, prevSent, pageOutlineTitles = []) {
  const text = String(sent?.originalText || "").trim();
  const cleanNoTash = text.replace(/[\u064B-\u065F\u0670]/g, "");

  if (sent.segmentType === "heading") {
    return {
      isNewTopic: true,
      title: text,
      isGeneratedTitle: false,
      confidence: "exact",
    };
  }

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

  const isNewParagraph = !prevSent || sent.paragraphIndex !== prevSent.paragraphIndex;
  if (isNewParagraph) {
    const isTopicMarker =
      sent.language === "ar"
        ? ARABIC_TOPIC_SHIFT_REGEX.test(cleanNoTash)
        : URDU_TOPIC_SHIFT_REGEX.test(cleanNoTash);
    if (isTopicMarker) {
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
 * - Connected syntactic construction guard & intra-sentence pause sanitization
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

  const tocList = Array.isArray(bookMetadata?.table_of_contents)
    ? bookMetadata.table_of_contents
    : [];
  const pageOutlineTitles = tocList
    .filter((it) => Number(it.page || it.pageNumber) === Number(pageNumber))
    .map((it) => String(it.title || "").trim())
    .filter(Boolean);

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

    const boundaryGuard = isBoundaryProtectedByConnectedConstruction(
      s.originalText,
      nextTextHint,
      s.language
    );

    // Sanitize misplaced PDF commas inside connected syntactic constructions in the spoken layer
    // (Never alter verified Quranic text)
    const intraSanitization =
      s.segmentType === "quran"
        ? {
            text: s.cleanedPronunciationText || s.originalText,
            removedPauseCount: 0,
            protectedConstructionCount: 0,
          }
        : sanitizeIntraSentenceSyntacticPauses(
            s.cleanedPronunciationText || s.originalText,
            s.language
          );

    const isLastOnPage = idx === sentences.length - 1;
    const isFirstOnPage = idx === 0;

    const strippedLast = String(s.originalText || "")
      .replace(/\s*(?:[\(\[]\s*[\d٠-٩۰-۹]+\s*[\)\]]|\)\s*[\d٠-٩۰-۹]+\s*\()\s*$/, "")
      .trim();
    const lacksTerminalAtPageBottom =
      isLastOnPage &&
      s.segmentType !== "heading" &&
      (!/[۔.؟!﴾»]$/.test(strippedLast) || !completeness.isComplete || boundaryGuard.isProtected);

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
    } else if (
      boundaryGuard.isProtected &&
      !completeness.leadsIntoQuote &&
      next &&
      next.segmentType !== "heading"
    ) {
      // STRICT SYNTACTIC CONTINUITY: Never pause in the middle of a connected syntactic construction!
      pauseSpec = PAUSE_TYPES.NONE;
      relationToNext = `connected_syntactic_construction:${boundaryGuard.reason}`;
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
      cleanedPronunciationText: intraSanitization.text || s.cleanedPronunciationText,
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
      syntacticProtection: {
        boundaryProtected: boundaryGuard.isProtected,
        boundaryBondType: boundaryGuard.reason,
        protectedConstructionsInSentence: intraSanitization.protectedConstructionCount,
        removedMisplacedPauses: intraSanitization.removedPauseCount,
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
