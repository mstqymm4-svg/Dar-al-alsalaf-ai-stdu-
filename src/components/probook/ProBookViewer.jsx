import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, AlertCircle, RotateCcw, X } from "lucide-react";
import {
  loadPdfDocument,
  extractPageText,
  extractRealPdfOutline,
} from "@/lib/pdfLoader";
import PdfPageRenderer from "./PdfPageRenderer";
import PageAnnotationLayer, {
  loadPageAnnotations,
  undoPageAnnotation,
  redoPageAnnotation,
  canRedoPageAnnotation,
  clearPageAnnotations,
} from "./PageAnnotationLayer";
import VerticalPageStream from "./VerticalPageStream";
import {
  TopHeaderBar,
  BottomControlBar,
  AnnotationDock,
} from "./ViewerToolbar";
import {
  TocPanel,
  ThemeComfortPanel,
  GoToPanel,
} from "./ViewerPanels";
import SmartWordHighlightLayer from "./SmartWordHighlightLayer";
import IntelligentAudioPlayer from "./IntelligentAudioPlayer";
import { extractAndProcessPdfPage } from "@/lib/intelligentReader/textProcessor";
import { intelligentAudioEngine } from "@/lib/intelligentReader/audioEngine";
import {
  loadReaderSettings,
  saveReaderSettings,
} from "@/lib/intelligentReader/readerSettings";
import {
  loadReadingPosition,
  saveReadingPosition,
  computeFileFingerprint,
} from "@/lib/intelligentReader/positionManager";
import { useT } from "@/lib/i18n";

const READER_THEMES = {
  light: {
    id: "light",
    bg: "#F8FAFC",
    text: "#0F172A",
    toolbar: "#FFFFFF",
    border: "#E2E8F0",
    pageBg: "#FFFFFF",
    pageFilter: "none",
  },
  sepia: {
    id: "sepia",
    bg: "#F4ECD8",
    text: "#2C221E",
    toolbar: "#EFE5CD",
    border: "#DFD3B6",
    pageBg: "#FAF4E4",
    pageFilter: "sepia(0.28) contrast(0.98)",
  },
  dusk: {
    id: "dusk",
    bg: "#1A202B",
    text: "#E2E5EC",
    toolbar: "#181E29",
    border: "#2C3548",
    pageBg: "#1A202B",
    pageFilter: "invert(1) hue-rotate(180deg) contrast(0.83) brightness(0.93)",
  },
  dark: {
    id: "dark",
    bg: "#0F172A",
    text: "#F8FAFC",
    toolbar: "#11151E",
    border: "#1E293B",
    pageBg: "#12151C",
    pageFilter: "invert(1) hue-rotate(180deg) contrast(0.90) brightness(0.95)",
  },
};

