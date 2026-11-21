/**
 * DAR AL TAWHID — Simple, Clean, Clutter-Free Smart Audio Reader Bar
 *
 * Appears ONLY when the user clicks the single "القارئ الذكي" (Smart Reader) button
 * in the bottom toolbar. Designed to be compact, responsive across all devices,
 * translated into all 6 languages, and 100% functional without covering the book.
 */

import React from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Loader2,
  X,
  Volume2,
} from "lucide-react";
import {
  PLAYBACK_SPEEDS,
  URDU_VOICES,
  ARABIC_VOICES,
  getHighlightColorConfig,
} from "@/lib/intelligentReader/readerSettings";
import { useT } from "@/lib/i18n";

export default function IntelligentAudioPlayer({
  audioState,
  readerSettings,
  isOpen = false,
  onClose,
  onPlay,
  onPause,
  onPrevSentence,
  onNextSentence,
  onChangeSpeed,
  onUpdateSettings,
  onRetryExtract,
  isRunningOcr = false,
  themeCfg,
  darkMode = false,
}) {
  const t = useT();
  if (!isOpen) return null;

  const {
    playerState,
    isExtractingPage = false,
    currentSentence,
    sentenceIndex = 0,
    totalSentencesOnPage = 0,
    wordIndex = 0,
    playbackRate = 1,
    currentSegmentInfo,
  } = audioState || {};

  const isPlaying = playerState === "playing";
  const isLoading = playerState === "loading";
  const isExtracting = Boolean(isRunningOcr || isExtractingPage);
  const isBusy = Boolean(isLoading || isExtracting);

  const colorCfg = getHighlightColorConfig(
    readerSettings?.highlightColorId || "cyan"
  );

  const words = currentSentence?.words || [];
  const isArabicSegment =
    currentSegmentInfo?.language?.startsWith("ar") ||
    currentSentence?.language === "ar";

  const activeVoiceId = isArabicSegment
    ? readerSettings?.defaultArabicVoice || "arabic_hadith_charon"
    : readerSettings?.urduVoiceId ||
      readerSettings?.defaultUrduVoice ||
      "pakistani_scholar_charon";

  const availableVoices = isArabicSegment ? ARABIC_VOICES : URDU_VOICES;

  return (
    <section
      data-viewer-ui
      dir={t.dir || "rtl"}
      aria-label={t.smartReaderTitle || "القارئ الصوتي الذكي"}
      className="w-full border-t z-30 select-none shrink-0 transition-colors shadow-lg"
      style={{
        backgroundColor:
          themeCfg?.toolbar || (darkMode ? "#11151E" : "#FFFFFF"),
        borderColor: themeCfg?.border || (darkMode ? "#262C3A" : "#E2E8F0"),
        color: themeCfg?.text || (darkMode ? "#F3F4F6" : "#1C1917"),
      }}
    >
      <div className="max-w-4xl mx-auto px-3 sm:px-5 py-2 space-y-1.5">
        {/* Single Compact Spoken Sentence Strip (Only shown when sentences exist) */}
        {words.length > 0 ? (
          <div
            dir="rtl"
            className="text-xs sm:text-sm leading-relaxed max-h-11 overflow-y-auto px-2.5 py-1 rounded-xl border flex flex-wrap items-center gap-0.5"
            style={{
              fontFamily:
                "'Noto Nastaliq Urdu', 'Amiri', 'Traditional Arabic', serif",
              backgroundColor: darkMode ? "#181E29" : "#F8FAFC",
              borderColor: darkMode ? "#2C3548" : "#E2E8F0",
            }}
          >
            {words.map((wObj, idx) => {
              const isActiveWord =
                idx === wordIndex && (isPlaying || playerState === "paused");
              return (
                <button
                  key={`w-${idx}`}
                  type="button"
                  onClick={() => onPlay?.({ sentenceIndex, wordIndex: idx })}
                  className={`inline-block px-1 py-0.5 rounded transition-colors cursor-pointer ${
                    isActiveWord
                      ? "font-bold text-stone-950"
                      : "hover:bg-emerald-500/15"
                  }`}
                  style={
                    isActiveWord
                      ? {
                          backgroundColor: colorCfg.wordBg,
                          borderBottom: `2px solid ${colorCfg.wordBorder}`,
                        }
                      : undefined
                  }
                >
                  {wObj.word}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-xs">
            <span className="opacity-80 truncate">
              {isExtracting
                ? t.smartReaderExtracting || "جاري استخراج النص..."
                : t.smartReaderNoText ||
                  "اضغط إعادة استخراج النص لقراءة هذه الصفحة صوتياً"}
            </span>
            {!isExtracting && onRetryExtract && (
              <button
                type="button"
                onClick={onRetryExtract}
                className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 hover:bg-emerald-800 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t.smartReaderRetry || "إعادة استخراج النص"}</span>
              </button>
            )}
          </div>
        )}

        {/* Main Single-Row Controls: Prev | Play/Pause | Next | Sentence Counter | Speed | Voice | Close */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Play / Pause & Sentence Navigation */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPrevSentence}
              disabled={isBusy || totalSentencesOnPage === 0}
              title={t.smartReaderPrev || "الجملة السابقة"}
              className="w-9 h-9 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => (isPlaying ? onPause?.() : onPlay?.())}
              disabled={isBusy}
              title={
                isPlaying
                  ? t.smartReaderPause || "إيقاف مؤقت"
                  : t.smartReaderPlay || "تشغيل القراءة"
              }
              className="h-9 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 disabled:opacity-50 text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden xs:inline">
                    {t.smartReaderExtracting || "جاري التجهيز..."}
                  </span>
                </>
              ) : isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>{t.smartReaderPause || "إيقاف مؤقت"}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>{t.smartReaderPlay || "تشغيل القراءة"}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onNextSentence}
              disabled={isBusy || totalSentencesOnPage === 0}
              title={t.smartReaderNext || "الجملة التالية"}
              className="w-9 h-9 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {totalSentencesOnPage > 0 && (
              <span className="text-[11px] font-mono font-bold opacity-75 px-1.5 tabular-nums">
                {sentenceIndex + 1} / {totalSentencesOnPage}
              </span>
            )}
          </div>

          {/* Speed + Voice Selector + Re-extract + Close */}
          <div className="flex items-center gap-1.5 ms-auto">
            {/* Speed */}
            <select
              aria-label={t.smartReaderSpeed || "السرعة"}
              value={playbackRate}
              onChange={(e) => onChangeSpeed?.(Number(e.target.value))}
              className="h-9 px-2 rounded-xl text-xs font-bold tabular-nums border border-current/15 bg-black/[0.03] dark:bg-white/[0.06] focus:outline-none cursor-pointer"
            >
              {PLAYBACK_SPEEDS.map((spd) => (
                <option
                  key={spd}
                  value={spd}
                  className="bg-white text-stone-900 dark:bg-slate-900 dark:text-white"
                >
                  {spd}x
                </option>
              ))}
            </select>

            {/* Voice Selector */}
            <div className="hidden sm:flex items-center gap-1">
              <Volume2 className="w-3.5 h-3.5 opacity-60" />
              <select
                aria-label={t.smartReaderVoice || "الصوت"}
                value={activeVoiceId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (isArabicSegment) {
                    onUpdateSettings?.({ defaultArabicVoice: val });
                  } else {
                    onUpdateSettings?.({
                      urduVoiceId: val,
                      defaultUrduVoice: val,
                    });
                  }
                }}
                className="h-9 max-w-[165px] truncate px-2 rounded-xl text-xs font-bold border border-current/15 bg-black/[0.03] dark:bg-white/[0.06] focus:outline-none cursor-pointer"
              >
                {availableVoices.map((v) => (
                  <option
                    key={v.id}
                    value={v.id}
                    className="bg-white text-stone-900 dark:bg-slate-900 dark:text-white"
                  >
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Re-extract OCR Button */}
            {onRetryExtract && (
              <button
                type="button"
                onClick={onRetryExtract}
                disabled={isBusy}
                title={t.smartReaderRetry || "إعادة استخراج النص"}
                className="w-9 h-9 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Close Smart Reader Bar */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title={t.smartReaderClose || "إغلاق القارئ"}
                className="w-9 h-9 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-red-500/15 hover:text-red-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
