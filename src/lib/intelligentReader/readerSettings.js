/**
 * DAR AL TAWHID — Intelligent Reader Automatic Settings Manager
 *
 * Automatically locks optimal scholarly reading defaults (male Pakistani Urdu voice ur-PK-AsadNeural,
 * male Classical Arabic voice ar-SA-HamedNeural, authentic recorded Quran recitation ar.alafasy,
 * automatic per-sentence language detection, and synchronized word/sentence highlighting)
 * so stale manual overrides in localStorage never misconfigure the reader.
 */

import { getAccountEmail } from "@/lib/activeUser";

export const URDU_VOICES = [
  {
    id: "pakistani_scholar_charon",
    label: "صوت عالم أردي فصيح — وقور وهادئ (ur-PK • Asad Neural)",
    language: "ur-PK",
    gender: "MALE",
    provider: "edge-neural",
    description: "صوت رجالي أردي باكستاني عميق ومناسب للكتب العلمية والشرعية",
  },
  {
    id: "pakistani_narrator_fenrir",
    label: "قارئ كتب أردي واضح — سردي متزن (ur-PK • Salman Neural)",
    language: "ur-PK",
    gender: "MALE",
    provider: "edge-neural",
    description: "نطق واضح ومفصل للجمل الأردية الطويلة وخط نستعليق",
  },
  {
    id: "pakistani_classic_orus",
    label: "قارئ أردي كلاسيكي — متأنٍّ (ur-PK • Asad Classic)",
    language: "ur-PK",
    gender: "MALE",
    provider: "edge-neural",
    description: "قراءة هادئة ومتأنية للشروح والحواشي العلمية",
  },
];

export const ARABIC_VOICES = [
  {
    id: "arabic_hadith_charon",
    label: "صوت عربي فصيح للأحاديث والمتون (ar-SA • Hamed Neural)",
    language: "ar-SA",
    gender: "MALE",
    provider: "edge-neural",
    description: "صوت رجالي عربي فصيح لقراءة الأحاديث النبوية والاقتباسات العربية",
  },
  {
    id: "arabic_turath_fenrir",
    label: "قارئ التراث العربي — واضح وجلي (ar-EG • Shakir Neural)",
    language: "ar-SA",
    gender: "MALE",
    provider: "edge-neural",
    description: "نطق عربي فصيح للأدعية والشروح العربية داخل الكتب",
  },
  {
    id: "arabic_fasih_orus",
    label: "قارئ عربي هادئ — متأنٍّ (ar-SA • Hamed Classic)",
    language: "ar-SA",
    gender: "MALE",
    provider: "edge-neural",
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

// Locked automatic optimal defaults (Male voices + Auto language detection + Auto highlighting)
const LOCKED_AUTOMATIC_OVERRIDES = {
  defaultUrduVoice: "pakistani_scholar_charon",
  urduVoiceId: "pakistani_scholar_charon",
  defaultArabicVoice: "arabic_hadith_charon",
  quranReciterId: "ar.alafasy",
  readingLanguage: "auto",
  wordHighlightEnabled: true,
  sentenceHighlightEnabled: true,
  autoOcrNastaliq: true,
  pageTransitionMode: "auto",
  pauseBehavior: "immediate",
  backgroundReadingEnabled: true,
  autoResumeEnabled: true,
};

export const DEFAULT_READER_SETTINGS = {
  ...LOCKED_AUTOMATIC_OVERRIDES,
  defaultSpeed: 1,
  volume: 1,
  highlightColorId: "cyan",
  themeMode: "day",
  defaultDisplayMode: "reading_listening",
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
    const parsed = raw ? JSON.parse(raw) : {};
    // Always enforce LOCKED_AUTOMATIC_OVERRIDES so stale "ar" or "ur" language overrides
    // in localStorage can NEVER force the wrong language voice!
    return {
      ...DEFAULT_READER_SETTINGS,
      ...(parsed || {}),
      ...LOCKED_AUTOMATIC_OVERRIDES,
      defaultSpeed: Number(parsed?.defaultSpeed) > 0 ? Number(parsed.defaultSpeed) : 1,
      volume: typeof parsed?.volume === "number" ? parsed.volume : 1,
    };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function saveReaderSettings(partialSettings, userEmail) {
  try {
    const key = getSettingsStorageKey(userEmail);
    const current = loadReaderSettings(userEmail);
    const updated = {
      ...current,
      ...(partialSettings || {}),
      ...LOCKED_AUTOMATIC_OVERRIDES,
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(updated));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dat:reader-settings-changed", { detail: updated })
      );
    }
    return updated;
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function resetReaderSettings(userEmail) {
  try {
    const key = getSettingsStorageKey(userEmail);
    localStorage.setItem(key, JSON.stringify(DEFAULT_READER_SETTINGS));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dat:reader-settings-changed", {
          detail: DEFAULT_READER_SETTINGS,
        })
      );
    }
  } catch {}
  return { ...DEFAULT_READER_SETTINGS };
}

export function getHighlightColorConfig(colorId) {
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId) || HIGHLIGHT_COLORS[0];
}