export default function ProBookViewer({
  book,
  pdfUrl: pdfUrlProp,
  title: titleProp,
  bookId: bookIdProp,
  initialOutline,
  onProgressChange,
  initialPage = 1,
  onPageChange,
  onBack,
}) {
  const t = useT();
  const bookId = book?.id || bookIdProp || "default_book";
  const pdfUrl =
    book?.pdf_url ||
    book?.file_url ||
    book?.url ||
    pdfUrlProp ||
    "";

  const effectiveBook = React.useMemo(
    () =>
      book
        ? { ...book, id: bookId, pdf_url: pdfUrl }
        : {
            id: bookId,
            title: titleProp || "",
            pdf_url: pdfUrl,
            toc: initialOutline || [],
          },
    [book, bookId, titleProp, pdfUrl, initialOutline]
  );

  // PDF Document state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [totalPages, setTotalPages] = useState(
    book?.pages_count || book?.page_count || 0
  );
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [realPdfOutline, setRealPdfOutline] = useState(
    Array.isArray(initialOutline) && initialOutline.length > 0
      ? initialOutline
      : []
  );

  // Display & Layout Preferences
  const [readerSettings, setReaderSettings] = useState(() =>
    loadReaderSettings()
  );
  const [zoom, setZoom] = useState(1.0);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("dau_reader_theme") || "light";
    } catch {
      return "light";
    }
  });
  const [fitMode, setFitMode] = useState(() => {
    try {
      return localStorage.getItem("dau_reader_fitmode") || "width";
    } catch {
      return "width";
    }
  });
  const [viewMode, setViewModeState] = useState(() => {
    try {
      return localStorage.getItem("dau_reader_viewmode") || "vertical";
    } catch {
      return "vertical";
    }
  });
  const [brightness, setBrightness] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Panels & Drawers
  const [activePanel, setActivePanel] = useState(null); // null | "toc" | "search" | "settings" | "goto"
  const [goToInput, setGoToInput] = useState("");
  // Smart Reader bar is CLOSED by default — opens ONLY when user clicks the single Smart Reader button!
  const [isAudioOpen, setIsAudioOpen] = useState(false);

  // Bookmarks
  const [bookmarks, setBookmarks] = useState([]);

  // Pen & Annotation System
  const [isAnnotationActive, setIsAnnotationActive] = useState(false);
  const [annotationTool, setAnnotationTool] = useState("pen");
  const [annotationColor, setAnnotationColor] = useState("#EF4444");
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(4);
  const [pageAnnotationCount, setPageAnnotationCount] = useState(0);
  const [canRedoAnnot, setCanRedoAnnot] = useState(false);
  const [annotationRevision, setAnnotationRevision] = useState(0);

  // Intelligent Reader Page Extraction & Audio State
  const [activePageData, setActivePageData] = useState(null);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [audioSnapshot, setAudioSnapshot] = useState(() =>
    intelligentAudioEngine.getSnapshot()
  );

  // Search System
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef(0);

  const [scrollTriggerPage, setScrollTriggerPage] = useState(null);
  const viewerRootRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const autoContinueNextPageRef = useRef(false);

  const themeCfg = READER_THEMES[theme] || READER_THEMES.light;

  // Keep parent ReadBook header progress badge synchronized
  useEffect(() => {
    onProgressChange?.({ currentPage, totalPages });
  }, [currentPage, totalPages, onProgressChange]);

  // Subscribe to singleton IntelligentAudioEngine
  useEffect(() => {
    return intelligentAudioEngine.subscribe((snap) => {
      setAudioSnapshot(snap);
    });
  }, []);

  // Load saved bookmarks
  useEffect(() => {
    try {
      const savedBm = localStorage.getItem(`dau_bookmarks_${bookId}`);
      if (savedBm) setBookmarks(JSON.parse(savedBm));
    } catch {}
  }, [bookId]);

  // Load PDF Document
  const initPdf = useCallback(async () => {
    if (!pdfUrl && !bookId) {
      setError(t.noPdf || "لا يتوفر رابط ملف PDF لهذا الكتاب.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const doc = await loadPdfDocument(pdfUrl, {
        bookId,
        title: effectiveBook?.title,
      });
      setPdfDoc(doc);
      const count =
        doc.numPages ||
        effectiveBook?.pages_count ||
        effectiveBook?.page_count ||
        1;
      setTotalPages(count);
      const savedPos = loadReadingPosition(
        bookId,
        computeFileFingerprint(effectiveBook)
      );
      const targetStartPage =
        initialPage && Number(initialPage) > 1
          ? Number(initialPage)
          : savedPos?.pageNumber || Number(initialPage) || 1;
      const validInit = Math.min(Math.max(1, targetStartPage), count);
      setCurrentPage(validInit);
      setScrollTriggerPage({ page: validInit, seq: Date.now() });

      if (savedPos && Number(savedPos.pageNumber) === validInit) {
        intelligentAudioEngine.restoreSavedPosition(savedPos);
      }

      extractRealPdfOutline(doc)
        .then((outline) => {
          if (Array.isArray(outline) && outline.length > 0) {
            setRealPdfOutline(outline);
          }
        })
        .catch(() => {});
    } catch (err) {
      setError(
        err?.message ||
          t.readerLoadError ||
          "فشل تحميل PDF: تعذر فتح ملف الكتاب."
      );
    } finally {
      setLoading(false);
    }
  }, [
    pdfUrl,
    bookId,
    effectiveBook?.title,
    effectiveBook?.pages_count,
    effectiveBook?.page_count,
    initialPage,
    t.noPdf,
    t.readerLoadError,
  ]);

  useEffect(() => {
    initPdf();
  }, [initPdf]);

  // Helper to run/ensure page extraction (with automatic OCR when needed)
  const ensurePageExtracted = useCallback(
    async (targetPageNumber = currentPage, forceOcr = false) => {
      if (!pdfDoc && !effectiveBook?.structured_pages) return null;
      setIsRunningOcr(true);
      intelligentAudioEngine.setExtractingPage(true);
      try {
        const data = await extractAndProcessPdfPage({
          pdfDoc,
          pageNumber: targetPageNumber,
          bookId,
          autoOcrEnabled: readerSettings.autoOcrNastaliq !== false,
          forceOcr,
          reciterId: readerSettings.quranReciterId || "ar.alafasy",
          bookMetadata: effectiveBook,
        });
        setActivePageData(data);
        return data;
      } catch (e) {
        console.warn("[DAR AL TAWHID Page Processor]:", e);
        return null;
      } finally {
        setIsRunningOcr(false);
        intelligentAudioEngine.setExtractingPage(false);
      }
    },
    [
      pdfDoc,
      currentPage,
      bookId,
      effectiveBook,
      readerSettings.autoOcrNastaliq,
      readerSettings.quranReciterId,
    ]
  );

  //Persist page progress
  const updateCurrentPage = useCallback(
    (nextPage, shouldScrollStream = true) => {
      setCurrentPage((prevPage) => {
        const maxPage = totalPages > 0 ? totalPages : 999999;
        const clamped = Math.min(Math.max(1, Number(nextPage) || 1), maxPage);
        if (shouldScrollStream) {
          setScrollTriggerPage({ page: clamped, seq: Date.now() });
        }
        if (clamped !== prevPage) {
          onPageChange?.(clamped);
          saveReadingPosition(bookId, {
            bookId,
            bookTitle: effectiveBook?.title || "",
            fileVersion: computeFileFingerprint(effectiveBook),
            pageNumber: clamped,
          });
        }
        return clamped;
      });
    },
    [totalPages, onPageChange, bookId, effectiveBook]
  );

  const goToPage = useCallback(
    (p) => updateCurrentPage(p, true),
    [updateCurrentPage]
  );

  const shouldExtractCurrentPage = Boolean(
    pdfDoc ||
      effectiveBook?.structured_pages ||
      isAudioOpen ||
      audioSnapshot.playerState === "playing" ||
      audioSnapshot.playerState === "loading" ||
      audioSnapshot.playerState === "paused"
  );

  // Extract & process current page text when Smart Reader is opened or active
  useEffect(() => {
    if (!pdfDoc && !effectiveBook?.structured_pages) return;
    if (!shouldExtractCurrentPage) return;

    let cancelled = false;

    const processCurrentPage = async () => {
      setIsRunningOcr(true);
      intelligentAudioEngine.setContext({
        book: effectiveBook,
        pageNumber: currentPage,
        totalPages:
          totalPages ||
          effectiveBook?.pages_count ||
          effectiveBook?.page_count ||
          1,
        isExtractingPage: true,
        onRequestPageTurn: (targetPage, opts) => {
          if (opts?.autoContinueAudio) {
            autoContinueNextPageRef.current = true;
          }
          goToPage(targetPage);
        },
        onEnsurePageExtracted: async (pageNum) => {
          return await ensurePageExtracted(pageNum || currentPage, false);
        },
      });
      try {
        const data = await extractAndProcessPdfPage({
          pdfDoc,
          pageNumber: currentPage,
          bookId,
          autoOcrEnabled: readerSettings.autoOcrNastaliq !== false,
          forceOcr: false,
          reciterId: readerSettings.quranReciterId || "ar.alafasy",
          bookMetadata: effectiveBook,
        });
        if (cancelled) return;
        setActivePageData(data);

        intelligentAudioEngine.setContext({
          book: effectiveBook,
          pageNumber: currentPage,
          totalPages:
            totalPages ||
            effectiveBook?.pages_count ||
            effectiveBook?.page_count ||
            1,
          pageData: data,
          isExtractingPage: false,
          onRequestPageTurn: (targetPage, opts) => {
            if (opts?.autoContinueAudio) {
              autoContinueNextPageRef.current = true;
            }
            goToPage(targetPage);
          },
          onEnsurePageExtracted: async (pageNum) => {
            return await ensurePageExtracted(pageNum || currentPage, false);
          },
        });

        if (autoContinueNextPageRef.current) {
          autoContinueNextPageRef.current = false;
          intelligentAudioEngine.playFrom({ sentenceIndex: 0, wordIndex: 0 });
        }
      } catch (e) {
        console.warn("[DAR AL TAWHID Page Processor]:", e);
      } finally {
        if (!cancelled) {
          setIsRunningOcr(false);
          intelligentAudioEngine.setExtractingPage(false);
        }
      }
    };

    processCurrentPage();
    return () => {
      cancelled = true;
    };
  }, [
    pdfDoc,
    currentPage,
    bookId,
    effectiveBook,
    totalPages,
    shouldExtractCurrentPage,
    readerSettings.autoOcrNastaliq,
    readerSettings.quranReciterId,
    ensurePageExtracted,
    goToPage,
  ]);

  // Manual trigger to re-run OCR on current page
  const handleRunOcrRefresh = useCallback(async () => {
    if (!pdfDoc) return;
    const freshData = await ensurePageExtracted(currentPage, true);
    if (freshData) {
      intelligentAudioEngine.setContext({
        book: effectiveBook,
        pageNumber: currentPage,
        totalPages,
        pageData: freshData,
        isExtractingPage: false,
      });
    }
  }, [pdfDoc, currentPage, effectiveBook, totalPages, ensurePageExtracted]);

  // Refresh annotation count & redo status for current page
  const syncAnnotationMeta = useCallback(() => {
    const list = loadPageAnnotations(bookId, currentPage);
    setPageAnnotationCount(list.length);
    setCanRedoAnnot(canRedoPageAnnotation(bookId, currentPage));
  }, [bookId, currentPage]);

  useEffect(() => {
    syncAnnotationMeta();
  }, [syncAnnotationMeta, isAnnotationActive, annotationRevision]);

  const nextPage = useCallback(() => {
    setCurrentPage((prev) => {
      const step = viewMode === "spread" ? 2 : 1;
      const maxPage = totalPages > 0 ? totalPages : prev + step;
      const clamped = Math.min(maxPage, prev + step);
      setScrollTriggerPage({ page: clamped, seq: Date.now() });
      if (clamped !== prev) onPageChange?.(clamped);
      return clamped;
    });
  }, [viewMode, totalPages, onPageChange]);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => {
      const step = viewMode === "spread" ? 2 : 1;
      const clamped = Math.max(1, prev - step);
      setScrollTriggerPage({ page: clamped, seq: Date.now() });
      if (clamped !== prev) onPageChange?.(clamped);
      return clamped;
    });
  }, [viewMode, onPageChange]);

  const handleUpdateReaderSettings = useCallback((partial) => {
    const updated = saveReaderSettings(partial);
    setReaderSettings(updated);
    if (partial.defaultSpeed) {
      intelligentAudioEngine.setPlaybackRate(partial.defaultSpeed);
    }
    if (partial.volume !== undefined) {
      intelligentAudioEngine.setVolume(partial.volume);
    }
  }, []);

  // Theme & FitMode persistence
  const handleChangeTheme = (newTheme) => {
    setTheme(newTheme);
    try {
      localStorage.setItem("dau_reader_theme", newTheme);
    } catch {}
  };

  const handleSelectFitMode = (newFit) => {
    setFitMode(newFit);
    setZoom(1.0);
    try {
      localStorage.setItem("dau_reader_fitmode", newFit);
    } catch {}
  };

  const handleSelectViewMode = useCallback(
    (nextMode) => {
      const resolved = nextMode === "single" ? "single" : "vertical";
      setViewModeState(resolved);
      try {
        localStorage.setItem("dau_reader_viewmode", resolved);
      } catch {}
      setScrollTriggerPage({ page: currentPage, seq: Date.now() });
    },
    [currentPage]
  );

  // Bookmarks management
  const isCurrentBookmarked = bookmarks.some(
    (b) => (typeof b === "number" ? b : b.page) === currentPage
  );

  const toggleBookmark = () => {
    let updated;
    if (isCurrentBookmarked) {
      updated = bookmarks.filter(
        (b) => (typeof b === "number" ? b : b.page) !== currentPage
      );
    } else {
      updated = [
        ...bookmarks,
        {
          page: currentPage,
          label: `${t.pageNo || "ص"} ${currentPage}`,
          timestamp: Date.now(),
        },
      ].sort((a, b) => (a.page || a) - (b.page || b));
    }
    setBookmarks(updated);
    try {
      localStorage.setItem(`dau_bookmarks_${bookId}`, JSON.stringify(updated));
    } catch {}
  };

  const removeBookmark = (page) => {
    const updated = bookmarks.filter(
      (b) => (typeof b === "number" ? b : b.page) !== page
    );
    setBookmarks(updated);
    try {
      localStorage.setItem(`dau_bookmarks_${bookId}`, JSON.stringify(updated));
    } catch {}
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    const el = viewerRootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Undo, Redo & Clear annotations on current page
  const handleUndoAnnotation = () => {
    if (undoPageAnnotation(bookId, currentPage)) {
      setAnnotationRevision((r) => r + 1);
      syncAnnotationMeta();
    }
  };

  const handleRedoAnnotation = () => {
    if (redoPageAnnotation(bookId, currentPage)) {
      setAnnotationRevision((r) => r + 1);
      syncAnnotationMeta();
    }
  };

  const handleClearPageAnnotations = () => {
    if (clearPageAnnotations(bookId, currentPage)) {
      setAnnotationRevision((r) => r + 1);
      syncAnnotationMeta();
    }
  };

  // In-Book Full-Text Search
  const handleSearchChange = async (q) => {
    setSearchQuery(q);
    const trimmed = q.trim();
    if (!trimmed || !pdfDoc || trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const runId = ++searchAbortRef.current;
    setIsSearching(true);
    const matches = [];
    const maxPagesToScan = Math.min(totalPages, 250);

    for (let p = 1; p <= maxPagesToScan; p++) {
      if (searchAbortRef.current !== runId) return;
      const text = await extractPageText(pdfDoc, p);
      if (text && text.toLowerCase().includes(trimmed.toLowerCase())) {
        const idx = text.toLowerCase().indexOf(trimmed.toLowerCase());
        const start = Math.max(0, idx - 35);
        const end = Math.min(text.length, idx + trimmed.length + 45);
        const snippet =
          (start > 0 ? "..." : "") +
          text.slice(start, end) +
          (end < text.length ? "..." : "");
        matches.push({ page: p, snippet });
        if (matches.length >= 40) break;
      }
    }

    if (searchAbortRef.current === runId) {
      setSearchResults(matches);
      setIsSearching(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT"
      )
        return;
      if (e.key === "ArrowLeft") nextPage();
      else if (e.key === "ArrowRight") prevPage();
      else if (e.key === "+" || e.key === "=")
        setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)));
      else if (e.key === "-")
        setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextPage, prevPage]);

  // Touch swipe navigation for single page mode
  const handleTouchStart = (e) => {
    if (
      (isAnnotationActive && annotationTool !== "pan") ||
      viewMode === "vertical" ||
      zoom > 1.15 ||
      e.touches.length !== 1
    )
      return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (
      (isAnnotationActive && annotationTool !== "pan") ||
      viewMode === "vertical" ||
      touchStartX.current === null ||
      e.changedTouches.length !== 1
    )
      return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx > 0) nextPage();
      else prevPage();
    } else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.35) {
      if (dy < 0) nextPage();
      else prevPage();
    }
  };

  const togglePanel = (panelName) => {
    setActivePanel((prev) => (prev === panelName ? null : panelName));
  };

  const isAudioActive =
    audioSnapshot.playerState === "playing" ||
    audioSnapshot.playerState === "paused";

  return (
    <div
      ref={viewerRootRef}
      dir={t.dir || "rtl"}
      className="fixed inset-0 flex flex-col overflow-hidden select-none z-50"
      style={{
        backgroundColor: themeCfg.bg,
        color: themeCfg.text,
      }}
    >
      {/* 1. Classic Top Header Bar */}
      <TopHeaderBar
        title={effectiveBook?.title}
        themeCfg={themeCfg}
        currentPage={currentPage}
        totalPages={totalPages}
        isBookmarked={isCurrentBookmarked}
        viewMode={viewMode}
        onToggleViewMode={() =>
          handleSelectViewMode(viewMode === "vertical" ? "single" : "vertical")
        }
        onBack={onBack}
        onTogglePanel={togglePanel}
        onToggleBookmark={toggleBookmark}
      />

      {/* 2. Main Book Viewport (Largest element on screen, responsive across all devices) */}
      <div
        className="relative flex-1 flex flex-col items-center justify-center overflow-hidden"
        style={{
          filter: brightness < 100 ? `brightness(${brightness}%)` : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 p-6">
            <Loader2 className="w-9 h-9 animate-spin text-emerald-600" />
            <p className="text-xs font-bold opacity-80">
              {t.readerLoading || "جاري تحميل الكتاب..."}
            </p>
          </div>
        ) : error ? (
          <div className="max-w-sm mx-4 p-5 rounded-2xl border border-red-500/20 bg-red-500/5 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
            <h2 className="font-bold text-sm">{error}</h2>
            <button
              type="button"
              onClick={initPdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.readerRetry || "إعادة المحاولة"}</span>
            </button>
          </div>
        ) : viewMode === "vertical" ? (
          <VerticalPageStream
            pdfDoc={pdfDoc}
            totalPages={totalPages}
            currentPage={currentPage}
            onVisiblePageChange={(p) => updateCurrentPage(p, false)}
            zoom={zoom}
            fitMode={fitMode}
            theme={theme}
            themeCfg={themeCfg}
            isAnnotationActive={isAnnotationActive}
            annotationTool={annotationTool}
            annotationColor={annotationColor}
            annotationStrokeWidth={annotationStrokeWidth}
            annotationRevision={annotationRevision}
            onAnnotationChange={syncAnnotationMeta}
            bookId={bookId}
            scrollTriggerPage={scrollTriggerPage}
            activePageData={activePageData}
            activeSentenceIndex={audioSnapshot.sentenceIndex}
            activeWordIndex={audioSnapshot.wordIndex}
            isAudioActive={isAudioActive && isAudioOpen}
            wordHighlightEnabled={readerSettings.wordHighlightEnabled !== false}
            sentenceHighlightEnabled={
              readerSettings.sentenceHighlightEnabled !== false
            }
            highlightColorId={readerSettings.highlightColorId || "cyan"}
            onSelectSentenceOrWord={(sIdx, wIdx) => {
              setIsAudioOpen(true);
              intelligentAudioEngine.playFrom({
                sentenceIndex: sIdx,
                wordIndex: wIdx,
              });
            }}
          />
        ) : (
          /* Single Page View - Responsive across mobile, tablet, and desktop */
          <div className="w-full h-full overflow-auto flex items-start justify-center p-1 sm:p-3">
            <div className="flex items-center justify-center gap-3 my-auto max-w-full">
              <div className="relative inline-block shadow-xl rounded-lg overflow-hidden transition-transform max-w-full">
                <PdfPageRenderer
                  pdfDoc={pdfDoc}
                  pageNumber={currentPage}
                  zoom={zoom}
                  fitMode={fitMode}
                  theme={theme}
                  themeFilter={themeCfg.pageFilter}
                  themeBg={themeCfg.pageBg}
                >
                  {!isAnnotationActive && (
                    <SmartWordHighlightLayer
                      pageData={activePageData}
                      activeSentenceIndex={audioSnapshot.sentenceIndex}
                      activeWordIndex={audioSnapshot.wordIndex}
                      isPlayingOrPaused={isAudioActive && isAudioOpen}
                      wordHighlightEnabled={
                        readerSettings.wordHighlightEnabled !== false
                      }
                      sentenceHighlightEnabled={
                        readerSettings.sentenceHighlightEnabled !== false
                      }
                      highlightColorId={
                        readerSettings.highlightColorId || "cyan"
                      }
                      isAnnotationActive={isAnnotationActive}
                      onSelectSentenceOrWord={(sIdx, wIdx) => {
                        setIsAudioOpen(true);
                        intelligentAudioEngine.playFrom({
                          sentenceIndex: sIdx,
                          wordIndex: wIdx,
                        });
                      }}
                    />
                  )}
                  <PageAnnotationLayer
                    bookId={bookId}
                    pageNumber={currentPage}
                    active={isAnnotationActive}
                    tool={annotationTool}
                    color={annotationColor}
                    size={annotationStrokeWidth}
                    theme={theme}
                    revision={annotationRevision}
                    onAnnotationChange={syncAnnotationMeta}
                  />
                </PdfPageRenderer>
              </div>
            </div>
          </div>
        )}

        {/* Popovers & Drawers */}
        {activePanel === "toc" && (
          <TocPanel
            show={true}
            isRTL={true}
            darkMode={theme === "dark" || theme === "dusk"}
            theme={theme}
            outline={
              realPdfOutline.length > 0
                ? realPdfOutline
                : (effectiveBook?.table_of_contents || []).map((it) => ({
                    title: it.title,
                    pageNumber: it.page || it.pageNumber,
                    items: [],
                  }))
            }
            totalPages={totalPages}
            currentPage={currentPage}
            bookmarks={bookmarks.map((b) =>
              typeof b === "number" ? b : b.page
            )}
            onClose={() => setActivePanel(null)}
            onPageClick={(p) => {
              goToPage(p);
              setActivePanel(null);
            }}
            onToggleBookmark={toggleBookmark}
            onRemoveBookmark={removeBookmark}
          />
        )}

        {activePanel === "search" && (
          <div
            dir={t.dir || "rtl"}
            className="absolute top-2 right-2 sm:right-4 w-80 sm:w-96 max-w-[94vw] max-h-[75vh] flex flex-col rounded-2xl border shadow-2xl z-40 overflow-hidden"
            style={{
              backgroundColor: themeCfg.toolbar,
              borderColor: themeCfg.border,
              color: themeCfg.text,
            }}
          >
            <div className="p-3 border-b border-current/10 flex items-center justify-between gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t.idxSearchPlaceholder || "ابحث في الكتاب..."}
                autoFocus
                className="flex-1 px-3 py-1.5 rounded-xl border border-emerald-600 bg-transparent text-xs font-medium focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setActivePanel(null)}
                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {isSearching ? (
                <div className="text-xs opacity-70 py-4 text-center">
                  {t.searchingPages || "جاري البحث في صفحات الكتاب..."}
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((res, idx) => (
                  <button
                    key={`sr-${idx}`}
                    type="button"
                    onClick={() => {
                      goToPage(res.page);
                      setActivePanel(null);
                    }}
                    className="w-full text-start p-2.5 rounded-xl border border-current/10 hover:border-emerald-600 transition-colors space-y-1"
                  >
                    <div className="text-[11px] font-bold text-emerald-600">
                      {t.pageNo || "ص"} {res.page}
                    </div>
                    <div className="text-xs opacity-85 line-clamp-2">
                      {res.snippet}
                    </div>
                  </button>
                ))
              ) : searchQuery.trim().length >= 2 ? (
                <div className="text-xs opacity-60 py-4 text-center">
                  {t.noResults || "لا توجد نتائج"}
                </div>
              ) : (
                <div className="text-xs opacity-60 py-4 text-center">
                  {t.idxSearchPlaceholder || "ابحث في الكتاب..."}
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === "settings" && (
          <ThemeComfortPanel
            show={true}
            theme={theme}
            onSelectTheme={handleChangeTheme}
            fitMode={fitMode}
            onSelectFitMode={handleSelectFitMode}
            viewMode={viewMode}
            onSelectViewMode={handleSelectViewMode}
            brightness={brightness}
            onChangeBrightness={setBrightness}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === "goto" && (
          <GoToPanel
            show={true}
            value={goToInput}
            setValue={setGoToInput}
            totalPages={totalPages || 1}
            darkMode={theme === "dark" || theme === "dusk"}
            theme={theme}
            onGo={() => {
              const num = parseInt(goToInput, 10);
              if (!isNaN(num) && num >= 1 && num <= (totalPages || 1)) {
                goToPage(num);
                setGoToInput("");
                setActivePanel(null);
              }
            }}
            onClose={() => setActivePanel(null)}
          />
        )}

        {/* Classic Pen / Annotation Dock */}
        {isAnnotationActive && (
          <AnnotationDock
            activeTool={annotationTool}
            onSelectTool={setAnnotationTool}
            activeColor={annotationColor}
            onSelectColor={setAnnotationColor}
            strokeWidth={annotationStrokeWidth}
            onChangeStrokeWidth={setAnnotationStrokeWidth}
            onUndo={handleUndoAnnotation}
            onRedo={handleRedoAnnotation}
            canRedo={canRedoAnnot}
            onClearPage={handleClearPageAnnotations}
            hasAnnotations={pageAnnotationCount > 0}
            onClose={() => setIsAnnotationActive(false)}
            themeCfg={themeCfg}
          />
        )}
      </div>

      {/* 3. Simple Smart Reader Bar (ONLY shown when user clicks the single Smart Reader button) */}
      <IntelligentAudioPlayer
        pageData={activePageData}
        audioState={audioSnapshot}
        readerSettings={readerSettings}
        isOpen={isAudioOpen}
        onClose={() => {
          intelligentAudioEngine.pause();
          setIsAudioOpen(false);
        }}
        onPlay={(opts) => intelligentAudioEngine.playFrom(opts)}
        onPause={() => intelligentAudioEngine.pause()}
        onStop={() => intelligentAudioEngine.stop()}
        onPrevSentence={() => intelligentAudioEngine.prevSentence()}
        onNextSentence={() => intelligentAudioEngine.nextSentence()}
        onChangeSpeed={(spd) => {
          intelligentAudioEngine.setPlaybackRate(spd);
          handleUpdateReaderSettings({ defaultSpeed: spd });
        }}
        onUpdateSettings={handleUpdateReaderSettings}
        onRetryExtract={handleRunOcrRefresh}
        isRunningOcr={isRunningOcr}
        themeCfg={themeCfg}
        darkMode={theme === "dark" || theme === "dusk"}
      />

      {/* 4. Classic Bottom Toolbar with All Original Controls + 1 Smart Reader Button */}
      <BottomControlBar
        currentPage={currentPage}
        totalPages={totalPages}
        zoom={zoom}
        themeCfg={themeCfg}
        isFullscreen={isFullscreen}
        viewMode={viewMode}
        onToggleViewMode={() =>
          handleSelectViewMode(viewMode === "vertical" ? "single" : "vertical")
        }
        isAudioOpen={isAudioOpen}
        onToggleAudioOpen={() => {
          setIsAudioOpen((prev) => {
            const next = !prev;
            if (!next && audioSnapshot.playerState === "playing") {
              intelligentAudioEngine.pause("immediate");
            } else if (next && audioSnapshot.playerState !== "playing") {
              setTimeout(() => {
                intelligentAudioEngine.playFrom({
                  sentenceIndex: audioSnapshot.sentenceIndex || 0,
                  wordIndex: audioSnapshot.wordIndex || 0,
                });
              }, 40);
            }
            return next;
          });
        }}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onOpenGoTo={() => {
          setGoToInput(String(currentPage));
          togglePanel("goto");
        }}
        onZoomIn={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
        onZoomOut={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
        onResetZoom={() => setZoom(1.0)}
        onTogglePanel={togglePanel}
        activePanel={activePanel}
        onToggleBookmark={toggleBookmark}
        isBookmarked={isCurrentBookmarked}
        onToggleFullscreen={toggleFullscreen}
        onToggleAnnotation={() => setIsAnnotationActive((v) => !v)}
        isAnnotationActive={isAnnotationActive}
        audioState={audioSnapshot}
      />
    </div>
  );
}