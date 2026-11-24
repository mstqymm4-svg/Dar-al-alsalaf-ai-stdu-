/**
 * DAR AL TAWHID — Intelligent Audio Engine & Background Playback Controller
 *
 * Responsibilities:
 * - Single Unified Source of Truth for Page, Text, Audio, Word Highlight, and Reading Position
 * - Strict Concurrency Lock (_playSessionId) preventing overlapping/duplicate audio playback
 * - Modular TTS Provider Manager (Server-side Gemini 3.8 Neural TTS ur-PK/ar-SA, Google Cloud TTS, Server Neural Fallback, Offline Web Speech)
 * - Authentic Recorded Quran Recitation Player (Never uses TTS for verified Quranic verses)
 * - Acoustic Word & Sentence Synchronizer (Uses server-computed RMS energy & phonetic syllable word timings; never naive duration/wordCount)
 * - Pause Mode Controller (Immediate Pause vs. Complete Current Sentence Then Pause)
 * - Structured 10-Category Error Classification & Recovery
 * - Background Audio & MediaSession Manager
 */

import { getCachedTtsAudio, setCachedTtsAudio } from "./cacheManager";
import { loadReaderSettings } from "./readerSettings";
import {
  saveReadingPosition,
  computeFileFingerprint,
} from "./positionManager";
import {
  READER_ERROR_CODES,
  validateUrduArabicText,
  normalizeUrduTextForPronunciation,
  detectIsUrduScript,
  canonicalizeTextForLanguage,
} from "./textProcessor";

class IntelligentAudioEngine {
  constructor() {
    this.audioEl = null;
    this.listeners = new Set();

    // Active book & page context
    this.book = null;
    this.bookId = null;
    this.fileVersion = "v1";
    this.totalPages = 1;
    this.pageNumber = 1;
    this.pageData = null; // { sentences: [...], blocks: [...], qualityScore, ... }

    // Playback state
    this.playerState = "idle"; // "idle" | "loading" | "playing" | "paused" | "stopped" | "error"
    this.errorCode = null;
    this.errorTitle = "";
    this.errorMessage = "";
    this.sentenceIndex = 0;
    this.wordIndex = 0;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    this.playbackRate = 1;
    this.volume = 1;

    // Restored position target (applied when pageData for that page finishes extracting)
    this._pendingRestoredPosition = null;

    // Pause control ("immediate" | "complete_sentence")
    this.pendingPauseAfterSentence = false;
    this.wasInterruptedBySystem = false;

    // Active timings for the currently playing sentence
    this.currentWordTimings = [];
    this.currentSegmentInfo = null; // { segmentType, language, quranMeta, provider, voiceId }

    // Callbacks registered by active reader view
    this.onRequestPageTurn = null;
    this.onEnsurePageExtracted = null;
    this.isExtractingPage = false;

    // Concurrency & lifecycle guards
    this._playSessionId = 0;
    this._rafId = null;
    this._currentBlobUrl = null;
    this._abortController = null;

    this._initAudioElement();
    this._initSystemInterruptionHandlers();
  }

  _initAudioElement() {
    if (typeof window === "undefined") return;
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
    this.audioEl.crossOrigin = "anonymous";

    this.audioEl.addEventListener("loadedmetadata", () => {
      this.durationSec = Number.isFinite(this.audioEl.duration)
        ? this.audioEl.duration
        : 0;
      this._emit();
    });

    this.audioEl.addEventListener("timeupdate", () => {
      this.currentTimeSec = this.audioEl.currentTime || 0;
      this._syncWordIndexFromTime(this.currentTimeSec * 1000);
      this._emit();
    });

    this.audioEl.addEventListener("play", () => {
      this.playerState = "playing";
      this._startHighResSyncLoop();
      this._updateMediaSessionPlaybackState("playing");
      this._emit();
    });

    this.audioEl.addEventListener("pause", () => {
      if (this.playerState !== "stopped" && this.playerState !== "loading") {
        this.playerState = "paused";
        this._persistPosition();
      }
      this._stopHighResSyncLoop();
      this._updateMediaSessionPlaybackState("paused");
      this._emit();
    });

    this.audioEl.addEventListener("ended", () => {
      this._stopHighResSyncLoop();
      this._handleSentenceEnded();
    });
  }

