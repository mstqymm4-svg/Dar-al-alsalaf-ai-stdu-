/**
 * DAR AL TAWHID — Comprehensive Intelligent Reader Settings, Voice Tester & OCR Inspector Modal
 * (الأقسام: 4، 5، 15، 16، 19)
 */

import React, { useState, useEffect } from "react";
import {
  X,
  Play,
  Loader2,
  RotateCcw,
  Trash2,
  FileText,
  Sparkles,
  CheckCircle2,
  HardDrive,
  Sliders,
  Radio,
} from "lucide-react";
import {
  URDU_VOICES,
  ARABIC_VOICES,
  QURAN_RECITERS,
  PLAYBACK_SPEEDS,
  HIGHLIGHT_COLORS,
  PROSODY_PRESETS,
} from "@/lib/intelligentReader/readerSettings";
import {
  getReaderCacheStats,
  clearReaderCache,
} from "@/lib/intelligentReader/cacheManager";
import {
  WEB_SPEECH_ARTICULATION_PRESETS,
  WEB_SPEECH_DIALECTS,
} from "@/lib/intelligentReader/webSpeechService";
import { formatBytes } from "@/lib/offlineDB";
import { apiUrl } from "@/lib/apiBase";

const SAMPLE_URDU_TEST_TEXT =
  "الحمد للہ رب العالمین۔ وسوسہ شیطان کا ایک کمزور ہتھیار ہے اور ذکرِ الٰہی سے مومن کا دل مطمئن ہو جاتا ہے۔";
const SAMPLE_ARABIC_TEST_TEXT =
  "قال رسول الله صلى الله عليه وسلم: ذاك صريح الإيمان. القاعدة الفقهية: اليقين لا يزول بالشك.";

