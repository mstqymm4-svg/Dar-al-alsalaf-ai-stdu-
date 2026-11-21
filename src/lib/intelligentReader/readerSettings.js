/**
 * DAR AL TAWHID — Intelligent Reader Settings Manager (القسم 15 + 16)
 *
 * Isolates settings per authenticated user (getAccountEmail()) and persists
 * to localStorage + IndexedDB.
 */

import { getAccountEmail } from "@/lib/activeUser";

export const URDU_VOICES = [
  {
    id: "pakistani_scholar_charon",
    label: "صوت عالم أردي فصيح — وقور وهادئ (ur-PK • Charon Neural)",
    language: "ur-PK",
    gender: "MALE",
    provider: "gemini-neural",
    description: "صوت رجالي أردي باكستاني عميق ومناسب للكتب العلمية والشرعية",
  },
  {
    id: "pakistani_narrator_fenrir",
    label: "قارئ كتب أردي واضح — سردي متزن (ur-PK • Fenrir Neural)",
    language: "ur-PK",
    gender: "MALE",
    provider: "gemini-neural",
    description: "نطق واضح ومفصل للجمل الأردية الطويلة وخط نستعليق",
  },
  {
    id: "pakistani_classic_orus",
    label: "قارئ أردي كلاسيكي — متأنٍّ (ur-PK • Orus Neural)",
    language: "ur-PK",
    gender: "MALE",
    provider: "gemini-neural",
    description: "قراءة هادئة ومتأنية للشروح والحواشي العلمية",
  },
];

export const ARABIC_VOICES = [
  {
    id: "arabic_hadith_charon",
    label: "صوت عربي فصيح للأحاديث والمتون (ar-SA • Charon Neural)",
    language: "ar-SA",
    gender: "MALE",
    provider: "gemini-neural",
    description: "صوت رجالي عربي فصيح لقراءة الأحاديث النبوية والاقتباسات العربية",
  },
  {
    id: "arabic_turath_fenrir",
    label: "قارئ التراث العربي — واضح وجلي (ar-SA • Fenrir Neural)",
    language: "ar-SA",
    gender: "MALE",
    provider: "gemini-neural",
    description: "نطق عربي فصيح للأدعية والشروح العربية داخل الكتب",
  },
  {
    id: "arabic_fasih_orus",
    label: "قارئ عربي هادئ — متأنٍّ (ar-SA • Orus Neural)",
    language: "ar-SA",
    gender: "MALE",
    provider: "gemini-neural",
    description: "إلقاء متأنٍّ للنصوص العربية والآثار",
  },
];

export const QURAN_RECITERS = [
  {
    id: "ar.alafasy",
    label: "الشيخ مشاري راشد العفاسي (تلاوة مسجلة معتمدة)",
    folder: "Alafasy_128kbps",
  },
  {
    id: "ar.husary",
    label: "الشيخ محمود خليل الحصري (تلاوة مسجلة معتمدة)",
    folder: "Husary_128kbps",
  },
  {
    id: "ar.abdulbasitmurattal",
    label: "الشيخ عبد الباسط عبد الصمد — مرتل (تلاوة مسجلة معتمدة)",
    folder: "Abdul_Basit_Murattal_192kbps",
  },
  {
    id: "ar.minshawi",
    label: "الشيخ محمد صديق المنشاوي — مرتل (تلاوة مسجلة معتمدة)",
    folder: "Minshawy_Murattal_128kbps",
  },
];

export const PLAYBACK_SPEEDS = [0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2];