  _initSystemInterruptionHandlers() {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", () => {
      this._persistPosition();
    });

    document.addEventListener("visibilitychange", () => {
      this._persistPosition();
      const settings = loadReaderSettings();
      if (document.hidden && !settings.backgroundReadingEnabled) {
        if (this.playerState === "playing") {
          this.pause("immediate");
        }
      }
    });
  }

  _setError(codeKey, customDetail = "") {
    const entry =
      READER_ERROR_CODES[codeKey] || READER_ERROR_CODES.TTS_FAILED;
    this.playerState = "error";
    this.errorCode = entry.code;
    this.errorTitle = entry.titleAr;
    this.errorMessage = customDetail
      ? `${entry.titleAr}: ${customDetail}`
      : entry.messageAr;
    this._emit();
  }

  _clearError() {
    this.errorCode = null;
    this.errorTitle = "";
    this.errorMessage = "";
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  _emit() {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {}
    }
  }

  setExtractingPage(isExtracting) {
    this.isExtractingPage = Boolean(isExtracting);
    if (this.isExtractingPage && this.playerState === "error") {
      this._clearError();
      this.playerState = "idle";
    }
    this._emit();
  }

  /**
   * Restore a previously saved reading position for the active book
   */
  restoreSavedPosition(savedPos) {
    if (!savedPos) return;
    this._pendingRestoredPosition = savedPos;
    if (typeof savedPos.pageNumber === "number" && savedPos.pageNumber >= 1) {
      this.pageNumber = savedPos.pageNumber;
    }
    if (typeof savedPos.sentenceIndex === "number" && savedPos.sentenceIndex >= 0) {
      this.sentenceIndex = savedPos.sentenceIndex;
    }
    if (typeof savedPos.wordIndex === "number" && savedPos.wordIndex >= 0) {
      this.wordIndex = savedPos.wordIndex;
    }
    if (typeof savedPos.playbackRate === "number" && savedPos.playbackRate > 0) {
      this.playbackRate = savedPos.playbackRate;
    }
    this._emit();
  }

  getSnapshot() {
    const sentences = this.pageData?.sentences || [];
    const currentSentence = sentences[this.sentenceIndex] || null;
    const currentWords = currentSentence?.words || [];
    const currentWordObj = currentWords[this.wordIndex] || null;
    const totalWordsOnPage =
      this.pageData?.totalWordsOnPage ??
      sentences.reduce((sum, s) => sum + (s.words?.length || 0), 0);

    return {
      book: this.book,
      bookId: this.bookId,
      pageNumber: this.pageNumber,
      totalPages: this.totalPages,
      playerState: this.playerState,
      isExtractingPage: this.isExtractingPage,
      errorCode: this.errorCode,
      errorTitle: this.errorTitle,
      errorMessage: this.errorMessage,
      sentenceIndex: this.sentenceIndex,
      paragraphIndex: currentSentence?.paragraphIndex ?? 0,
      totalSentencesOnPage: sentences.length,
      totalWordsOnPage,
      wordIndex: this.wordIndex,
      totalWordsInSentence: currentWords.length,
      currentSentence,
      currentWord: currentWordObj?.word || "",
      currentWordRect: currentWordObj?.rect || null,
      hasExactWordCoords: Boolean(currentSentence?.hasExactWordCoords),
      currentTimeSec: this.currentTimeSec,
      durationSec: this.durationSec,
      playbackRate: this.playbackRate,
      volume: this.volume,
      pendingPauseAfterSentence: this.pendingPauseAfterSentence,
      currentSegmentInfo: this.currentSegmentInfo,
      pageQualityScore: this.pageData?.qualityScore ?? 100,
      hasOcrWarnings: Boolean(this.pageData?.hasOcrWarnings),
      ocrWarningMessage: this.pageData?.ocrWarningMessage || "",
      extractionSource: this.pageData?.extractionSource || "pdf-text-layer",
    };
  }

  /**
   * Bind current book and extracted page data (Single Source of Truth sync)
   */
  setContext({
    book,
    pageNumber,
    totalPages,
    pageData,
    isExtractingPage,
    onRequestPageTurn,
    onEnsurePageExtracted,
  }) {
    const incomingBookId = String(book?.id || "");
    const incomingPageNum = Number(pageNumber || 1);
    const isSameBookAndPage =
      this.bookId === incomingBookId && this.pageNumber === incomingPageNum;

    this.book = book;
    this.bookId = incomingBookId;
    this.fileVersion = computeFileFingerprint(book);
    this.pageNumber = incomingPageNum;
    this.totalPages = Math.max(
      1,
      Number(totalPages || book?.pages_count || book?.page_count || 1)
    );

    if (pageData !== undefined) {
      this.pageData = pageData;
      const sents = pageData?.sentences || [];
      if (sents.length > 0 && this.playerState === "error") {
        this._clearError();
        this.playerState = "idle";
      }

      // If we have a restored reading position for this exact book & page, clamp sentenceIndex/wordIndex to valid bounds
      if (
        this._pendingRestoredPosition &&
        String(this._pendingRestoredPosition.bookId) === incomingBookId &&
        Number(this._pendingRestoredPosition.pageNumber) === incomingPageNum &&
        sents.length > 0
      ) {
        const targetSIdx = Math.max(
          0,
          Math.min(
            sents.length - 1,
            Number(this._pendingRestoredPosition.sentenceIndex) || 0
          )
        );
        const targetWords = sents[targetSIdx]?.words || [];
        const targetWIdx = Math.max(
          0,
          Math.min(
            Math.max(0, targetWords.length - 1),
            Number(this._pendingRestoredPosition.wordIndex) || 0
          )
        );
        this.sentenceIndex = targetSIdx;
        this.wordIndex = targetWIdx;
        this._pendingRestoredPosition = null;
      } else if (sents.length > 0 && this.sentenceIndex >= sents.length) {
        this.sentenceIndex = 0;
        this.wordIndex = 0;
      }
    }

    if (isExtractingPage !== undefined) {
      this.isExtractingPage = Boolean(isExtractingPage);
    }
    if (onRequestPageTurn) {
      this.onRequestPageTurn = onRequestPageTurn;
    }
    if (onEnsurePageExtracted) {
      this.onEnsurePageExtracted = onEnsurePageExtracted;
    }

    const settings = loadReaderSettings();
    if (this.playerState === "idle" || this.playerState === "stopped") {
      this.playbackRate = settings.defaultSpeed || 1;
    }
    this.volume = settings.volume ?? 1;

    if (!isSameBookAndPage && this.playerState !== "playing") {
      if (
        !this._pendingRestoredPosition ||
        Number(this._pendingRestoredPosition.pageNumber) !== incomingPageNum
      ) {
        this.sentenceIndex = 0;
        this.wordIndex = 0;
        this.currentTimeSec = 0;
        this.durationSec = 0;
      }
    }

    this._setupMediaSessionMetadata();
    this._emit();
  }

  /**
   * Start or resume playback from a specific sentence & word index
   */
  async playFrom({ sentenceIndex = null, wordIndex = null } = {}) {
    this._clearError();
    this.pendingPauseAfterSentence = false;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this._setError("NETWORK_OFFLINE");
      return;
    }

    let sentences = this.pageData?.sentences || [];

    // If text is not yet extracted or is empty, automatically trigger/await extraction before trying to play
    if (
      sentences.length === 0 &&
      typeof this.onEnsurePageExtracted === "function"
    ) {
      try {
        this.isExtractingPage = true;
        this.playerState = "loading";
        this._emit();
        const extractedData = await this.onEnsurePageExtracted(this.pageNumber);
        if (extractedData && Array.isArray(extractedData.sentences)) {
          this.pageData = extractedData;
          sentences = extractedData.sentences;
        }
      } catch (e) {
        console.warn("[IntelligentAudioEngine] On-demand extraction failed:", e);
        this.isExtractingPage = false;
        this._setError(
          e?.code === "OCR_FAILED" ? "OCR_FAILED" : "TEXT_EXTRACTION_FAILED",
          e?.message || ""
        );
        return;
      } finally {
        this.isExtractingPage = false;
      }
    }

    if (sentences.length === 0) {
      this._setError("TEXT_EXTRACTION_FAILED");
      return;
    }

    // If paused on the exact same sentence and no explicit jump requested, resume cleanly
    if (
      sentenceIndex === null &&
      wordIndex === null &&
      this.playerState === "paused" &&
      this.audioEl?.src &&
      this.currentTimeSec > 0 &&
      this.currentTimeSec < this.durationSec
    ) {
      try {
        this.audioEl.playbackRate = this.playbackRate;
        this.audioEl.volume = this.volume;
        await this.audioEl.play();
        return;
      } catch {}
    }

    if (sentenceIndex !== null) {
      this.sentenceIndex = Math.max(
        0,
        Math.min(sentences.length - 1, Number(sentenceIndex))
      );
    }
    this.wordIndex = wordIndex !== null ? Math.max(0, Number(wordIndex)) : 0;

    await this._loadAndPlayCurrentSentence(this.wordIndex);
  }

  async _loadAndPlayCurrentSentence(startAtWordIndex = 0) {
    const sentences = this.pageData?.sentences || [];
    const sentence = sentences[this.sentenceIndex];
    if (!sentence) {
      this.stop();
      return;
    }

    // Increment session ID & stop any current playback to prevent concurrent audio overlap
    const sessionId = ++this._playSessionId;
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {}
    }
    this._abortController = new AbortController();

    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    this.playerState = "loading";
    this._clearError();
    this.wordIndex = startAtWordIndex;
    this._emit();

    const settings = loadReaderSettings();

    try {
      // ─── Case 1: Verified Quranic Verse → Play Authentic Recorded Recitation ONLY ───
      if (
        sentence.segmentType === "quran" &&
        sentence.quranMeta?.verified &&
        sentence.quranMeta?.audioUrl
      ) {
        this.currentSegmentInfo = {
          segmentType: "quran",
          language: "ar",
          badgeLabel: `تلاوة قرآنية مسجلة • ${sentence.quranMeta.surahName} (${sentence.quranMeta.ayahNumber})`,
          provider: "quran-authentic-recording",
          voiceId: settings.quranReciterId || "ar.alafasy",
          quranMeta: sentence.quranMeta,
        };
        this.currentWordTimings = [];

        await this._playAudioSource(
          sentence.quranMeta.audioUrl,
          sentence.quranMeta.directAudioUrl,
          startAtWordIndex,
          sentence.words || [],
          sessionId
        );
        if (sessionId === this._playSessionId) {
          this._prefetchNextSentence(this.sentenceIndex + 1);
        }
        return;
      }

      // ─── Case 2: Urdu Body, Hadith, Dua, Arabic Quote, Heading, or Footnote → Neural TTS Engine ───
      const rawCandidate =
        sentence.cleanedPronunciationText || sentence.originalText || "";
      const validation = validateUrduArabicText(rawCandidate);
      const speakableCandidate = (
        validation.repairedText ||
        rawCandidate ||
        ""
      ).trim();
      if (
        !speakableCandidate ||
        !/[\u0621-\u065F\u0670-\u06D3\u0750-\u077Fa-zA-Z]/.test(
          speakableCandidate
        )
      ) {
        this._setError(
          validation.errorCode || "INVALID_TEXT",
          validation.reason || ""
        );
        return;
      }

      const baseNormalized = normalizeUrduTextForPronunciation(
        speakableCandidate
      );

      // Automatic per-sentence language classification (Arabic vs Urdu)
      const isUrdu = detectIsUrduScript(baseNormalized);
      const isArabic = !isUrdu;

      // Canonicalize Unicode codepoints for the target language so Arabic TTS never drops Indo-Pak codepoints
      // and Urdu TTS always receives canonical Pakistani Urdu codepoints.
      const spokenText = canonicalizeTextForLanguage(
        baseNormalized,
        isArabic ? "ar" : "ur"
      );

      const sentenceWordList = (sentence.words || [])
        .map((w) =>
          canonicalizeTextForLanguage(
            String(w?.word || w?.text || w || "").trim(),
            isArabic ? "ar" : "ur"
          )
        )
        .filter(Boolean);

      // Lock automatic optimal male scholarly voices:
      // - Arabic: ar-SA-HamedNeural ("arabic_hadith_charon")
      // - Urdu:   ur-PK-AsadNeural  ("pakistani_scholar_charon")
      const voiceId = isArabic
        ? "arabic_hadith_charon"
        : "pakistani_scholar_charon";
      const languageCode = isArabic ? "ar-SA" : "ur-PK";

      const badgeLabelMap = {
        hadith: "حديث نبوي شريف • صوت رجالي عربي تلقائي",
        dua: "دعاء مأثور • صوت رجالي عربي تلقائي",
        arabic_quote: "نص عربي • صوت رجالي عربي تلقائي",
        heading: isArabic
          ? "عنوان عربي • صوت رجالي تلقائي"
          : "عنوان أردي • صوت رجالي تلقائي (ur-PK)",
        urdu_body: isArabic
          ? "نص عربي • صوت رجالي عربي تلقائي"
          : "نص أردي • صوت رجالي أردي تلقائي (ur-PK)",
      };

      this.currentSegmentInfo = {
        segmentType: sentence.segmentType,
        language: languageCode,
        badgeLabel:
          badgeLabelMap[sentence.segmentType] ||
          (isArabic
            ? "نص عربي • صوت رجالي عربي تلقائي"
            : "نص أردي • صوت رجالي أردي تلقائي (ur-PK)"),
        provider: "edge-neural-tts",
        voiceId,
      };

      // Check IndexedDB Audio Cache first
      let ttsPayload = await getCachedTtsAudio(
        spokenText,
        voiceId,
        languageCode
      );

      if (sessionId !== this._playSessionId) return;

      if (!ttsPayload) {
        const res = await fetch("/api/reader/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: this._abortController.signal,
          body: JSON.stringify({
            text: spokenText,
            language: languageCode,
            segmentType: sentence.segmentType,
            voiceId,
            words: sentenceWordList,
          }),
        });

        if (sessionId !== this._playSessionId) return;

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          const errObj = new Error(
            errJson.error || `فشل توليد الصوت (HTTP ${res.status})`
          );
          errObj.code = errJson.errorCode || "TTS_FAILED";
          throw errObj;
        }

        ttsPayload = await res.json();
        if (ttsPayload?.audioBase64) {
          await setCachedTtsAudio(
            spokenText,
            voiceId,
            languageCode,
            ttsPayload
          );
        }
      }

      if (sessionId !== this._playSessionId) return;

      if (!ttsPayload?.audioBase64) {
        const errObj = new Error("لم يتم استلام بيانات صوتية صالحة من الخادم");
        errObj.code = "TTS_FAILED";
        throw errObj;
      }

      this.currentWordTimings = Array.isArray(ttsPayload.wordTimings)
        ? ttsPayload.wordTimings.map((t) => ({ ...t }))
        : [];

      const blobUrl = this._base64ToBlobUrl(
        ttsPayload.audioBase64,
        ttsPayload.mimeType || "audio/mpeg"
      );

      await this._playAudioSource(
        blobUrl,
        null,
        startAtWordIndex,
        sentence.words || [],
        sessionId
      );

      if (sessionId === this._playSessionId) {
        this._prefetchNextSentence(this.sentenceIndex + 1);
      }
    } catch (err) {
      if (err?.name === "AbortError" || sessionId !== this._playSessionId) {
        return;
      }
      console.warn("[IntelligentAudioEngine] Fallback/Error:", err);

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this._setError("NETWORK_OFFLINE");
        return;
      }

      // Try Web Speech API offline fallback if browser supports ur-PK or ar-SA
      const usedOfflineSpeech = this._tryBrowserSpeechFallback(
        sentence,
        startAtWordIndex,
        sessionId
      );
      if (!usedOfflineSpeech) {
        const code = err?.code || "TTS_FAILED";
        this._setError(code, err?.message || "");
      }
    }
  }

  async _playAudioSource(
    primaryUrl,
    backupUrl = null,
    startAtWordIndex = 0,
    words = [],
    sessionId = this._playSessionId
  ) {
    if (!this.audioEl || sessionId !== this._playSessionId) return;

    this.audioEl.pause();
    this.audioEl.src = primaryUrl;
    this.audioEl.playbackRate = this.playbackRate;
    this.audioEl.volume = this.volume;

    await new Promise((resolve, reject) => {
      const onCanPlay = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        if (backupUrl && this.audioEl.src !== backupUrl) {
          this.audioEl.src = backupUrl;
          this.audioEl.load();
          this.audioEl.addEventListener("canplay", onCanPlay, { once: true });
          this.audioEl.addEventListener(
            "error",
            () => {
              const e = new Error("تعذر تحميل الملف الصوتي");
              e.code = "AUDIO_LOAD_FAILED";
              reject(e);
            },
            { once: true }
          );
        } else {
          const e = new Error("تعذر تحميل الملف الصوتي");
          e.code = "AUDIO_LOAD_FAILED";
          reject(e);
        }
      };
      const cleanup = () => {
        this.audioEl.removeEventListener("canplay", onCanPlay);
        this.audioEl.removeEventListener("error", onError);
      };
      this.audioEl.addEventListener("canplay", onCanPlay, { once: true });
      this.audioEl.addEventListener("error", onError, { once: true });
      this.audioEl.load();
    });

    if (sessionId !== this._playSessionId) return;

    const realDurationMs =
      Number.isFinite(this.audioEl.duration) && this.audioEl.duration > 0
        ? this.audioEl.duration * 1000
        : 0;

    // 1. If no precomputed timings exist, build phonetic syllable-weighted timings from real decoded duration
    if (
      this.currentWordTimings.length === 0 &&
      words.length > 0 &&
      realDurationMs > 0
    ) {
      this.currentWordTimings = this._buildPhoneticTimingsForDuration(
        words,
        realDurationMs
      );
    } else if (
      this.currentWordTimings.length > 0 &&
      realDurationMs > 250
    ) {
      // 2. Re-calibrate precomputed timings if the server's estimated duration differs from the browser's real decoded duration
      const lastTiming =
        this.currentWordTimings[this.currentWordTimings.length - 1];
      const lastEndMs = Number(lastTiming?.endMs || 0);
      if (
        lastEndMs > 100 &&
        Math.abs(realDurationMs - lastEndMs) / realDurationMs > 0.08
      ) {
        const scale = Math.max(
          0.25,
          Math.min(3.5, (realDurationMs - 60) / lastEndMs)
        );
        this.currentWordTimings = this.currentWordTimings.map((t) => ({
          ...t,
          startMs: Math.round(t.startMs * scale),
          endMs: Math.round(t.endMs * scale),
        }));
      }
    }

    // If user clicked a specific word inside the sentence, seek directly to that word's onset timestamp
    if (startAtWordIndex > 0 && this.currentWordTimings[startAtWordIndex]) {
      const targetSec =
        this.currentWordTimings[startAtWordIndex].startMs / 1000;
      if (
        Number.isFinite(targetSec) &&
        targetSec < (this.audioEl.duration || 9999)
      ) {
        this.audioEl.currentTime = targetSec;
      }
    }

    await this.audioEl.play();
    this._persistPosition();
  }

  _buildPhoneticTimingsForDuration(words, totalDurationMs) {
    const leadInMs = Math.min(180, totalDurationMs * 0.04);
    const activeMs = Math.max(100, totalDurationMs - leadInMs * 2);
    const weights = words.map((wObj) => {
      const w = String(wObj.word || wObj || "");
      const clean = w.replace(/[^\u0600-\u06FF\w]/g, "");
      const maddCount = (clean.match(/[اويآىے]/g) || []).length;
      return Math.max(1.2, clean.length * 0.8 + maddCount * 0.7);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = leadInMs;
    return words.map((wObj, idx) => {
      const span = (weights[idx] / totalWeight) * activeMs;
      const item = {
        word: wObj.word || "",
        wordIndex: idx,
        startMs: Math.round(cursor),
        endMs: Math.round(cursor + span),
        confidence: "phonetic-syllable-weighted",
      };
      cursor += span;
      return item;
    });
  }

  async _prefetchNextSentence(nextIdx) {
    const sentences = this.pageData?.sentences || [];
    const nextSent = sentences[nextIdx];
    if (!nextSent || nextSent.segmentType === "quran") return;

    const baseNormalized = normalizeUrduTextForPronunciation(
      nextSent.cleanedPronunciationText || nextSent.originalText
    );
    const isUrdu = detectIsUrduScript(baseNormalized);
    const isArabic = !isUrdu;
    const voiceId = isArabic
      ? "arabic_hadith_charon"
      : "pakistani_scholar_charon";
    const langCode = isArabic ? "ar-SA" : "ur-PK";
    const spokenText = canonicalizeTextForLanguage(
      baseNormalized,
      isArabic ? "ar" : "ur"
    );
    const nextWordList = (nextSent.words || [])
      .map((w) =>
        canonicalizeTextForLanguage(
          String(w?.word || w?.text || w || "").trim(),
          isArabic ? "ar" : "ur"
        )
      )
      .filter(Boolean);

    const existing = await getCachedTtsAudio(spokenText, voiceId, langCode);
    if (existing) return;

    try {
      const res = await fetch("/api/reader/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spokenText,
          language: langCode,
          segmentType: nextSent.segmentType,
          voiceId,
          words: nextWordList,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.audioBase64) {
          await setCachedTtsAudio(spokenText, voiceId, langCode, data);
        }
      }
    } catch {}
  }

  _tryBrowserSpeechFallback(sentence, startAtWordIndex = 0, sessionId = this._playSessionId) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const baseNormalized = normalizeUrduTextForPronunciation(
        sentence.cleanedPronunciationText || sentence.originalText
      );
      const isUrdu = detectIsUrduScript(baseNormalized);
      const isArabic = !isUrdu;
      const spokenText = canonicalizeTextForLanguage(
        baseNormalized,
        isArabic ? "ar" : "ur"
      );
      const utter = new SpeechSynthesisUtterance(spokenText);
      utter.lang = isArabic ? "ar-SA" : "ur-PK";
      utter.rate = this.playbackRate;
      utter.volume = this.volume;

      utter.onstart = () => {
        if (sessionId !== this._playSessionId) return;
        this.playerState = "playing";
        this.wordIndex = startAtWordIndex;
        this._emit();
      };
      utter.onboundary = (e) => {
        if (sessionId !== this._playSessionId) return;
        if (e.name === "word") {
          const words = sentence.words || [];
          if (this.wordIndex < words.length - 1) {
            this.wordIndex++;
            this._emit();
          }
        }
      };
      utter.onend = () => {
        if (sessionId !== this._playSessionId) return;
        this._handleSentenceEnded();
      };
      utter.onerror = () => {
        if (sessionId !== this._playSessionId) return;
        this._setError("TTS_FAILED", "تعذر تشغيل محرك النطق المحلي.");
      };

      window.speechSynthesis.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  _startHighResSyncLoop() {
    this._stopHighResSyncLoop();
    const tick = () => {
      if (this.audioEl && !this.audioEl.paused) {
        const currentMs = this.audioEl.currentTime * 1000;
        this._syncWordIndexFromTime(currentMs);
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopHighResSyncLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _syncWordIndexFromTime(currentMs) {
    if (!this.currentWordTimings || this.currentWordTimings.length === 0) return;
    let foundIdx = this.wordIndex;
    for (let i = 0; i < this.currentWordTimings.length; i++) {
      const t = this.currentWordTimings[i];
      if (currentMs >= t.startMs && currentMs <= t.endMs + 40) {
        foundIdx = i;
        break;
      } else if (currentMs > t.endMs) {
        foundIdx = i;
      }
    }
    if (foundIdx !== this.wordIndex) {
      this.wordIndex = foundIdx;
      this._emit();
    }
  }

  _handleSentenceEnded() {
    const sentences = this.pageData?.sentences || [];

    // Check if user requested "Complete current sentence then pause" (المشكلة السادسة)
    if (this.pendingPauseAfterSentence) {
      this.pendingPauseAfterSentence = false;
      this.playerState = "paused";
      if (this.sentenceIndex < sentences.length - 1) {
        this.sentenceIndex++;
        this.wordIndex = 0;
      }
      this._persistPosition();
      this._emit();
      return;
    }

    // Advance to next sentence on current page
    if (this.sentenceIndex < sentences.length - 1) {
      this.sentenceIndex++;
      this.wordIndex = 0;
      this._persistPosition();
      this._loadAndPlayCurrentSentence(0);
      return;
    }

    // Current page finished — check if we should auto-advance to next page
    const settings = loadReaderSettings();
    if (
      settings.pageTransitionMode === "auto" &&
      this.pageNumber < this.totalPages &&
      typeof this.onRequestPageTurn === "function"
    ) {
      const nextPage = this.pageNumber + 1;
      this.sentenceIndex = 0;
      this.wordIndex = 0;
      this.onRequestPageTurn(nextPage, { autoContinueAudio: true });
    } else {
      this.playerState = "stopped";
      this._persistPosition();
      this._emit();
    }
  }

  /**
   * Pause playback with support for:
   * - "immediate": Pauses right away at the current word
   * - "complete_sentence": Finishes speaking the current sentence then pauses automatically
   */
  pause(modeOverride = null) {
    const settings = loadReaderSettings();
    const mode = modeOverride || settings.pauseBehavior || "immediate";

    if (mode === "complete_sentence" && this.playerState === "playing") {
      this.pendingPauseAfterSentence = true;
      this._emit();
      return;
    }

    this._playSessionId++;
    this.pendingPauseAfterSentence = false;
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {}
    }
    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.pause();
      } catch {}
    }
    this.playerState = "paused";
    this._persistPosition();
    this._emit();
  }

  stop() {
    this._playSessionId++;
    this.pendingPauseAfterSentence = false;
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {}
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.playerState = "stopped";
    this.wordIndex = 0;
    this.currentTimeSec = 0;
    this._persistPosition();
    this._emit();
  }

  seekBySeconds(deltaSec) {
    if (!this.audioEl || !Number.isFinite(this.audioEl.duration)) return;
    const nextTime = Math.max(
      0,
      Math.min(
        this.audioEl.duration,
        (this.audioEl.currentTime || 0) + deltaSec
      )
    );
    this.audioEl.currentTime = nextTime;
    this.currentTimeSec = nextTime;
    this._syncWordIndexFromTime(nextTime * 1000);
    this._persistPosition();
    this._emit();
  }

  seekToRatio(ratio) {
    if (!this.audioEl || !Number.isFinite(this.audioEl.duration)) return;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const nextTime = clamped * this.audioEl.duration;
    this.audioEl.currentTime = nextTime;
    this.currentTimeSec = nextTime;
    this._syncWordIndexFromTime(nextTime * 1000);
    this._persistPosition();
    this._emit();
  }

  nextSentence() {
    const sentences = this.pageData?.sentences || [];
    if (this.sentenceIndex < sentences.length - 1) {
      this.playFrom({ sentenceIndex: this.sentenceIndex + 1, wordIndex: 0 });
    } else if (
      this.pageNumber < this.totalPages &&
      typeof this.onRequestPageTurn === "function"
    ) {
      this.onRequestPageTurn(this.pageNumber + 1, {
        autoContinueAudio: this.playerState === "playing",
      });
    }
  }

  prevSentence() {
    if (this.sentenceIndex > 0) {
      this.playFrom({ sentenceIndex: this.sentenceIndex - 1, wordIndex: 0 });
    } else if (
      this.pageNumber > 1 &&
      typeof this.onRequestPageTurn === "function"
    ) {
      this.onRequestPageTurn(this.pageNumber - 1, {
        autoContinueAudio: this.playerState === "playing",
      });
    }
  }

  setPlaybackRate(rate) {
    const validRate = Number(rate) || 1;
    this.playbackRate = validRate;
    if (this.audioEl) {
      this.audioEl.playbackRate = validRate;
    }
    this._persistPosition();
    this._emit();
  }

  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol) ?? 1));
    this.volume = clamped;
    if (this.audioEl) {
      this.audioEl.volume = clamped;
    }
    this._emit();
  }

  _base64ToBlobUrl(base64, mimeType = "audio/wav") {
    if (this._currentBlobUrl) {
      try {
        URL.revokeObjectURL(this._currentBlobUrl);
      } catch {}
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    this._currentBlobUrl = URL.createObjectURL(blob);
    return this._currentBlobUrl;
  }

  _persistPosition() {
    if (!this.bookId) return;
    try {
      const sentences = this.pageData?.sentences || [];
      const currentSent = sentences[this.sentenceIndex];
      const saved = saveReadingPosition(this.bookId, {
        bookId: this.bookId,
        bookTitle: this.book?.title || "",
        fileVersion: this.fileVersion,
        pageNumber: this.pageNumber,
        paragraphIndex: currentSent?.paragraphIndex || 0,
        sentenceIndex: this.sentenceIndex,
        wordIndex: this.wordIndex,
        wordText: currentSent?.words?.[this.wordIndex]?.word || "",
        sentencePreview: (currentSent?.originalText || "").slice(0, 90),
        audioTimeSec: Math.round((this.currentTimeSec || 0) * 10) / 10,
        language: this.currentSegmentInfo?.language || "ur-PK",
        playbackRate: this.playbackRate,
        selectedVoice:
          this.currentSegmentInfo?.voiceId || "pakistani_scholar_charon",
        playerState: this.playerState,
      });
      if (!saved && typeof window !== "undefined") {
        console.warn("[IntelligentAudioEngine] POSITION_SAVE_FAILED");
      }
    } catch {
      console.warn("[IntelligentAudioEngine] POSITION_SAVE_FAILED");
    }
  }

  // ─── MediaSession Lock-Screen & Headset Controls ─────────────────────────────
  _setupMediaSessionMetadata() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    try {
      const title = this.book?.title || "القارئ الذكي — DAR AL TAWHID";
      const author = this.book?.author || "DAR AL TAWHID";
      const cover =
        this.book?.cover_image ||
        "https://media.base44.com/images/public/69c8e483a69a0d215eee4ef7/54dd14ec4_generated_image.png";

      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${title} — صفحة ${this.pageNumber}`,
        artist: author,
        album: "DAR AL TAWHID • القارئ الذكي",
        artwork: [{ src: cover, sizes: "512x512", type: "image/png" }],
      });

      navigator.mediaSession.setActionHandler("play", () => this.playFrom());
      navigator.mediaSession.setActionHandler("pause", () =>
        this.pause("immediate")
      );
      navigator.mediaSession.setActionHandler("stop", () => this.stop());
      navigator.mediaSession.setActionHandler("seekbackward", () =>
        this.seekBySeconds(-10)
      );
      navigator.mediaSession.setActionHandler("seekforward", () =>
        this.seekBySeconds(10)
      );
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        this.prevSentence()
      );
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        this.nextSentence()
      );
    } catch {}
  }

  _updateMediaSessionPlaybackState(state) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {}
  }
}

export const intelligentAudioEngine = new IntelligentAudioEngine();