export default function ReaderSettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onResetSettings,
  pageData,
  onRunOcrOnCurrentPage,
  isRunningOcr = false,
  darkMode = false,
}) {
  const [activeTab, setActiveTab] = useState("settings"); // "settings" | "voices" | "ocr" | "cache"
  const [testingVoiceId, setTestingVoiceId] = useState(null);
  const [testError, setTestError] = useState("");
  const [cacheStats, setCacheStats] = useState({
    ocrCount: 0,
    ocrBytes: 0,
    ttsCount: 0,
    ttsBytes: 0,
    totalBytes: 0,
  });

  useEffect(() => {
    if (isOpen) {
      getReaderCacheStats().then(setCacheStats).catch(() => {});
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleTestVoice = async (voiceId, langCode, sampleText) => {
    setTestingVoiceId(voiceId);
    setTestError("");
    try {
      const res = await fetch(apiUrl("/api/reader/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          language: langCode,
          segmentType: langCode.startsWith("ar") ? "hadith" : "urdu_body",
          voiceId,
          prosody: {
            preset: settings?.prosodyPreset || "scholarly",
            enabled: settings?.prosodyEnabled !== false,
            arabicTashkeel: settings?.arabicTashkeelEnabled !== false,
            urduProofread: settings?.urduProofreadEnabled !== false,
            hadithRateDelta: Number(settings?.hadithProsodyRateDelta ?? -3),
            pitchDeltaHz: Number(settings?.prosodyPitchDeltaHz ?? -1),
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data?.audioBase64) {
        const binary = atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: data.mimeType || "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = settings?.defaultSpeed || 1;
        audio.volume = settings?.volume ?? 1;
        await audio.play();
      }
    } catch (e) {
      setTestError(e?.message || "تعذر تشغيل تجربة الصوت");
    } finally {
      setTestingVoiceId(null);
    }
  };

  const handleClearCache = async () => {
    await clearReaderCache();
    const fresh = await getReaderCacheStats();
    setCacheStats(fresh);
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${
          darkMode
            ? "bg-[#0F172A] border-slate-800 text-slate-100"
            : "bg-white border-[#E2E8F0] text-[#0F172A]"
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#155E75] text-white flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <Sliders className="w-5 h-5 text-[#A5F3FC]" />
              <span>إعدادات القارئ الذكي والصوتي — DAR AL TAWHID</span>
            </h2>
            <p className="text-xs text-[#A5F3FC]/90 mt-0.5">
              تخصيص الصوت الأردي (ur-PK) والعربي، تلاوة القرآن المسجلة، التظليل، وطبقة OCR
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          className={`flex items-center gap-1 px-4 pt-2 border-b overflow-x-auto ${
            darkMode ? "bg-slate-900 border-slate-800" : "bg-[#F8FAFC] border-[#E2E8F0]"
          }`}
        >
          {[
            { id: "settings", label: "الإعدادات العامة (17)", icon: Sliders },
            { id: "voices", label: "اختبار ومقارنة الأصوات", icon: Radio },
            { id: "ocr", label: "فحص النص المستخرج (OCR)", icon: FileText },
            { id: "cache", label: "التخزين المؤقت والخلفية", icon: HardDrive },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
                  active
                    ? "border-[#0891B2] text-[#0891B2]"
                    : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === "settings" && (
            <div className="space-y-4">
              {/* 1 & 14: Urdu Voice Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    1. الصوت الافتراضي للنصوص الأردية (Urdu - Pakistan):
                  </label>
                  <select
                    value={settings.urduVoiceId || settings.defaultUrduVoice}
                    onChange={(e) =>
                      onUpdateSettings({
                        urduVoiceId: e.target.value,
                        defaultUrduVoice: e.target.value,
                      })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    {URDU_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 13: Arabic & Hadith Voice Selection */}
                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    2. صوت النصوص العربية والأحاديث النبوية:
                  </label>
                  <select
                    value={settings.defaultArabicVoice}
                    onChange={(e) =>
                      onUpdateSettings({ defaultArabicVoice: e.target.value })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    {ARABIC_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quran Authentic Reciter Selection */}
              <div>
                <label className="block text-xs font-bold mb-1.5">
                  3. قارئ التلاوة القرآنية المسجلة (لا يُستخدم TTS للقرآن أبداً):
                </label>
                <select
                  value={settings.quranReciterId}
                  onChange={(e) =>
                    onUpdateSettings({ quranReciterId: e.target.value })
                  }
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                    darkMode
                      ? "bg-slate-900 border-slate-700"
                      : "bg-[#F8FAFC] border-[#E2E8F0]"
                  }`}
                >
                  {QURAN_RECITERS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2, 3, 4: Speed, Volume, Reading Language */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    4. السرعة الافتراضية:
                  </label>
                  <select
                    value={settings.defaultSpeed}
                    onChange={(e) =>
                      onUpdateSettings({ defaultSpeed: Number(e.target.value) })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-bold ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    {PLAYBACK_SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}x
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    5. مستوى الصوت ({Math.round((settings.volume ?? 1) * 100)}%):
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.volume ?? 1}
                    onChange={(e) =>
                      onUpdateSettings({ volume: Number(e.target.value) })
                    }
                    className="w-full accent-[#155E75] mt-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    6. لغة القراءة:
                  </label>
                  <select
                    value={settings.readingLanguage}
                    onChange={(e) =>
                      onUpdateSettings({ readingLanguage: e.target.value })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    <option value="auto">تلقائي ذكي (أردو + عربي + قرآن)</option>
                    <option value="ur-PK">الأردية (ur-PK) كأساس</option>
                    <option value="ar-SA">العربية الفصحى (ar-SA) كأساس</option>
                  </select>
                </div>
              </div>

              {/* 5, 6, 7: Word Highlight, Sentence Highlight, Highlight Color */}
              <div className="p-3.5 rounded-xl border border-[#E2E8F0] dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    7. تفعيل تظليل الكلمات المتزامن مع الصوت
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.wordHighlightEnabled !== false}
                    onChange={(e) =>
                      onUpdateSettings({ wordHighlightEnabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#155E75]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    8. تفعيل تظليل الجملة والفقرة الحالية على الصفحة
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.sentenceHighlightEnabled !== false}
                    onChange={(e) =>
                      onUpdateSettings({
                        sentenceHighlightEnabled: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#155E75]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    9. لون التظليل المتزامن:
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ highlightColorId: c.id })
                        }
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${
                          settings.highlightColorId === c.id
                            ? "border-[#155E75] ring-2 ring-[#0891B2]/40"
                            : "border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 border"
                          style={{
                            backgroundColor: c.wordBg,
                            borderColor: c.wordBorder,
                          }}
                        />
                        <span className="truncate">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 8, 9, 10, 11, 12: Theme, Page Transition, Background, Auto-Resume, Pause Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    10. طريقة الانتقال بين الصفحات أثناء القراءة:
                  </label>
                  <select
                    value={settings.pageTransitionMode}
                    onChange={(e) =>
                      onUpdateSettings({ pageTransitionMode: e.target.value })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    <option value="auto">
                      انتقال تلقائي للصفحة التالية عند انتهاء الصفحة
                    </option>
                    <option value="manual">
                      التوقف عند نهاية الصفحة (انتقال يدوي)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1.5">
                    11. إعدادات التوقف المؤقت (Pause Mode):
                  </label>
                  <select
                    value={settings.pauseBehavior}
                    onChange={(e) =>
                      onUpdateSettings({ pauseBehavior: e.target.value })
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                      darkMode
                        ? "bg-slate-900 border-slate-700"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}
                  >
                    <option value="immediate">إيقاف فوري عند الكلمة الحالية</option>
                    <option value="complete_sentence">
                      إكمال الجملة الحالية حتى لا ينقطع المعنى ثم التوقف
                    </option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-[#E2E8F0] dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    12. تفعيل القراءة الصوتية في الخلفية وعند قفل الشاشة
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.backgroundReadingEnabled !== false}
                    onChange={(e) =>
                      onUpdateSettings({
                        backgroundReadingEnabled: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#155E75]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    13. استكمال القراءة تلقائياً من آخر كلمة/جملة توقفت عندها
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoResumeEnabled !== false}
                    onChange={(e) =>
                      onUpdateSettings({ autoResumeEnabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#155E75]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    14. استخراج النصوص التلقائي (OCR) لصفحات نستعليق المصورة
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoOcrNastaliq !== false}
                    onChange={(e) =>
                      onUpdateSettings({ autoOcrNastaliq: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#155E75]"
                  />
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] dark:border-slate-800 space-y-3">
                  <div className="text-xs font-bold text-[#155E75] dark:text-[#A5F3FC]">
                    15. تكامل محرك النطق (TTS): التشكيل العربي والتدقيق الأردي وإعدادات النطق (Prosody)
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      أ. تشكيل الحروف العربية وضبط مخارج الأحاديث والمأثورات
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.arabicTashkeelEnabled !== false}
                      onChange={(e) =>
                        onUpdateSettings({ arabicTashkeelEnabled: e.target.checked })
                      }
                      className="w-4 h-4 accent-[#155E75]"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      ب. التدقيق اللغوي والصوتي للغة الأردية (نستعليق ووقفات الجمل)
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.urduProofreadEnabled !== false}
                      onChange={(e) =>
                        onUpdateSettings({ urduProofreadEnabled: e.target.checked })
                      }
                      className="w-4 h-4 accent-[#155E75]"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      ج. تفعيل ضبط التنغيم وسرعة النطق (Prosody) للأحاديث والآيات
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.prosodyEnabled !== false}
                      onChange={(e) =>
                        onUpdateSettings({ prosodyEnabled: e.target.checked })
                      }
                      className="w-4 h-4 accent-[#155E75]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-1">
                      نمط الإلقاء والتنغيم:
                    </label>
                    <select
                      disabled={settings.prosodyEnabled === false}
                      value={settings.prosodyPreset || "scholarly"}
                      onChange={(e) =>
                        onUpdateSettings({ prosodyPreset: e.target.value })
                      }
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-medium disabled:opacity-50 ${
                        darkMode
                          ? "bg-slate-900 border-slate-700"
                          : "bg-[#F8FAFC] border-[#E2E8F0]"
                      }`}
                    >
                      {PROSODY_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        تأني قراءة الأحاديث والآيات ({Number(settings.hadithProsodyRateDelta ?? -3) >= 0 ? "+" : ""}
                        {Number(settings.hadithProsodyRateDelta ?? -3)}%):
                      </label>
                      <input
                        type="range"
                        min="-10"
                        max="4"
                        step="1"
                        disabled={settings.prosodyEnabled === false}
                        value={Number(settings.hadithProsodyRateDelta ?? -3)}
                        onChange={(e) =>
                          onUpdateSettings({
                            hadithProsodyRateDelta: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#155E75] disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        نبرة الصوت والوقار ({Number(settings.prosodyPitchDeltaHz ?? -1) >= 0 ? "+" : ""}
                        {Number(settings.prosodyPitchDeltaHz ?? -1)} Hz):
                      </label>
                      <input
                        type="range"
                        min="-4"
                        max="2"
                        step="1"
                        disabled={settings.prosodyEnabled === false}
                        value={Number(settings.prosodyPitchDeltaHz ?? -1)}
                        onChange={(e) =>
                          onUpdateSettings({
                            prosodyPitchDeltaHz: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#155E75] disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Web Speech API Specialized Makharij, Tashkeel & Dialect Presets */}
                  <div className="pt-2 border-t border-[#E2E8F0]/70 dark:border-slate-800/80 space-y-2.5">
                    <div className="text-[11px] font-bold text-[#155E75] dark:text-[#A5F3FC]">
                      وحدة التحكم المتخصصة في Web Speech API (مخارج الحروف واللهجات المعتمدة):
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        إعداد مخارج الحروف والتشكيل (Makharij & Tashkeel Preset):
                      </label>
                      <select
                        value={settings.webSpeechArticulationPreset || "tajweed_articulatory"}
                        onChange={(e) =>
                          onUpdateSettings({
                            webSpeechArticulationPreset: e.target.value,
                          })
                        }
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                          darkMode
                            ? "bg-slate-900 border-slate-700"
                            : "bg-[#F8FAFC] border-[#E2E8F0]"
                        }`}
                      >
                        {WEB_SPEECH_ARTICULATION_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          لهجة النطق العربي (الفصحى):
                        </label>
                        <select
                          value={settings.webSpeechArabicDialect || "ar-SA"}
                          onChange={(e) =>
                            onUpdateSettings({
                              webSpeechArabicDialect: e.target.value,
                            })
                          }
                          className={`w-full px-2.5 py-1.5 rounded-xl border text-xs font-medium ${
                            darkMode
                              ? "bg-slate-900 border-slate-700"
                              : "bg-[#F8FAFC] border-[#E2E8F0]"
                          }`}
                        >
                          {Object.values(WEB_SPEECH_DIALECTS)
                            .filter((d) => d.language === "ar")
                            .map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.label}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          لهجة النطق الأردي (نستعليق):
                        </label>
                        <select
                          value={settings.webSpeechUrduDialect || "ur-PK"}
                          onChange={(e) =>
                            onUpdateSettings({
                              webSpeechUrduDialect: e.target.value,
                            })
                          }
                          className={`w-full px-2.5 py-1.5 rounded-xl border text-xs font-medium ${
                            darkMode
                              ? "bg-slate-900 border-slate-700"
                              : "bg-[#F8FAFC] border-[#E2E8F0]"
                          }`}
                        >
                          {Object.values(WEB_SPEECH_DIALECTS)
                            .filter((d) => d.language === "ur")
                            .map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.label}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] opacity-75">
                    ملاحظة: الآيات القرآنية المحققة تُشغّل دائماً بالتلاوة المسجلة المعتمدة (الشيخ سعود الشريم)، ويُطبَّق تنغيم القراءة الموقّرة على أي شواهد أو مقتطفات نصية.
                  </p>
                </div>
              </div>

              {/* Reset Settings Button */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={onResetSettings}
                  className="px-3.5 py-2 rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-bold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة ضبط إعدادات القارئ للوضع الافتراضي</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "voices" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#155E75]/10 border border-[#0891B2]/30 text-xs space-y-1">
                <p className="font-bold text-[#155E75] dark:text-[#A5F3FC]">
                  مختبر مقارنة الأصوات الأردية (Urdu - Pakistan) والعربية الفصحى
                </p>
                <p className="opacity-80">
                  استمع إلى كل صوت رجالي على فقرة حقيقية من كتاب «كيف تنقذ نفسك من ورطة الوسوسة؟» واختر الصوت الأنسب لك.
                </p>
              </div>

              {testError && (
                <div className="p-3 rounded-xl bg-red-500/15 text-red-600 text-xs font-bold">
                  {testError}
                </div>
              )}

              <div className="space-y-2.5">
                <h3 className="text-xs font-bold text-[#0891B2]">
                  أولاً: الأصوات الرجالية للغة الأردية (Urdu - Pakistan • ur-PK)
                </h3>
                {URDU_VOICES.map((v) => {
                  const isSelected =
                    (settings.urduVoiceId || settings.defaultUrduVoice) === v.id;
                  const isTesting = testingVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isSelected
                          ? "border-[#0891B2] bg-[#A5F3FC]/10"
                          : "border-slate-200 dark:border-slate-800"
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <span>{v.label}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-[#0891B2]" />
                          )}
                        </div>
                        <p className="text-[11px] opacity-70 mt-0.5">
                          {v.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(testingVoiceId)}
                          onClick={() =>
                            handleTestVoice(v.id, "ur-PK", SAMPLE_URDU_TEST_TEXT)
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#155E75] hover:bg-[#0891B2] text-white text-xs font-bold flex items-center gap-1"
                        >
                          {isTesting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          <span>تجربة الصوت</span>
                        </button>
                        {!isSelected && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSettings({
                                urduVoiceId: v.id,
                                defaultUrduVoice: v.id,
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-[#0891B2] text-[#0891B2] text-xs font-bold"
                          >
                            اعتماد
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2.5 pt-2">
                <h3 className="text-xs font-bold text-[#0891B2]">
                  ثانياً: الأصوات الرجالية للنصوص العربية والأحاديث النبوية (ar-SA)
                </h3>
                {ARABIC_VOICES.map((v) => {
                  const isSelected = settings.defaultArabicVoice === v.id;
                  const isTesting = testingVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isSelected
                          ? "border-[#0891B2] bg-[#A5F3FC]/10"
                          : "border-slate-200 dark:border-slate-800"
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <span>{v.label}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-[#0891B2]" />
                          )}
                        </div>
                        <p className="text-[11px] opacity-70 mt-0.5">
                          {v.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(testingVoiceId)}
                          onClick={() =>
                            handleTestVoice(
                              v.id,
                              "ar-SA",
                              SAMPLE_ARABIC_TEST_TEXT
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#155E75] hover:bg-[#0891B2] text-white text-xs font-bold flex items-center gap-1"
                        >
                          {isTesting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          <span>تجربة الصوت</span>
                        </button>
                        {!isSelected && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSettings({ defaultArabicVoice: v.id })
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-[#0891B2] text-[#0891B2] text-xs font-bold"
                          >
                            اعتماد
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "ocr" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-xs font-bold">
                    مراجعة النص الأصلي المستخرج للصفحة الحالية (صفحة{" "}
                    {pageData?.pageNumber || 1})
                  </h3>
                  <p className="text-[11px] opacity-70">
                    مصدر الاستخراج: {pageData?.extractionSource || "طبقة PDF"} •
                    دقة الاستخراج: {pageData?.qualityScore ?? 100}%
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRunningOcr}
                  onClick={onRunOcrOnCurrentPage}
                  className="px-3 py-1.5 rounded-xl bg-[#155E75] hover:bg-[#0891B2] text-white text-xs font-bold flex items-center gap-1.5"
                >
                  {isRunningOcr ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>إعادة فحص الصفحة بـ Gemini OCR (نستعليق)</span>
                </button>
              </div>

              <div className="space-y-2.5 max-h-80 overflow-y-auto">
                {(pageData?.sentences || []).length > 0 ? (
                  pageData.sentences.map((s, idx) => (
                    <div
                      key={`ocr-s-${idx}`}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#0891B2]">
                          جملة #{idx + 1} • النوع:{" "}
                          {s.segmentType === "quran"
                            ? `آية قرآنية محققة (${s.quranMeta?.surahName || ""} : ${
                                s.quranMeta?.ayahNumber || ""
                              })`
                            : s.segmentType === "hadith"
                            ? "حديث نبوي شريف"
                            : s.segmentType === "dua"
                            ? "دعاء مأثور"
                            : s.segmentType === "arabic_quote"
                            ? "نص عربي"
                            : "نص أردي (نستعليق)"}
                        </span>
                        <span className="opacity-60">
                          اللغة: {s.language === "ar" ? "العربية" : "الأردية"}
                        </span>
                      </div>
                      <p
                        className="text-sm leading-relaxed font-serif"
                        style={{
                          fontFamily:
                            "'Noto Nastaliq Urdu', 'Amiri', serif",
                        }}
                      >
                        {s.originalText}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs opacity-60">
                    لا توجد جمل مستخرجة بعد لهذه الصفحة. اضغط على زر «إعادة فحص الصفحة بـ Gemini OCR».
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "cache" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-[#0891B2]">
                  إحصائيات التخزين المؤقت المحلي (IndexedDB Audio & OCR Cache)
                </h3>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900">
                    <div className="text-base font-bold text-[#155E75] dark:text-[#A5F3FC]">
                      {cacheStats.ocrCount}
                    </div>
                    <div className="text-[11px] opacity-70">
                      صفحات OCR مخزنة
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900">
                    <div className="text-base font-bold text-[#155E75] dark:text-[#A5F3FC]">
                      {cacheStats.ttsCount}
                    </div>
                    <div className="text-[11px] opacity-70">
                      مقاطع صوتية مخزنة
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900">
                    <div className="text-base font-bold text-[#0891B2]">
                      {formatBytes(cacheStats.totalBytes)}
                    </div>
                    <div className="text-[11px] opacity-70">الحجم الإجمالي</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearCache}
                  className="px-3.5 py-2 rounded-xl border border-red-500/40 text-red-600 text-xs font-bold flex items-center gap-1.5 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>مسح ذاكرة الصوت وOCR المؤقتة</span>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-[#155E75]/10 border border-[#0891B2]/30 text-xs space-y-1.5">
                <h4 className="font-bold text-[#155E75] dark:text-[#A5F3FC]">
                  توثيق التشغيل في الخلفية (Background Audio & MediaSession):
                </h4>
                <ul className="list-disc list-inside space-y-1 opacity-85">
                  <li>
                    يدعم القارئ استمرار التشغيل عند الانتقال بين صفحات التطبيق وعند قفل الشاشة عبر{" "}
                    <code>HTML5 Audio + navigator.mediaSession</code>.
                  </li>
                  <li>
                    يدعم أزرار شاشة القفل، وأزرار السماعات السلكية والبلوتوث (تشغيل، إيقاف، الجملة التالية/السابقة، تقديم/ترجيع 10 ثوانٍ).
                  </li>
                  <li>
                    في نسخة الويب/PWA يخضع استمرار الصوت في الخلفية لسياسة توفير الطاقة في نظام التشغيل، بينما في تطبيق Android الكامل (Capacitor APK) يعمل عبر Foreground Audio Service.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
