import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  RefreshCw,
  Volume2,
  X,
  Loader2,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { intelligentAudioEngine } from "@/lib/intelligentReader/audioEngine";
import {
  loadReaderSettings,
  saveReaderSettings,
  PLAYBACK_SPEEDS,
} from "@/lib/intelligentReader/readerSettings";
import { useT } from "@/lib/i18n";

const SEGMENT_BADGE_MAP = {
  quran: {
    label: "تلاوة قرآنية مسجلة • الشيخ سعود الشريم",
    cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
  hadith: {
    label: "حديث نبوي شريف • صوت رجالي عربي تلقائي",
    cls: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  },
  dua: {
    label: "دعاء مأثور • صوت رجالي عربي تلقائي",
    cls: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  },
  arabic_quote: {
    label: "نص عربي • صوت رجالي عربي تلقائي",
    cls: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  },
  heading: {
    label: "عنوان • صوت رجالي تلقائي",
    cls: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  urdu_body: {
    label: "نص أردي • صوت رجالي أردي تلقائي (ur-PK)",
    cls: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
};

/**
 * DAR AL TAWHID — Smart Audio Reader Control Bar (100% Zero-Config Automatic Edition)
 * Automatically uses scholarly male voices:
 * - Urdu: ur-PK-AsadNeural
 * - Arabic / Hadith / Dua: ar-SA-HamedNeural
 * - Verified Quranic verses: Authentic Recorded Recitation (Sheikh Abdul Rahman Al-Sudais)
 */
export default function IntelligentAudioPlayer({
  isOpen = true,
  pageData,
  audioState,
  readerSettings: readerSettingsProp,
  isRunningOcr,
  isExtracting,
  onRetryExtract,
  onForceReOcr,
  onClose,
  onPlay,
  onPause,
  onStop,
  onPrevSentence,
  onNextSentence,
  onChangeSpeed,
  onUpdateSettings,
}) {
  const t = useT() || {};
  const [snap, setSnap] = useState(
    () => audioState || intelligentAudioEngine.getSnapshot()
  );
  const [settings, setSettings] = useState(
    () => readerSettingsProp || loadReaderSettings()
  );
  const [showQaInspector, setShowQaInspector] = useState(false);
  const activeWordRef = useRef(null);

  useEffect(() => {
    if (audioState) {
      setSnap(audioState);
    }
  }, [audioState]);

  useEffect(() => {
    return intelligentAudioEngine.subscribe((newSnap) => {
      setSnap(newSnap);
    });
  }, []);

  useEffect(() => {
    if (readerSettingsProp) {
      setSettings(readerSettingsProp);
    }
  }, [readerSettingsProp]);

  useEffect(() => {
    const onSettingsChanged = (e) => {
      if (e.detail) setSettings(e.detail);
    };
    window.addEventListener("dat:reader-settings-changed", onSettingsChanged);
    return () =>
      window.removeEventListener(
        "dat:reader-settings-changed",
        onSettingsChanged
      );
  }, []);

  // Automatically scroll the currently highlighted word into view inside the sentence container
  useEffect(() => {
    if (activeWordRef.current) {
      try {
        activeWordRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      } catch {}
    }
  }, [snap.sentenceIndex, snap.wordIndex, snap.playerState]);

  if (!isOpen) return null;

  const extracting = Boolean(
    isRunningOcr || isExtracting || snap.isExtractingPage
  );
  const handleReExtract = onRetryExtract || onForceReOcr;

  const updateSpeed = (newSpeed) => {
    const next = saveReaderSettings({ defaultSpeed: newSpeed });
    setSettings(next);
    onUpdateSettings?.({ defaultSpeed: newSpeed });
    intelligentAudioEngine.setPlaybackRate(newSpeed);
    onChangeSpeed?.(newSpeed);
  };

  const sentences =
    pageData?.sentences || intelligentAudioEngine.pageData?.sentences || [];
  const currentSentence =
    snap.currentSentence || sentences[snap.sentenceIndex] || null;
  const totalSentenceCount =
    sentences.length ||
    snap.totalSentencesOnPage ||
    (currentSentence ? 1 : 0);
  const isPlaying = snap.playerState === "playing";
  const isPaused = snap.playerState === "paused";
  const isBuffering = snap.playerState === "loading" || extracting;
  const isError = snap.playerState === "error";
  const hasSentences = totalSentenceCount > 0 || Boolean(currentSentence);

  const isUrduSentence =
    currentSentence?.language === "ur" ||
    (currentSentence?.segmentType === "urdu_body" &&
      currentSentence?.language !== "ar");

  const activeSpeed =
    settings.defaultSpeed || settings.playbackSpeed || snap.playbackRate || 1;

  const cycleSpeed = () => {
    const idx = PLAYBACK_SPEEDS.indexOf(Number(activeSpeed));
    const nextSpeed =
      idx >= 0 && idx < PLAYBACK_SPEEDS.length - 1
        ? PLAYBACK_SPEEDS[idx + 1]
        : PLAYBACK_SPEEDS[0];
    updateSpeed(nextSpeed);
  };

  const segmentBadge =
    SEGMENT_BADGE_MAP[currentSentence?.segmentType] ||
    (isUrduSentence
      ? SEGMENT_BADGE_MAP.urdu_body
      : SEGMENT_BADGE_MAP.arabic_quote);

  const handleTogglePlay = () => {
    if (isPlaying) {
      if (onPause) onPause();
      else intelligentAudioEngine.pause("immediate");
      return;
    }
    if (!hasSentences && !extracting && handleReExtract) {
      handleReExtract();
      return;
    }
    const opts = {
      sentenceIndex: snap.sentenceIndex || 0,
      wordIndex: snap.wordIndex || 0,
    };
    if (onPlay) onPlay(opts);
    else intelligentAudioEngine.playFrom(opts);
  };

  const handleStop = () => {
    if (onStop) onStop();
    else intelligentAudioEngine.stop();
  };

  const handlePrev = () => {
    if (onPrevSentence) onPrevSentence();
    else intelligentAudioEngine.prevSentence();
  };

  const handleNext = () => {
    if (onNextSentence) onNextSentence();
    else intelligentAudioEngine.nextSentence();
  };

  return (
    <div
      dir={t.dir || "rtl"}
      className="w-full z-40 px-2 sm:px-4 pb-1.5 pt-1 select-none shrink-0"
    >
      <div className="mx-auto max-w-3xl rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-amber-500/30 shadow-2xl px-3 py-2 sm:px-4 sm:py-2.5 text-white transition-all">
        {/* Top Row: Current Sentence Text + Automatic Male Voice Badge + Counter + Close */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            {extracting ? (
              <div className="flex items-center gap-2 text-xs text-amber-300 font-medium py-0.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>
                  {t.smartReaderExtracting || "جاري استخراج النص ومعالجته تلقائياً..."}
                </span>
              </div>
            ) : isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  {snap.errorCode && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/30 text-[10px] font-mono text-rose-200 shrink-0">
                      {snap.errorCode}
                    </span>
                  )}
                  <span className="truncate">
                    {snap.errorMessage ||
                      t.smartReaderAudioError ||
                      "تعذر تشغيل الصوت، يرجى المحاولة مرة أخرى"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(snap.errorCode === "TEXT_EXTRACTION_FAILED" ||
                    snap.errorCode === "INVALID_TEXT" ||
                    snap.errorCode === "OCR_FAILED") &&
                    handleReExtract && (
                      <button
                        type="button"
                        onClick={handleReExtract}
                        className="px-2 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 font-bold text-[11px] cursor-pointer"
                      >
                        تشغيل OCR
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() =>
                      intelligentAudioEngine.playFrom({
                        sentenceIndex: snap.sentenceIndex || 0,
                        wordIndex: snap.wordIndex || 0,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-rose-500/30 hover:bg-rose-500/45 text-white font-bold text-[11px] cursor-pointer"
                  >
                    {t.readerRetry || "إعادة المحاولة"}
                  </button>
                </div>
              </div>
            ) : currentSentence ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${segmentBadge.cls}`}
                  >
                    {snap.currentSegmentInfo?.badgeLabel || segmentBadge.label}
                  </span>

                  {/* Active Topic Badge (distinguishes original book headings from analytical generated titles) */}
                  {(snap.currentTopic?.title || currentSentence.topicTitle) && (
                    <span
                      title={
                        snap.currentTopic?.isGeneratedTitle ||
                        currentSentence.isGeneratedTopicTitle
                          ? "عنوان تحليلي مولد داخلياً (وليس جزءاً من نص الكتاب الأصلي)"
                          : "عنوان الموضوع من الكتاب"
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-slate-200 text-[10px] font-medium max-w-[230px] truncate"
                    >
                      <span className="text-amber-300 font-bold shrink-0">
                        {snap.currentTopic?.isGeneratedTitle ||
                        currentSentence.isGeneratedTopicTitle
                          ? "موضوع تحليلي:"
                          : "الموضوع:"}
                      </span>
                      <span className="truncate">
                        {snap.currentTopic?.title || currentSentence.topicTitle}
                      </span>
                    </span>
                  )}

                  {/* Cross-page sentence continuation indicator */}
                  {currentSentence.continuesToNextPage && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-200 text-[10px] font-bold">
                      متصل بالصفحة التالية
                    </span>
                  )}

                  {/* 10-Point QA Layer Confidence & Warning Badge */}
                  {(currentSentence.qaAudit?.hasQualityWarning ||
                    pageData?.qaReport?.hasQualityWarning) && (
                    <span
                      title={
                        currentSentence.qaAudit?.userWarningMessage ||
                        pageData?.qaReport?.userWarningMessage ||
                        "تنبيه مراجعة الجودة: يرجى التحقق البصري من النص"
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/25 border border-rose-400/40 text-rose-200 text-[10px] font-bold"
                    >
                      <AlertTriangle className="w-3 h-3 text-rose-300 shrink-0" />
                      <span>
                        {currentSentence.qaAudit?.userWarningMessage ||
                          pageData?.qaReport?.userWarningMessage ||
                          "تنبيه دقة النص"}
                      </span>
                    </span>
                  )}

                  {/* Active Linguistic Completion Stop Status */}
                  {snap.completionStopMode === "sentence" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold animate-pulse">
                      <Clock className="w-3 h-3" />
                      <span>سيتوقف بعد إكمال الجملة المكتملة...</span>
                    </span>
                  )}
                  {snap.completionStopMode === "paragraph" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold animate-pulse">
                      <Clock className="w-3 h-3" />
                      <span>سيتوقف بعد إكمال الفقرة...</span>
                    </span>
                  )}
                  {snap.completionStopMode === "topic" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold animate-pulse">
                      <Clock className="w-3 h-3" />
                      <span>
                        {snap.completionTopicIsApproximate ||
                        currentSentence.topicConfidence === "approximate"
                          ? "سيتوقف بعد إكمال الموضوع (تحديد الموضوع تقريبي • نهاية الفقرة)..."
                          : "سيتوقف بعد إكمال الموضوع..."}
                      </span>
                    </span>
                  )}
                </div>
                <div
                  dir="rtl"
                  className="text-xs sm:text-sm text-slate-100 leading-relaxed max-h-24 sm:max-h-28 overflow-y-auto pr-1"
                  style={{
                    fontFamily: isUrduSentence
                      ? "'Noto Nastaliq Urdu', 'Amiri', serif"
                      : "'Amiri', 'Traditional Arabic', serif",
                  }}
                >
                  {(currentSentence.words || []).length > 0
                    ? currentSentence.words.map((wObj, idx) => {
                        const wordText =
                          typeof wObj === "string"
                            ? wObj
                            : wObj.text || wObj.word || "";
                        const isActiveWord =
                          idx === snap.wordIndex && (isPlaying || isPaused);
                        return (
                          <span
                            key={idx}
                            ref={isActiveWord ? activeWordRef : null}
                            onClick={() =>
                              intelligentAudioEngine.playFrom({
                                sentenceIndex: snap.sentenceIndex,
                                wordIndex: idx,
                              })
                            }
                            className={`inline-block mx-0.5 px-1.5 py-0.5 rounded cursor-pointer transition-all ${
                              isActiveWord
                                ? "bg-amber-400 text-slate-950 font-bold shadow-sm scale-105"
                                : "hover:bg-white/10"
                            }`}
                          >
                            {wordText}
                          </span>
                        );
                      })
                    : currentSentence.originalText || currentSentence.text}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs text-slate-300 py-0.5">
                <span>
                  {t.smartReaderNoText ||
                    "اضغط تشغيل لقراءة هذه الصفحة تلقائياً بصوت رجالي واضح"}
                </span>
                {handleReExtract && (
                  <button
                    type="button"
                    onClick={handleReExtract}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t.smartReaderRetry || "إعادة استخراج النص"}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {hasSentences && (
              <span
                title={`الفقرة ${(currentSentence?.paragraphIndex ?? 0) + 1} من ${snap.totalParagraphsOnPage || 1}`}
                className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-bold text-amber-300 tabular-nums"
              >
                {(snap.sentenceIndex || 0) + 1} / {totalSentenceCount}
              </span>
            )}
            {onClose && (
              <button
                type="button"
                onClick={() => {
                  intelligentAudioEngine.pause("immediate");
                  onClose();
                }}
                className="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
                title={t.smartReaderClose || "إغلاق القارئ"}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Row: Transport Controls + Linguistic Completion Modes + Quick Category Jumps */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-white/10">
          {/* Playback Controls: Prev, Play/Pause, Stop, Next */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!hasSentences}
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-200 disabled:opacity-35 transition cursor-pointer"
              title={t.smartReaderPrev || "الجملة السابقة"}
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              disabled={extracting}
              className="h-8 sm:h-9 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md disabled:opacity-40 transition active:scale-95 cursor-pointer"
              title={
                isPlaying
                  ? t.smartReaderPause || "إيقاف مؤقت فوري"
                  : t.smartReaderPlay || "تشغيل القراءة"
              }
            >
              {isBuffering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              <span>
                {isPlaying
                  ? t.smartReaderPause || "إيقاف"
                  : isPaused
                  ? "متابعة"
                  : t.smartReaderPlay || "تشغيل"}
              </span>
            </button>

            {/* Stop Button */}
            <button
              type="button"
              onClick={handleStop}
              disabled={!isPlaying && !isPaused && !isBuffering}
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-200 disabled:opacity-30 transition cursor-pointer"
              title="إيقاف كامل وإرجاع لبداية الجملة"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={!hasSentences}
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-200 disabled:opacity-35 transition cursor-pointer"
              title={t.smartReaderNext || "الجملة التالية"}
            >
              <SkipBack className="w-4 h-4" />
            </button>
          </div>

          {/* Linguistic Completion Mode Controls: إكمال الجملة / إكمال الفقرة / إكمال الموضوع ثم التوقف */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              disabled={!hasSentences || extracting}
              onClick={() =>
                intelligentAudioEngine.setCompletionStopMode("sentence")
              }
              title="إكمال الجملة المكتملة لغوياً ثم التوقف"
              className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer disabled:opacity-35 ${
                snap.completionStopMode === "sentence"
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-sm"
                  : "bg-white/10 hover:bg-white/20 border-white/10 text-slate-200"
              }`}
            >
              إكمال الجملة
            </button>

            <button
              type="button"
              disabled={!hasSentences || extracting}
              onClick={() =>
                intelligentAudioEngine.setCompletionStopMode("paragraph")
              }
              title="إكمال الفقرة الحالية حتى نهايتها ثم التوقف"
              className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer disabled:opacity-35 ${
                snap.completionStopMode === "paragraph"
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-sm"
                  : "bg-white/10 hover:bg-white/20 border-white/10 text-slate-200"
              }`}
            >
              إكمال الفقرة
            </button>

            <button
              type="button"
              disabled={!hasSentences || extracting}
              onClick={() =>
                intelligentAudioEngine.setCompletionStopMode("topic")
              }
              title="إكمال الموضوع الحالي (مع تجاوز فواصل الصفحات إن استمر الموضوع) ثم التوقف"
              className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer disabled:opacity-35 ${
                snap.completionStopMode === "topic"
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-sm"
                  : "bg-white/10 hover:bg-white/20 border-white/10 text-slate-200"
              }`}
            >
              إكمال الموضوع
            </button>
          </div>

          {/* Quick Category Navigation: Jump instantly between Quran Ayahs (Shuraim), Hadiths, and Body Text */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              disabled={!hasSentences}
              onClick={() => intelligentAudioEngine.jumpToSegmentType("quran", 1)}
              title="الانتقال السريع إلى الآية القرآنية (بصوت الشيخ سعود الشريم)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer disabled:opacity-35 ${
                currentSentence?.segmentType === "quran"
                  ? "bg-emerald-500/25 border-emerald-400/50 text-emerald-200"
                  : "bg-white/10 hover:bg-emerald-500/20 border-white/10 text-emerald-300"
              }`}
            >
              <Volume2 className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>
                الآيات
                {sentences.filter((s) => s.segmentType === "quran").length > 0
                  ? ` (${sentences.filter((s) => s.segmentType === "quran").length})`
                  : ""}
              </span>
            </button>

            <button
              type="button"
              disabled={!hasSentences}
              onClick={() => intelligentAudioEngine.jumpToSegmentType("hadith", 1)}
              title="الانتقال السريع إلى الحديث أو النص العربي"
              className={`px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer disabled:opacity-35 ${
                currentSentence?.segmentType === "hadith" ||
                currentSentence?.segmentType === "dua" ||
                currentSentence?.segmentType === "arabic_quote"
                  ? "bg-sky-500/25 border-sky-400/50 text-sky-200"
                  : "bg-white/10 hover:bg-sky-500/20 border-white/10 text-sky-300"
              }`}
            >
              الأحاديث
            </button>

            <button
              type="button"
              disabled={!hasSentences}
              onClick={() => intelligentAudioEngine.jumpToSegmentType("urdu", 1)}
              title="الانتقال السريع إلى نص الشرح"
              className={`px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer disabled:opacity-35 ${
                currentSentence?.segmentType === "urdu_body" ||
                currentSentence?.segmentType === "heading"
                  ? "bg-amber-500/25 border-amber-400/50 text-amber-200"
                  : "bg-white/10 hover:bg-amber-500/20 border-white/10 text-amber-200"
              }`}
            >
              النص
            </button>

            <button
              type="button"
              onClick={cycleSpeed}
              title="تغيير سرعة القراءة"
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-amber-300 font-bold text-[11px] transition cursor-pointer tabular-nums"
            >
              {activeSpeed}x
            </button>

            {hasSentences && (
              <button
                type="button"
                onClick={() => setShowQaInspector((prev) => !prev)}
                title="مراجعة مراحل النص الأربعة وتقرير الجودة (QA) والوقف الذكي"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer ${
                  showQaInspector
                    ? "bg-emerald-500/30 border-emerald-400/60 text-emerald-200"
                    : "bg-white/10 hover:bg-white/20 border-white/10 text-slate-200"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  QA{" "}
                  {currentSentence?.extractionConfidence ??
                    pageData?.qaReport?.extractionConfidence ??
                    100}
                  %
                </span>
              </button>
            )}

            {handleReExtract && (
              <button
                type="button"
                onClick={handleReExtract}
                disabled={extracting}
                title={t.smartReaderRetry || "إعادة استخراج النص (OCR)"}
                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white disabled:opacity-40 transition cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${extracting ? "animate-spin" : ""}`}
                />
              </button>
            )}
          </div>
        </div>

        {/* Collapsible 4-Stage Text Provenance & 10-Point QA Review Panel */}
        {showQaInspector && currentSentence && (
          <div
            dir="rtl"
            className="mt-2 pt-2 border-t border-white/15 bg-slate-900/90 rounded-xl p-2.5 text-[11px] space-y-2 max-h-56 overflow-y-auto"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold">
                  ثقة الاستخراج:{" "}
                  {currentSentence.extractionConfidence ??
                    pageData?.qaReport?.extractionConfidence ??
                    100}
                  %
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold">
                  {currentSentence.pauseLabelAr || "وقف متوسط"} (
                  {currentSentence.pauseDurationMs ?? 350}ms)
                </span>
                <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/30 text-sky-300 font-bold">
                  {currentSentence.isMeaningComplete !== false
                    ? "المعنى مكتمل"
                    : "مرتبط بما بعده"}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300">
                  الفقرة {(currentSentence.paragraphIndex ?? 0) + 1} من{" "}
                  {snap.totalParagraphsOnPage ||
                    pageData?.totalParagraphsOnPage ||
                    1}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowQaInspector(false)}
                className="text-slate-400 hover:text-white text-[10px] font-bold cursor-pointer"
              >
                إغلاق المراجعة
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] font-bold text-slate-400 mb-0.5">
                  1. Original Extracted Text (النص الخام المستخرج):
                </div>
                <div className="text-slate-200 break-words">
                  {currentSentence.originalExtractedText ||
                    currentSentence.originalText}
                </div>
              </div>
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] font-bold text-amber-300 mb-0.5">
                  2. OCR Corrected Text (النص المطابق للكتاب):
                </div>
                <div className="text-slate-100 break-words">
                  {currentSentence.ocrCorrectedText ||
                    currentSentence.originalText}
                </div>
              </div>
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] font-bold text-sky-300 mb-0.5">
                  3. Linguistic Processing Text (المعالجة اللغوية):
                </div>
                <div className="text-slate-100 break-words">
                  {currentSentence.linguisticProcessedText ||
                    currentSentence.originalText}
                </div>
              </div>
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] font-bold text-emerald-300 mb-0.5">
                  4. TTS Input Text (نص الإدخال لمحرك الصوت):
                </div>
                <div className="text-slate-100 break-words">
                  {currentSentence.ttsInputText ||
                    currentSentence.cleanedPronunciationText}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
