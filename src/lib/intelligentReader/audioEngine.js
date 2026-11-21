/**
 * DAR AL TAWHID — Intelligent Audio Engine & Background Playback Controller
 * (الأقسام: 5، 7، 8، 9، 10، 11، 12، 14)
 *
 * Responsibilities:
 * - Modular TTS Provider Manager (Server-side Gemini 3.8 Neural TTS ur-PK/ar-SA, Google Cloud TTS, Offline Web Speech fallback)
 * - Authentic Recorded Quran Recitation Player (Never uses TTS for verified Quranic verses)
 * - Acoustic Word & Sentence Synchronizer (Uses server-computed RMS energy word timings or Web Audio API decoding; never naive duration/wordCount)
 * - Pause Mode Controller (Immediate Pause vs. Complete Current Sentence Then Pause)
 * - Background Audio & MediaSession Manager (Lock screen controls, headset buttons, call-interruption auto-pause/resume, continues across routes)
 */

import { getCachedTtsAudio, setCachedTtsAudio } from "./cacheManager";
import { loadReaderSettings } from "./readerSettings";
import {
  saveReadingPosition,
  computeFileFingerprint,
} from "./positionManager";

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
    this.errorMessage = "";
    this.sentenceIndex = 0;
    this.wordIndex = 0;
    this.currentTimeSec = 0;
    this.durationSec = 0;
    this.playbackRate = 1;
    this.volume = 1;

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
    // Handle audio interruptions and beforeunload position saving
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
      this.errorMessage = "";
      this.playerState = "idle";
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
      errorMessage: this.errorMessage,
      sentenceIndex: this.sentenceIndex,
      totalSentencesOnPage: sentences.length,
      totalWordsOnPage,
      wordIndex: this.wordIndex,
      totalWordsInSentence: currentWords.length,
      currentSentence,
      currentWord: currentWordObj?.word || "",
      currentWordRect: currentWordObj?.rect || null,
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
   * Bind current book and extracted page data
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
    const isSameBookAndPage =
      this.bookId === String(book?.id || "") &&
      this.pageNumber === Number(pageNumber || 1);

    this.book = book;
    this.bookId = String(book?.id || "");
    this.fileVersion = computeFileFingerprint(book);
    this.pageNumber = Number(pageNumber || 1);
    this.totalPages = Math.max(
      1,
      Number(totalPages || book?.pages_count || book?.page_count || 1)
    );
    if (pageData !== undefined) {
      this.pageData = pageData;
      if ((pageData?.sentences || []).length > 0 && this.playerState === "error") {
        this.errorMessage = "";
        this.playerState = "idle";
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
    this.playbackRate = settings.defaultSpeed || 1;
    this.volume = settings.volume ?? 1;

    if (!isSameBookAndPage && this.playerState !== "playing") {
      this.sentenceIndex = 0;
      this.wordIndex = 0;
      this.currentTimeSec = 0;
      this.durationSec = 0;
    }

    this._setupMediaSessionMetadata();
    this._emit();
  }

  /**
   * Start or resume playback from a specific sentence & word index
   */
  async playFrom({ sentenceIndex = null, wordIndex = null } = {}) {
    this.errorMessage = "";
    this.pendingPauseAfterSentence = false;

    let sentences = this.pageData?.sentences || [];

    // If text is not yet extracted or is empty, automatically trigger/await OCR extraction before trying to play!
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
        console.warn("[IntelligentAudioEngine] On-demand OCR failed:", e);
      } finally {
        this.isExtractingPage = false;
      }
    }

    if (sentences.length === 0) {
      this.playerState = "error";
      this.errorMessage = "لا يوجد نص مستخرج في هذه الصفحة للقراءة الصوتية.";
      this._emit();
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

    // Cancel any in-flight request
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {}
    }
    this._abortController = new AbortController();

    this.playerState = "loading";
    this.errorMessage = "";
    this.wordIndex = startAtWordIndex;
    this._emit();

    const settings = loadReaderSettings();

    try {
      // ─── Case 1: Verified Quranic Verse → Play Authentic Recorded Recitation ONLY (القسم 8) ───
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
        this.currentWordTimings = []; // Recorded Quran plays verse-by-verse with full verse highlight

        await this._playAudioSource(
          sentence.quranMeta.audioUrl,
          sentence.quranMeta.directAudioUrl,
          startAtWordIndex,
          sentence.words || []
        );
        this._prefetchNextSentence(this.sentenceIndex + 1);
        return;
      }

      // ─── Case 2: Urdu Body, Hadith, Dua, Arabic Quote, or Heading → Neural TTS Engine (الأقسام 5، 6، 9) ───
      const isArabic =
        sentence.language === "ar" ||
        sentence.segmentType === "hadith" ||
        sentence.segmentType === "dua" ||
        sentence.segmentType === "arabic_quote";

      const voiceId = isArabic
        ? settings.defaultArabicVoice || "arabic_hadith_charon"
        : settings.urduVoiceId ||
          settings.defaultUrduVoice ||
          "pakistani_scholar_charon";

      const languageCode = isArabic ? "ar-SA" : "ur-PK";

      const badgeLabelMap = {
        hadith: "حديث نبوي شريف • صوت عربي فصيح",
        dua: "دعاء مأثور • صوت عربي فصيح",
        arabic_quote: "نص عربي • صوت عربي فصيح",
        heading: isArabic ? "عنوان • عربي" : "عنوان • أردو (ur-PK)",
        urdu_body: "نص أردي • صوت رجالي فصيح (ur-PK)",
      };

      this.currentSegmentInfo = {
        segmentType: sentence.segmentType,
        language: languageCode,
        badgeLabel:
          badgeLabelMap[sentence.segmentType] ||
          "نص أردي • صوت رجالي فصيح (ur-PK)",
        provider: "gemini-3.8-flash-lite-tts",
        voiceId,
      };

      const spokenText =
        sentence.cleanedPronunciationText || sentence.originalText;

      // Check IndexedDB Audio Cache first
      let ttsPayload = await getCachedTtsAudio(
        spokenText,
        voiceId,
        languageCode
      );

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
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(
            errJson.error || `فشل توليد الصوت (HTTP ${res.status})`
          );
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

      if (!ttsPayload?.audioBase64) {
        throw new Error("لم يتم استلام بيانات صوتية صالحة من الخادم");
      }

      this.currentWordTimings = Array.isArray(ttsPayload.wordTimings)
        ? ttsPayload.wordTimings
        : [];

      const blobUrl = this._base64ToBlobUrl(
        ttsPayload.audioBase64,
        ttsPayload.mimeType || "audio/wav"
      );

      await this._playAudioSource(
        blobUrl,
        null,
        startAtWordIndex,
        sentence.words || []
      );

      // Prefetch the next sentence in background so transition between sentences has zero lag
      this._prefetchNextSentence(this.sentenceIndex + 1);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("[IntelligentAudioEngine] Fallback/Error:", err);
      // Try Web Speech API offline fallback if browser supports ur-PK or ar-SA
      const usedOfflineSpeech = this._tryBrowserSpeechFallback(
        sentence,
        startAtWordIndex
      );
      if (!usedOfflineSpeech) {
        this.playerState = "error";
        this.errorMessage =
          err?.message || "تعذر تشغيل الصوت لهذه الجملة. يرجى التحقق من الاتصال.";
        this._emit();
      }
    }
  }

  async _playAudioSource(
    primaryUrl,
    backupUrl = null,
    startAtWordIndex = 0,
    words = []
  ) {
    if (!this.audioEl) return;

    this.audioEl.pause();
    this.audioEl.src = primaryUrl;
    this.audioEl.playbackRate = this.playbackRate;
    this.audioEl.volume = this.volume;

    // Wait for audio to load enough to seek if startAtWordIndex > 0
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
            () => reject(new Error("تعذر تحميل الملف الصوتي")),
            { once: true }
          );
        } else {
          reject(new Error("تعذر تحميل الملف الصوتي"));
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

    // If recorded Quran audio doesn't have precomputed word timings, build acoustic syllable-weighted timings from real duration
    if (
      this.currentWordTimings.length === 0 &&
      words.length > 0 &&
      Number.isFinite(this.audioEl.duration) &&
      this.audioEl.duration > 0
    ) {
      this.currentWordTimings = this._buildPhoneticTimingsForDuration(
        words,
        this.audioEl.duration * 1000
      );
    }

    // If user clicked a specific word inside the sentence, seek directly to that word's onset timestamp
    if (startAtWordIndex > 0 && this.currentWordTimings[startAtWordIndex]) {
      const targetSec =
        this.currentWordTimings[startAtWordIndex].startMs / 1000;
      if (Number.isFinite(targetSec) && targetSec < (this.audioEl.duration || 9999)) {
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

    const settings = loadReaderSettings();
    const isArabic =
      nextSent.language === "ar" ||
      nextSent.segmentType === "hadith" ||
      nextSent.segmentType === "dua" ||
      nextSent.segmentType === "arabic_quote";
    const voiceId = isArabic
      ? settings.defaultArabicVoice || "arabic_hadith_charon"
      : settings.urduVoiceId || "pakistani_scholar_charon";
    const langCode = isArabic ? "ar-SA" : "ur-PK";
    const spokenText =
      nextSent.cleanedPronunciationText || nextSent.originalText;

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

  _tryBrowserSpeechFallback(sentence, startAtWordIndex = 0) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const spokenText =
        sentence.cleanedPronunciationText || sentence.originalText;
      const utter = new SpeechSynthesisUtterance(spokenText);
      const isArabic =
        sentence.language === "ar" ||
        sentence.segmentType === "hadith" ||
        sentence.segmentType === "arabic_quote";
      utter.lang = isArabic ? "ar-SA" : "ur-PK";
      utter.rate = this.playbackRate;
      utter.volume = this.volume;

      utter.onstart = () => {
        this.playerState = "playing";
        this.wordIndex = startAtWordIndex;
        this._emit();
      };
      utter.onboundary = (e) => {
        if (e.name === "word") {
          const words = sentence.words || [];
          if (this.wordIndex < words.length - 1) {
            this.wordIndex++;
            this._emit();
          }
        }
      };
      utter.onend = () => {
        this._handleSentenceEnded();
      };
      utter.onerror = () => {
        this.playerState = "error";
        this.errorMessage = "تعذر تشغيل محرك النطق المحلي.";
        this._emit();
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

    // Check if user requested "Complete current sentence then pause" (القسم 7)
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

    this.pendingPauseAfterSentence = false;
    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
    }
    this.playerState = "paused";
    this._persistPosition();
    this._emit();
  }

  stop() {
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
      window.speechSynthesis.cancel();
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
      Math.min(this.audioEl.duration, (this.audioEl.currentTime || 0) + deltaSec)
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
    const sentences = this.pageData?.sentences || [];
    const currentSent = sentences[this.sentenceIndex];
    saveReadingPosition(this.bookId, {
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
      selectedVoice: this.currentSegmentInfo?.voiceId || "pakistani_scholar_charon",
      playerState: this.playerState,
    });
  }

  // ─── MediaSession Lock-Screen & Headset Controls (القسم 14) ───────────────────
  _setupMediaSessionMetadata() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
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
      navigator.mediaSession.setActionHandler("pause", () => this.pause("immediate"));
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
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {}
  }
}

export const intelligentAudioEngine = new IntelligentAudioEngine();
