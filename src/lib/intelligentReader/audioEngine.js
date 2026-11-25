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
import { webSpeechService } from "./webSpeechService";

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

    // Active timings & multi-ayah Sudais queue
    this.currentWordTimings = [];
    this.currentSegmentInfo = null; // { segmentType, language, quranMeta, provider, voiceId }
    this._activeQuranQueue = null;
    this._activeQuranAyahIdx = 0;
    this._activeQuranWordRanges = [];
    this._activeClipStartMs = 0;
    this._activeClipEndMs = 0;
    this._clipEndTriggered = false;

    // Callbacks registered by active reader view
    this.onRequestPageTurn = null;
    this.onEnsurePageExtracted = null;
    this.isExtractingPage = false;

    // Concurrency, prefetch Blob cache & lifecycle guards
    this._playSessionId = 0;
    this._rafId = null;
    this._currentBlobUrl = null;
    this._abortController = null;
    this._loadedSentenceKey = "";
    this._prefetchedAudioBlobUrls = new Map(); // remoteUrl -> blobUrl (LRU max 40)
    this._pendingAudioFetches = new Map(); // remoteUrl -> Promise<string|null>

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
      const currentMs = this.currentTimeSec * 1000;
      if (
        this._activeClipEndMs > 0 &&
        currentMs >= this._activeClipEndMs &&
        !this._clipEndTriggered
      ) {
        this._clipEndTriggered = true;
        this.audioEl.pause();
        this._stopHighResSyncLoop();
        this._handleAudioEnded();
        return;
      }
      this._syncWordIndexFromTime(currentMs);
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
      this._handleAudioEnded();
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
   * Immediately cancel active/pending audio during an explicit page change
   * so stale audio from a previous page never plays on the new page.
   */
  cancelCurrentAudioForPageTransition() {
    this._playSessionId++;
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
        window.speechSynthesis.cancel();
      } catch {}
    }
    this._activeQuranQueue = null;
    this._activeQuranAyahIdx = 0;
    this._activeQuranWordRanges = [];
    this._activeClipStartMs = 0;
    this._activeClipEndMs = 0;
    this._clipEndTriggered = false;
    this._loadedSentenceKey = null;
    this.sentenceIndex = 0;
    this.wordIndex = 0;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    if (this.playerState === "playing" || this.playerState === "loading") {
      this.playerState = "paused";
    }
    this._emit();
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
    isPassiveScroll = false,
    onRequestPageTurn,
    onEnsurePageExtracted,
  }) {
    const incomingBookId = String(book?.id || "");
    const incomingPageNum = Number(pageNumber || 1);
    const isSameBookAndPage =
      this.bookId === incomingBookId && this.pageNumber === incomingPageNum;

    // If the user is passively scrolling in VerticalPageStream while audio is actively playing/loading
    // on another page, keep the active audio page context locked so playback and highlighting never desync.
    if (
      !isSameBookAndPage &&
      isPassiveScroll &&
      this.bookId === incomingBookId &&
      (this.playerState === "playing" || this.playerState === "loading")
    ) {
      return;
    }

    // If the page explicitly changed while audio was playing or loading, immediately cancel stale audio
    // from the previous page so old audio never plays over the new page.
    if (
      !isSameBookAndPage &&
      (this.playerState === "playing" || this.playerState === "loading")
    ) {
      this.cancelCurrentAudioForPageTransition();
    }

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
    const clipMaxSec = this._activeClipEndMs > 0 ? this._activeClipEndMs / 1000 : this.durationSec;
    if (
      sentenceIndex === null &&
      wordIndex === null &&
      this.playerState === "paused" &&
      this.audioEl?.src &&
      this.currentTimeSec > 0 &&
      this.currentTimeSec < clipMaxSec
    ) {
      try {
        this.audioEl.playbackRate = this.playbackRate;
        this.audioEl.volume = this.volume;
        await this.audioEl.play();
        return;
      } catch {}
    }

    const targetSIdx =
      sentenceIndex !== null
        ? Math.max(0, Math.min(sentences.length - 1, Number(sentenceIndex)))
        : this.sentenceIndex;
    const targetWIdx =
      wordIndex !== null ? Math.max(0, Number(wordIndex)) : 0;

    // Instant in-sentence word seek fast-path: if the target sentence is ALREADY loaded in this.audioEl
    // (single audio file) and we have word timings for targetWIdx, seek immediately with 0ms latency!
    const expectedKey = `${this.bookId}:${this.pageNumber}:${targetSIdx}`;
    if (
      (!this._activeQuranQueue || this._activeQuranQueue.length <= 1) &&
      targetSIdx === this.sentenceIndex &&
      this._loadedSentenceKey === expectedKey &&
      this.audioEl?.src &&
      this.currentWordTimings &&
      this.currentWordTimings[targetWIdx] &&
      Number.isFinite(this.audioEl.duration) &&
      this.audioEl.duration > 0
    ) {
      this.wordIndex = targetWIdx;
      const minClipSec = this._activeClipStartMs > 0 ? this._activeClipStartMs / 1000 : 0;
      const maxClipSec =
        this._activeClipEndMs > 0
          ? Math.min(this.audioEl.duration, this._activeClipEndMs / 1000)
          : this.audioEl.duration;
      const targetSec = Math.max(
        minClipSec,
        Math.min(maxClipSec, this.currentWordTimings[targetWIdx].startMs / 1000)
      );
      if (targetSec < this.audioEl.duration) {
        this.audioEl.currentTime = targetSec;
      }
      this.audioEl.playbackRate = this.playbackRate;
      this.audioEl.volume = this.volume;
      this._emit();
      try {
        await this.audioEl.play();
        this._persistPosition();
        return;
      } catch {}
    }

    this.sentenceIndex = targetSIdx;
    this.wordIndex = targetWIdx;

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

    // Reset multi-ayah & partial-clip state when starting a sentence
    this._activeQuranQueue = null;
    this._activeQuranAyahIdx = 0;
    this._activeQuranWordRanges = [];
    this._activeClipStartMs = 0;
    this._activeClipEndMs = 0;
    this._clipEndTriggered = false;

    this.playerState = "loading";
    this._clearError();
    this.wordIndex = startAtWordIndex;
    this._emit();

    const settings = loadReaderSettings();

    try {
      // ─── Case 1: Verified Quranic Verse → Play Authentic Recorded Recitation ONLY (Sheikh Abdul Rahman Al-Sudais) ───
      if (
        sentence.segmentType === "quran" &&
        sentence.quranMeta?.verified &&
        (sentence.quranMeta?.audioUrl || sentence.quranMeta?.ayahList?.length > 0)
      ) {
        const meta = sentence.quranMeta;
        const currentVerseId = `${this.bookId}:${meta.surahNumber}:${meta.ayahNumber}-${meta.endAyahNumber || meta.ayahNumber}`;
        const prevPageVerseKey = `${currentVerseId}:page${this.pageNumber - 1}`;
        const isPageTopClosingFragment =
          this.sentenceIndex === 0 &&
          !String(sentence.originalText || "").includes("﴿") &&
          String(sentence.originalText || "").includes("﴾");

        if (
          isPageTopClosingFragment &&
          this._lastRecitedQuranVerseKey === prevPageVerseKey &&
          sentences.length > 1
        ) {
          this._lastRecitedQuranVerseKey = `${currentVerseId}:page${this.pageNumber}`;
          this.sentenceIndex = 1;
          this.wordIndex = 0;
          await this._loadAndPlayCurrentSentence(0);
          return;
        }

        this._lastRecitedQuranVerseKey = `${currentVerseId}:page${this.pageNumber}`;

        const reciterId = "ar.saoodshuraym";
        const ayahQueue =
          Array.isArray(meta.ayahList) && meta.ayahList.length > 0
            ? meta.ayahList
            : [
                {
                  surahNumber: meta.surahNumber,
                  surahName: meta.surahName,
                  ayahNumber: meta.ayahNumber,
                  globalAyahNumber: meta.globalAyahNumber,
                  audioUrl: meta.audioUrl,
                  directAudioUrl: meta.directAudioUrl,
                  backupAudioUrl: meta.backupAudioUrl,
                  normalizedWordCount: (sentence.words || []).length || 1,
                },
              ];

        const totalWords = (sentence.words || []).length;
        const ayahWordRanges = this._computeAyahWordRanges(ayahQueue, totalWords);

        // Determine which Ayah in the multi-ayah queue owns startAtWordIndex
        let startAyahQueueIdx = 0;
        if (startAtWordIndex > 0 && ayahWordRanges.length > 1) {
          const foundQ = ayahWordRanges.findIndex(
            (r) => startAtWordIndex >= r.startIdx && startAtWordIndex < r.endIdx
          );
          if (foundQ >= 0) startAyahQueueIdx = foundQ;
        }

        this._activeQuranQueue = ayahQueue;
        this._activeQuranAyahIdx = startAyahQueueIdx;
        this._activeQuranWordRanges = ayahWordRanges;

        await this._playActiveQuranAyahAtIndex(
          startAyahQueueIdx,
          startAtWordIndex,
          sentence,
          reciterId,
          sessionId
        );

        if (sessionId === this._playSessionId) {
          this._loadedSentenceKey = `${this.bookId}:${this.pageNumber}:${this.sentenceIndex}`;
          this._prefetchUpcomingSentences(this.sentenceIndex);
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

      // Explicit 4-Engine Separation (Section 11: B. Hadith Engine, C. Arabic General Engine, D. Urdu Engine)
      const isHadithOrDua =
        isArabic &&
        (sentence.segmentType === "hadith" || sentence.segmentType === "dua");
      const activeEngineId = isHadithOrDua
        ? "hadith_engine"
        : isArabic
        ? "arabic_general_engine"
        : "urdu_engine";

      const badgeLabelMap = {
        hadith: "محرك الحديث النبوي • صوت رجالي عربي (ar-SA)",
        dua: "محرك الحديث والدعاء • صوت رجالي عربي (ar-SA)",
        arabic_quote: "محرك النص العربي • صوت رجالي عربي (ar-SA)",
        heading: isArabic
          ? "محرك النص العربي • عنوان عربي (ar-SA)"
          : "محرك اللغة الأردية • عنوان أردي (ur-PK)",
        urdu_body: isArabic
          ? "محرك النص العربي • صوت رجالي عربي (ar-SA)"
          : "محرك اللغة الأردية • صوت رجالي أردي (ur-PK)",
      };

      this.currentSegmentInfo = {
        engineId: activeEngineId,
        segmentType: sentence.segmentType,
        language: languageCode,
        badgeLabel:
          badgeLabelMap[sentence.segmentType] ||
          (isArabic
            ? "محرك النص العربي • صوت رجالي عربي (ar-SA)"
            : "محرك اللغة الأردية • صوت رجالي أردي (ur-PK)"),
        provider: "edge-neural-tts",
        voiceId,
      };

      const hadithRateDelta = Number(settings?.hadithProsodyRateDelta ?? -3);
      const pitchDeltaHz = Number(settings?.prosodyPitchDeltaHz ?? -1);
      const prosodyPayload = {
        preset: settings?.prosodyPreset || "scholarly",
        enabled: settings?.prosodyEnabled !== false,
        arabicTashkeel: settings?.arabicTashkeelEnabled !== false,
        urduProofread: settings?.urduProofreadEnabled !== false,
        hadithRateDelta,
        pitchDeltaHz,
      };
      const prosodyKey = prosodyPayload.enabled
        ? `${prosodyPayload.preset}:${prosodyPayload.arabicTashkeel ? 1 : 0}:${prosodyPayload.urduProofread ? 1 : 0}:${hadithRateDelta}:${pitchDeltaHz}`
        : `flat:${prosodyPayload.arabicTashkeel ? 1 : 0}:${prosodyPayload.urduProofread ? 1 : 0}`;

      // Check IndexedDB Audio Cache first
      let ttsPayload = await getCachedTtsAudio(
        spokenText,
        voiceId,
        languageCode,
        prosodyKey
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
            prosody: prosodyPayload,
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
            ttsPayload,
            prosodyKey
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
        this._loadedSentenceKey = `${this.bookId}:${this.pageNumber}:${this.sentenceIndex}`;
        this._prefetchUpcomingSentences(this.sentenceIndex);
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

  _computeAyahWordRanges(ayahQueue, totalWords) {
    if (!Array.isArray(ayahQueue) || ayahQueue.length === 0) return [];
    if (ayahQueue.length === 1 || totalWords <= 0) {
      return ayahQueue.map(() => ({ startIdx: 0, endIdx: Math.max(0, totalWords) }));
    }
    const weights = ayahQueue.map((a) => Math.max(2, Number(a.normalizedWordCount) || 5));
    const sumW = weights.reduce((acc, w) => acc + w, 0) || 1;
    const ranges = [];
    let cursor = 0;
    for (let i = 0; i < ayahQueue.length; i++) {
      const startIdx = cursor;
      const endIdx =
        i === ayahQueue.length - 1
          ? totalWords
          : Math.min(totalWords, Math.max(startIdx + 1, cursor + Math.round((weights[i] / sumW) * totalWords)));
      ranges.push({ startIdx, endIdx });
      cursor = endIdx;
    }
    return ranges;
  }

  _buildSudaisAudioUrlsForAyah(ayahObj) {
    const sPad = String(ayahObj.surahNumber || 1).padStart(3, "0");
    const aPad = String(ayahObj.ayahNumber || 1).padStart(3, "0");
    const shuraymQuranCom = `https://verses.quran.com/Shuraym/mp3/${sPad}${aPad}.mp3`;
    const shuraymEveryAyah = `https://everyayah.com/data/Saood_ash-Shuraym_128kbps/${sPad}${aPad}.mp3`;
    const isShuraymDirect =
      typeof ayahObj.directAudioUrl === "string" &&
      (ayahObj.directAudioUrl.includes("Saood_ash-Shuraym") ||
        ayahObj.directAudioUrl.includes("Shuraym/"));
    const primaryDirect = isShuraymDirect ? ayahObj.directAudioUrl : shuraymQuranCom;
    const primaryProxy = `/api/reader/quran-audio?url=${encodeURIComponent(primaryDirect)}`;
    const backupDirect =
      primaryDirect !== shuraymEveryAyah
        ? shuraymEveryAyah
        : ayahObj.backupAudioUrl ||
          (ayahObj.globalAyahNumber
            ? `https://cdn.islamic.network/quran/audio/64/ar.saoodshuraym/${ayahObj.globalAyahNumber}.mp3`
            : primaryDirect);
    const backupProxy = `/api/reader/quran-audio?url=${encodeURIComponent(backupDirect)}`;
    return { primaryProxy, backupProxy, primaryDirect, backupDirect };
  }

  async _playActiveQuranAyahAtIndex(
    qIdx,
    globalStartWordIdx,
    sentence,
    reciterId,
    sessionId
  ) {
    const queue = this._activeQuranQueue;
    if (!queue || !queue[qIdx] || sessionId !== this._playSessionId) return;

    const ayahObj = queue[qIdx];
    const range = this._activeQuranWordRanges[qIdx] || {
      startIdx: 0,
      endIdx: (sentence.words || []).length,
    };
    const sliceWords = (sentence.words || []).slice(range.startIdx, range.endIdx);
    const localStartWordIdx = Math.max(0, globalStartWordIdx - range.startIdx);

    this._activeClipStartMs = Number(ayahObj.clipStartMs || 0);
    this._activeClipEndMs = Number(ayahObj.clipEndMs || 0);
    this._clipEndTriggered = false;

    const ayahLabel =
      queue.length > 1
        ? `${ayahObj.surahName} (${ayahObj.ayahNumber} من ${queue[0].ayahNumber}–${queue[queue.length - 1].ayahNumber})`
        : `${ayahObj.surahName} (${ayahObj.ayahNumber})`;

    this.currentSegmentInfo = {
      engineId: "quran_engine",
      segmentType: "quran",
      language: "ar",
      badgeLabel: `محرك القرآن • الشيخ سعود الشريم • ${ayahLabel}`,
      provider: "quran-authentic-recording",
      voiceId: reciterId,
      quranMeta: sentence.quranMeta,
      activeAyahNumber: ayahObj.ayahNumber,
      queueIndex: qIdx,
      queueLength: queue.length,
      isPartialClip: Boolean(ayahObj.isPartialClip),
    };

    if (
      Array.isArray(ayahObj.wordTimings) &&
      ayahObj.wordTimings.length > 0 &&
      sliceWords.length > 0
    ) {
      const srcTimings = ayahObj.wordTimings;
      this.currentWordTimings = sliceWords.map((wObj, i) => {
        const tIdx = Math.min(
          srcTimings.length - 1,
          Math.floor((i / sliceWords.length) * srcTimings.length)
        );
        const srcT = srcTimings[tIdx];
        return {
          word: wObj.word || wObj.text || "",
          wordIndex: range.startIdx + i,
          startMs: srcT.startMs,
          endMs: srcT.endMs,
          confidence: srcT.confidence || "quran-com-segments",
        };
      });
    } else {
      this.currentWordTimings = [];
    }

    // Immediately prefetch the NEXT ayah inside this multi-ayah verse so transition has 0ms gap!
    if (qIdx + 1 < queue.length) {
      const nextUrls = this._buildSudaisAudioUrlsForAyah(queue[qIdx + 1]);
      this._prefetchRemoteAudioToBlob(nextUrls.primaryProxy, nextUrls.backupProxy);
    }

    const urls = this._buildSudaisAudioUrlsForAyah(ayahObj);
    const resolvedBlobOrUrl = await this._resolveAudioToBlobUrl(
      urls.primaryProxy,
      urls.backupProxy,
      sessionId
    );
    if (sessionId !== this._playSessionId) return;

    await this._playAudioSource(
      resolvedBlobOrUrl || urls.primaryProxy,
      urls.backupProxy,
      localStartWordIdx,
      sliceWords,
      sessionId,
      range.startIdx
    );
  }

  _storePrefetchedBlob(keyUrl, blobUrl) {
    if (!keyUrl || !blobUrl) return;
    if (this._prefetchedAudioBlobUrls.has(keyUrl)) {
      this._prefetchedAudioBlobUrls.delete(keyUrl);
    } else if (this._prefetchedAudioBlobUrls.size >= 40) {
      const oldestKey = this._prefetchedAudioBlobUrls.keys().next().value;
      const oldestBlob = oldestKey ? this._prefetchedAudioBlobUrls.get(oldestKey) : null;
      if (oldestKey) this._prefetchedAudioBlobUrls.delete(oldestKey);
      if (oldestBlob && oldestBlob !== this._currentBlobUrl && oldestBlob !== this.audioEl?.src) {
        try {
          URL.revokeObjectURL(oldestBlob);
        } catch {}
      }
    }
    this._prefetchedAudioBlobUrls.set(keyUrl, blobUrl);
  }

  async _prefetchRemoteAudioToBlob(primaryUrl, backupUrl = null) {
    if (!primaryUrl || typeof fetch !== "function" || typeof URL === "undefined") return null;
    if (this._prefetchedAudioBlobUrls.has(primaryUrl)) {
      return this._prefetchedAudioBlobUrls.get(primaryUrl);
    }
    if (this._pendingAudioFetches.has(primaryUrl)) {
      return this._pendingAudioFetches.get(primaryUrl);
    }
    const p = (async () => {
      for (const candidateUrl of [primaryUrl, backupUrl].filter(Boolean)) {
        try {
          const res = await fetch(candidateUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (blob && blob.size > 256) {
            const bUrl = URL.createObjectURL(blob);
            this._storePrefetchedBlob(primaryUrl, bUrl);
            return bUrl;
          }
        } catch {}
      }
      return null;
    })().finally(() => {
      this._pendingAudioFetches.delete(primaryUrl);
    });
    this._pendingAudioFetches.set(primaryUrl, p);
    return p;
  }

  async _resolveAudioToBlobUrl(primaryUrl, backupUrl, sessionId) {
    if (!primaryUrl) return null;
    if (primaryUrl.startsWith("blob:")) return primaryUrl;
    if (this._prefetchedAudioBlobUrls.has(primaryUrl)) {
      return this._prefetchedAudioBlobUrls.get(primaryUrl);
    }
    if (this._pendingAudioFetches.has(primaryUrl)) {
      const awaited = await this._pendingAudioFetches.get(primaryUrl);
      if (awaited) return awaited;
    }
    for (const candidateUrl of [primaryUrl, backupUrl].filter(Boolean)) {
      if (sessionId !== this._playSessionId) return null;
      try {
        const res = await fetch(candidateUrl, {
          signal: this._abortController?.signal,
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (sessionId !== this._playSessionId) return null;
        if (blob && blob.size > 256) {
          const bUrl = URL.createObjectURL(blob);
          this._storePrefetchedBlob(primaryUrl, bUrl);
          return bUrl;
        }
      } catch (e) {
        if (e?.name === "AbortError" || sessionId !== this._playSessionId) throw e;
      }
    }
    return null;
  }

  async _playAudioSource(
    primaryUrl,
    backupUrl = null,
    startAtWordIndex = 0,
    words = [],
    sessionId = this._playSessionId,
    wordIndexOffset = 0
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
        if (sessionId !== this._playSessionId) {
          resolve();
          return;
        }
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

    // 1. If no precomputed timings exist, build phonetic syllable-weighted timings from real decoded duration (or partial clip bounds)
    if (
      this.currentWordTimings.length === 0 &&
      words.length > 0 &&
      realDurationMs > 0
    ) {
      const effStart = this._activeClipStartMs > 0 ? this._activeClipStartMs : 0;
      const effEnd =
        this._activeClipEndMs > effStart
          ? Math.min(realDurationMs, this._activeClipEndMs)
          : realDurationMs;
      this.currentWordTimings = this._buildPhoneticTimingsForDuration(
        words,
        Math.max(100, effEnd - effStart),
        wordIndexOffset,
        effStart
      );
    } else if (
      this.currentWordTimings.length > 0 &&
      realDurationMs > 250 &&
      this._activeClipStartMs === 0 &&
      this._activeClipEndMs === 0 &&
      this.currentWordTimings[0]?.confidence !== "quran-com-segments"
    ) {
      // 2. Re-calibrate precomputed TTS timings if the server's estimated duration differs from the browser's real decoded duration
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

    // If partial ayah clip or user clicked a specific word, seek directly to that onset timestamp
    let initialSeekSec = 0;
    if (startAtWordIndex > 0 && this.currentWordTimings[startAtWordIndex]) {
      initialSeekSec = this.currentWordTimings[startAtWordIndex].startMs / 1000;
    } else if (this._activeClipStartMs > 0) {
      initialSeekSec = this._activeClipStartMs / 1000;
    }
    if (
      initialSeekSec > 0 &&
      Number.isFinite(initialSeekSec) &&
      initialSeekSec < (this.audioEl.duration || 9999)
    ) {
      this.audioEl.currentTime = initialSeekSec;
    }

    await this.audioEl.play();
    this._persistPosition();
  }

  _buildPhoneticTimingsForDuration(
    words,
    totalDurationMs,
    wordIndexOffset = 0,
    baseOffsetMs = 0
  ) {
    const leadInMs = baseOffsetMs > 0 ? 40 : Math.min(180, totalDurationMs * 0.04);
    const activeMs = Math.max(100, totalDurationMs - leadInMs * (baseOffsetMs > 0 ? 1 : 2));
    const weights = words.map((wObj) => {
      const w = String(wObj.word || wObj || "");
      const clean = w.replace(/[^\u0600-\u06FF\w]/g, "");
      const maddCount = (clean.match(/[اويآىے]/g) || []).length;
      return Math.max(1.2, clean.length * 0.8 + maddCount * 0.7);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = baseOffsetMs + leadInMs;
    return words.map((wObj, idx) => {
      const span = (weights[idx] / totalWeight) * activeMs;
      const item = {
        word: wObj.word || "",
        wordIndex: idx + wordIndexOffset,
        startMs: Math.round(cursor),
        endMs: Math.round(cursor + span),
        confidence: "phonetic-syllable-weighted",
      };
      cursor += span;
      return item;
    });
  }

  _prefetchUpcomingSentences(currentIdx) {
    // Prefetch up to 3 upcoming sentences in parallel so transitions between words, languages, Hadiths, and Quran verses are instant
    for (let offset = 1; offset <= 3; offset++) {
      this._prefetchNextSentence(currentIdx + offset);
    }
  }

  async _prefetchNextSentence(nextIdx) {
    const sentences = this.pageData?.sentences || [];
    const nextSent = sentences[nextIdx];
    if (!nextSent) return;

    // If upcoming sentence is a verified Quranic verse, prefetch Sudais MP3s into Blob URL memory cache for 0ms start!
    if (nextSent.segmentType === "quran" && nextSent.quranMeta?.verified) {
      const queue =
        Array.isArray(nextSent.quranMeta.ayahList) && nextSent.quranMeta.ayahList.length > 0
          ? nextSent.quranMeta.ayahList
          : [nextSent.quranMeta];
      for (const ay of queue.slice(0, 3)) {
        const urls = this._buildSudaisAudioUrlsForAyah(ay);
        this._prefetchRemoteAudioToBlob(urls.primaryProxy, urls.backupProxy);
      }
      return;
    }

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

    const settings = loadReaderSettings();
    const hadithRateDelta = Number(settings?.hadithProsodyRateDelta ?? -3);
    const pitchDeltaHz = Number(settings?.prosodyPitchDeltaHz ?? -1);
    const prosodyPayload = {
      preset: settings?.prosodyPreset || "scholarly",
      enabled: settings?.prosodyEnabled !== false,
      arabicTashkeel: settings?.arabicTashkeelEnabled !== false,
      urduProofread: settings?.urduProofreadEnabled !== false,
      hadithRateDelta,
      pitchDeltaHz,
    };
    const prosodyKey = prosodyPayload.enabled
      ? `${prosodyPayload.preset}:${prosodyPayload.arabicTashkeel ? 1 : 0}:${prosodyPayload.urduProofread ? 1 : 0}:${hadithRateDelta}:${pitchDeltaHz}`
      : `flat:${prosodyPayload.arabicTashkeel ? 1 : 0}:${prosodyPayload.urduProofread ? 1 : 0}`;

    const existing = await getCachedTtsAudio(spokenText, voiceId, langCode, prosodyKey);
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
          prosody: prosodyPayload,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.audioBase64) {
          await setCachedTtsAudio(spokenText, voiceId, langCode, data, prosodyKey);
        }
      }
    } catch {}
  }

  _tryBrowserSpeechFallback(sentence, startAtWordIndex = 0, sessionId = this._playSessionId) {
    if (!webSpeechService.isSupported()) {
      return false;
    }
    const settings = loadReaderSettings();
    return webSpeechService.speakSentence({
      sentence,
      startAtWordIndex,
      settings,
      playbackRate: this.playbackRate,
      volume: this.volume,
      onStart: (meta) => {
        if (sessionId !== this._playSessionId) return;
        this.playerState = "playing";
        this.wordIndex = startAtWordIndex;
        if (meta?.estimatedDurationMs) {
          this.durationSec = Math.round((meta.estimatedDurationMs / 1000) * 10) / 10;
        }
        this._emit();
      },
      onWordBoundary: (nextWordIdx) => {
        if (sessionId !== this._playSessionId) return;
        if (nextWordIdx !== this.wordIndex) {
          this.wordIndex = nextWordIdx;
          this._emit();
        }
      },
      onEnd: () => {
        if (sessionId !== this._playSessionId) return;
        this._handleSentenceEnded();
      },
      onError: () => {
        if (sessionId !== this._playSessionId) return;
        this._setError("TTS_FAILED", "تعذر تشغيل محرك النطق المحلي (Web Speech API).");
      },
    });
  }

  _startHighResSyncLoop() {
    this._stopHighResSyncLoop();
    const tick = () => {
      if (this.audioEl && !this.audioEl.paused) {
        const currentMs = this.audioEl.currentTime * 1000;
        if (
          this._activeClipEndMs > 0 &&
          currentMs >= this._activeClipEndMs &&
          !this._clipEndTriggered
        ) {
          this._clipEndTriggered = true;
          this.audioEl.pause();
          this._stopHighResSyncLoop();
          this._handleAudioEnded();
          return;
        }
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
      const wIdx = typeof t.wordIndex === "number" ? t.wordIndex : i;
      if (currentMs >= t.startMs && currentMs <= t.endMs + 40) {
        foundIdx = wIdx;
        break;
      } else if (currentMs > t.endMs) {
        foundIdx = wIdx;
      }
    }
    if (foundIdx !== this.wordIndex) {
      this.wordIndex = foundIdx;
      this._emit();
    }
  }

  async _handleAudioEnded() {
    // If inside a multi-ayah Quranic verse, advance seamlessly to the next Ayah in Sheikh Al-Sudais's queue!
    if (
      Array.isArray(this._activeQuranQueue) &&
      this._activeQuranAyahIdx + 1 < this._activeQuranQueue.length
    ) {
      const sentences = this.pageData?.sentences || [];
      const sentence = sentences[this.sentenceIndex];
      const nextQIdx = this._activeQuranAyahIdx + 1;
      const nextRange = this._activeQuranWordRanges[nextQIdx] || { startIdx: this.wordIndex };
      if (sentence) {
        const sessionId = this._playSessionId;
        this._activeQuranAyahIdx = nextQIdx;
        this.wordIndex = nextRange.startIdx;
        this._emit();
        try {
          await this._playActiveQuranAyahAtIndex(
            nextQIdx,
            nextRange.startIdx,
            sentence,
            "ar.saoodshuraym",
            sessionId
          );
          return;
        } catch (e) {
          if (e?.name === "AbortError" || sessionId !== this._playSessionId) return;
        }
      }
    }

    this._activeQuranQueue = null;
    this._activeQuranAyahIdx = 0;
    this._activeQuranWordRanges = [];
    this._activeClipStartMs = 0;
    this._activeClipEndMs = 0;
    this._clipEndTriggered = false;
    this._handleSentenceEnded();
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
      this.onRequestPageTurn(nextPage, {
        autoContinueAudio: true,
        targetSentencePosition: "first",
      });
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
    webSpeechService.pause();
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
    webSpeechService.cancel();
    this._activeClipStartMs = 0;
    this._activeClipEndMs = 0;
    this._clipEndTriggered = false;
    this.playerState = "stopped";
    this.wordIndex = 0;
    this.currentTimeSec = 0;
    this._persistPosition();
    this._emit();
  }

  seekBySeconds(deltaSec) {
    if (!this.audioEl || !Number.isFinite(this.audioEl.duration)) return;
    const minSec = this._activeClipStartMs > 0 ? this._activeClipStartMs / 1000 : 0;
    const maxSec =
      this._activeClipEndMs > 0
        ? Math.min(this.audioEl.duration, this._activeClipEndMs / 1000)
        : this.audioEl.duration;
    const nextTime = Math.max(
      minSec,
      Math.min(maxSec, (this.audioEl.currentTime || 0) + deltaSec)
    );
    this.audioEl.currentTime = nextTime;
    this.currentTimeSec = nextTime;
    this._syncWordIndexFromTime(nextTime * 1000);
    this._persistPosition();
    this._emit();
  }

  seekToRatio(ratio) {
    if (!this.audioEl || !Number.isFinite(this.audioEl.duration)) return;
    const minSec = this._activeClipStartMs > 0 ? this._activeClipStartMs / 1000 : 0;
    const maxSec =
      this._activeClipEndMs > 0
        ? Math.min(this.audioEl.duration, this._activeClipEndMs / 1000)
        : this.audioEl.duration;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const nextTime = minSec + clamped * Math.max(0.1, maxSec - minSec);
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
        autoContinueAudio:
          this.playerState === "playing" ||
          this.playerState === "loading" ||
          this.playerState === "paused",
        targetSentencePosition: "first",
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
        autoContinueAudio:
          this.playerState === "playing" ||
          this.playerState === "loading" ||
          this.playerState === "paused",
        targetSentencePosition: "last",
      });
    }
  }

  /**
   * Jump directly to the next or previous segment of a given category
   * ("quran" = الآيات, "hadith" = الأحاديث, "urdu" = الشرح/النص) with zero lag.
   */
  jumpToSegmentType(category = "quran", direction = 1) {
    const sentences = this.pageData?.sentences || [];
    const matchesCategory = (s) => {
      if (!s) return false;
      if (category === "quran") return s.segmentType === "quran";
      if (category === "hadith") {
        return s.segmentType === "hadith" || s.segmentType === "dua" || s.segmentType === "arabic_quote";
      }
      return s.segmentType === "urdu_body" || s.segmentType === "heading";
    };

    const startIdx = this.sentenceIndex + (direction >= 0 ? 1 : -1);
    for (
      let i = startIdx;
      direction >= 0 ? i < sentences.length : i >= 0;
      i += direction >= 0 ? 1 : -1
    ) {
      if (matchesCategory(sentences[i])) {
        this.playFrom({ sentenceIndex: i, wordIndex: 0 });
        return true;
      }
    }

    // Wrap on current page if another match exists before current sentence
    for (
      let i = direction >= 0 ? 0 : sentences.length - 1;
      direction >= 0 ? i < this.sentenceIndex : i > this.sentenceIndex;
      i += direction >= 0 ? 1 : -1
    ) {
      if (matchesCategory(sentences[i])) {
        this.playFrom({ sentenceIndex: i, wordIndex: 0 });
        return true;
      }
    }

    // Or turn page seamlessly in requested direction
    const targetPage = this.pageNumber + (direction >= 0 ? 1 : -1);
    if (
      targetPage >= 1 &&
      targetPage <= this.totalPages &&
      typeof this.onRequestPageTurn === "function"
    ) {
      this.onRequestPageTurn(targetPage, {
        autoContinueAudio: true,
        targetSegmentCategory: category,
        targetSentencePosition: direction >= 0 ? "first" : "last",
      });
      return true;
    }
    return false;
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