export const HIGHLIGHT_COLORS = [
  {
    id: "cyan",
    label: "سماوي دار التوحيد (#A5F3FC)",
    wordBg: "rgba(8, 145, 178, 0.32)",
    wordBorder: "#0891B2",
    sentenceBg: "rgba(165, 243, 252, 0.24)",
  },
  {
    id: "teal",
    label: "فيروزي علمي (#155E75)",
    wordBg: "rgba(21, 94, 117, 0.32)",
    wordBorder: "#155E75",
    sentenceBg: "rgba(21, 94, 117, 0.14)",
  },
  {
    id: "gold",
    label: "ذهبي تراثي (#FDE68A)",
    wordBg: "rgba(245, 158, 11, 0.35)",
    wordBorder: "#D97706",
    sentenceBg: "rgba(253, 230, 138, 0.24)",
  },
  {
    id: "emerald",
    label: "زمردي هادئ (#A7F3D0)",
    wordBg: "rgba(16, 185, 129, 0.30)",
    wordBorder: "#059669",
    sentenceBg: "rgba(167, 243, 208, 0.22)",
  },
];

export const DEFAULT_READER_SETTINGS = {
  // 1. الصوت الافتراضي
  defaultUrduVoice: "pakistani_scholar_charon",
  // 2. السرعة الافتراضية
  defaultSpeed: 1,
  // 3. مستوى الصوت
  volume: 1,
  // 4. لغة القراءة (auto | ur-PK | ar-SA)
  readingLanguage: "auto",
  // 5. تفعيل أو إيقاف تظليل الكلمات
  wordHighlightEnabled: true,
  // 6. تفعيل أو إيقاف تظليل الجمل
  sentenceHighlightEnabled: true,
  // 7. لون التظليل
  highlightColorId: "cyan",
  // 8. الوضع الليلي والنهاري ("day" | "night" | "sepia")
  themeMode: "day",
  // 9. طريقة الانتقال بين الصفحات ("auto" | "manual")
  pageTransitionMode: "auto",
  // 10. تفعيل القراءة في الخلفية
  backgroundReadingEnabled: true,
  // 11. استكمال القراءة تلقائياً
  autoResumeEnabled: true,
  // 12. إعدادات التوقف ("immediate" | "complete_sentence")
  pauseBehavior: "immediate",
  // 13. اختيار صوت النصوص العربية والأحاديث
  defaultArabicVoice: "arabic_hadith_charon",
  // 14. اختيار صوت النصوص الأردية
  urduVoiceId: "pakistani_scholar_charon",
  // 15. قارئ القرآن الكريم المعتمد (تسجيل حقيقي فقط)
  quranReciterId: "ar.alafasy",
  // 16. وضع العرض الافتراضي ("reading" | "listening" | "reading_listening")
  defaultDisplayMode: "reading_listening",
  // 17. تفعيل استخراج OCR التلقائي للصفحات المصورة (نستعليق)
  autoOcrNastaliq: true,
};

function getSettingsStorageKey(userEmail) {
  const email = String(userEmail || getAccountEmail() || "guest@local")
    .trim()
    .toLowerCase();
  return `dat_intelligent_reader_settings::${email}`;
}

export function loadReaderSettings(userEmail) {
  try {
    const key = getSettingsStorageKey(userEmail);
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_READER_SETTINGS, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function saveReaderSettings(partialSettings, userEmail) {
  try {
    const key = getSettingsStorageKey(userEmail);
    const current = loadReaderSettings(userEmail);
    const updated = { ...current, ...(partialSettings || {}), updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(updated));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dat:reader-settings-changed", { detail: updated }));
    }
    return updated;
  } catch {
    return { ...DEFAULT_READER_SETTINGS, ...(partialSettings || {}) };
  }
}

export function resetReaderSettings(userEmail) {
  try {
    const key = getSettingsStorageKey(userEmail);
    localStorage.setItem(key, JSON.stringify(DEFAULT_READER_SETTINGS));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dat:reader-settings-changed", { detail: DEFAULT_READER_SETTINGS })
      );
    }
  } catch {}
  return { ...DEFAULT_READER_SETTINGS };
}

export function getHighlightColorConfig(colorId) {
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId) || HIGHLIGHT_COLORS[0];
}
