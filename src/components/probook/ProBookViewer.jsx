import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronUp,
} from "lucide-react";
import { loadPdfDocument, clearPageCache } from "@/lib/pdfLoader";
import { useT } from "@/lib/i18n";
import { getThemeState, subscribeToTheme } from "@/lib/themeEngine";
import ViewerToolbar from "./ViewerToolbar";
import {
  TocPanel,
  GoToPanel,
  ThemeComfortPanel,
} from "./ViewerPanels";
import VerticalPageStream, { READER_THEMES } from "./VerticalPageStream";
import {
  undoPageAnnotation,
  redoPageAnnotation,
  clearPageAnnotations,
  getPageAnnotationCount,
  canRedoPageAnnotation,
} from "./PageAnnotationLayer";

const BM_PREFIX = "dau_bm_";

const clampZoom = (z) => Math.max(0.5, Math.min(3, +Number(z).toFixed(2)));

export default function ProBookViewer({
  pdfUrl,
  title,
  bookId,
  language = "ar",
  onProgressChange,
}) {
  const t = useT();
  const [pdf, setPdf] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  const [theme, setTheme] = useState(() => {
    try {
      const appIsDark =
        typeof document !== "undefined" &&
        (document.documentElement.classList.contains("dark") || getThemeState().isDark);
      const saved = localStorage.getItem("dau_reader_theme");
      if (saved && ["light", "dark", "sepia", "dusk"].includes(saved)) {
        // If user enabled app-wide dark mode and reader was still on default "light", honor dark mode on pages
        if (appIsDark && saved === "light") return "dark";
        return saved;
      }
      return appIsDark ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  // Sync book page theme whenever global App Dark Mode is toggled
  useEffect(() => {
    const unsub = subscribeToTheme(({ isDark }) => {
      setTheme((prev) => {
        if (isDark && (prev === "light" || prev === "sepia")) return "dark";
        if (!isDark && (prev === "dark" || prev === "dusk")) return "light";
        return prev;
      });
    });
    return unsub;
  }, []);

  // Always use smooth vertical scroll stream (View Mode toggle button removed per user request)
  const viewMode = "scroll";

  const [fitMode, setFitMode] = useState(() => {
    try {
      const v = localStorage.getItem("dau_reader_fit_mode");
      return ["width", "page"].includes(v) ? v : "width";
    } catch {
      return "width";
    }
  });

  const [brightness, setBrightness] = useState(() => {
    try {
      const v = Number(localStorage.getItem("dau_reader_brightness"));
      return v >= 55 && v <= 100 ? v : 100;
    } catch {
      return 100;
    }
  });

  // Precision Pen / Highlighter / Notes Tool State
  const [penMode, setPenMode] = useState(false);
  const [penTool, setPenTool] = useState("pen"); // "pen" | "highlighter" | "text" | "eraser"
  const [penColor, setPenColor] = useState("#EF4444");
  const [penSize, setPenSize] = useState(3.5);
  const [annotRevision, setAnnotRevision] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showToolbar, setShowToolbar] = useState(true);

  // Panels
  const [showToc, setShowToc] = useState(false);
  const [showGoTo, setShowGoTo] = useState(false);
  const [showComfort, setShowComfort] = useState(false);
  const [outline, setOutline] = useState([]);

  // Go-to input
  const [goToValue, setGoToValue] = useState("");
  const totalPagesRef = useRef(0);

  // Bookmarks (persisted per book)
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(BM_PREFIX + bookId) || "[]");
    } catch {
      return [];
    }
  });

  const rootRef = useRef(null);
  const scrollToPageRef = useRef(null);
  const currentPageRef = useRef(1);
  const pointerDownRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef(null);
  const [showZoomPct, setShowZoomPct] = useState(false);
  const didRestoreRef = useRef(false);

  // ── Flash zoom indicator on change ──
  const firstZoomRef = useRef(true);
  useEffect(() => {
    if (firstZoomRef.current) {
      firstZoomRef.current = false;
      return;
    }
    setShowZoomPct(true);
    const tm = setTimeout(() => setShowZoomPct(false), 900);
    return () => clearTimeout(tm);
  }, [zoom]);

  // ── Ctrl/⌘ + wheel zoom ──
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const isRTL = true;

  // ── Load PDF document ──
  useEffect(() => {
    let cancelled = false;
    let outlineTimer = null;
    didRestoreRef.current = false;
    setLoading(true);
    setError(false);
    setPdf(null);
    setOutline([]);
    setCurrentPage(1);

    loadPdfDocument(pdfUrl, { bookId, title })
      .then((doc) => {
        if (cancelled) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        setLoading(false);

        outlineTimer = setTimeout(() => {
          if (cancelled) return;
          doc
            .getOutline()
            .then(async (out) => {
              if (cancelled) return [];
              let items = await normalizeOutline(out, doc);
              if (!items || items.length === 0 || items.every((x) => !x.pageNumber)) {
                items = generateSmartOutline(doc.numPages, language);
              }
              return items;
            })
            .then((items) => {
              if (!cancelled) setOutline(items || []);
            })
            .catch(() => {
              if (!cancelled) {
                const fallback = generateSmartOutline(doc.numPages, language);
                if (!cancelled) setOutline(fallback || []);
              }
            });
        }, 900);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (outlineTimer) clearTimeout(outlineTimer);
    };
  }, [pdfUrl, bookId, title, reloadKey, language]);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // ── Save & restore last read page ──
  useEffect(() => {
    if (pdf && totalPages > 0 && !didRestoreRef.current) {
      didRestoreRef.current = true;
      const saved = Number(localStorage.getItem(`lastpage_${bookId}`));
      if (saved && saved > 0 && saved <= totalPages) {
        setCurrentPage(saved);
        setTimeout(() => scrollToPageRef.current?.(saved), 120);
      }
    }
  }, [pdf, totalPages, bookId]);

  useEffect(() => {
    if (totalPages > 0 && currentPage > 0) {
      localStorage.setItem(`lastpage_${bookId}`, String(currentPage));
      localStorage.setItem(`lastts_${bookId}`, String(Date.now()));
      onProgressChange?.({ currentPage, totalPages });
    }
  }, [currentPage, totalPages, bookId, onProgressChange]);

  // ── Persist reader preferences ──
  useEffect(() => {
    try {
      localStorage.setItem(BM_PREFIX + bookId, JSON.stringify(bookmarks));
    } catch {}
  }, [bookmarks, bookId]);

  useEffect(() => {
    try {
      localStorage.setItem("dau_reader_theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("dau_reader_fit_mode", fitMode);
    } catch {}
  }, [fitMode]);

  useEffect(() => {
    try {
      localStorage.setItem("dau_reader_brightness", String(brightness));
    } catch {}
  }, [brightness]);

  // ── Navigation helpers ──
  const goToPage = useCallback(
    (p) => {
      const tp = totalPagesRef.current || totalPages;
      const n = Math.max(1, Math.min(tp, Number(p) || 1));
      setCurrentPage(n);
      scrollToPageRef.current?.(n);
    },
    [totalPages]
  );

  const nextPage = useCallback(
    () => goToPage((currentPageRef.current || 1) + 1),
    [goToPage]
  );
  const prevPage = useCallback(
    () => goToPage((currentPageRef.current || 1) - 1),
    [goToPage]
  );

  const onStreamPageChange = useCallback((n) => setCurrentPage(n), []);
  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + 0.2)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - 0.2)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  const toggleBookmark = useCallback(() => {
    setCurrentPage((cp) => {
      setBookmarks((b) =>
        b.includes(cp)
          ? b.filter((x) => x !== cp)
          : [...b, cp].sort((a, c) => a - c)
      );
      return cp;
    });
  }, []);

  const removeBookmark = useCallback((pageNum) => {
    setBookmarks((b) => b.filter((x) => x !== pageNum));
  }, []);

  const toggleFullscreen = useCallback(() => {
    try {
      const el = rootRef.current || document.documentElement;
      const isFs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!isFs) {
        const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
        if (req) Promise.resolve(req.call(el)).catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) Promise.resolve(exit.call(document)).catch(() => {});
      }
    } catch {}
  }, []);

  // ── Annotation Undo / Redo / Clear helpers ──
  const handleUndoAnnotation = useCallback(() => {
    if (undoPageAnnotation(bookId, currentPageRef.current)) {
      setAnnotRevision((r) => r + 1);
    }
  }, [bookId]);

  const handleRedoAnnotation = useCallback(() => {
    if (redoPageAnnotation(bookId, currentPageRef.current)) {
      setAnnotRevision((r) => r + 1);
    }
  }, [bookId]);

  const handleClearAnnotations = useCallback(() => {
    if (clearPageAnnotations(bookId, currentPageRef.current)) {
      setAnnotRevision((r) => r + 1);
    }
  }, [bookId]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const onKey = (e) => {
      if (showToc || showGoTo || showComfort) return;
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndoAnnotation();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "ArrowRight") nextPage();
      else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "ArrowLeft") prevPage();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-") zoomOut();
      else if (e.key === "0") resetZoom();
      else if (e.key === "b" || e.key === "B") toggleBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    resetZoom,
    toggleBookmark,
    handleUndoAnnotation,
    showToc,
    showGoTo,
    showComfort,
  ]);

  const openGoTo = useCallback(() => {
    setGoToValue(String(currentPage));
    setShowGoTo((s) => !s);
  }, [currentPage]);

  useEffect(
    () => () => {
      clearTimeout(tapTimerRef.current);
      clearPageCache();
    },
    []
  );

  const themeConfig = READER_THEMES[theme] || READER_THEMES.light;
  const isDarkTheme = theme === "dark" || theme === "dusk";

  // Current page annotation metrics
  const currentAnnotCount = getPageAnnotationCount(bookId, currentPage);
  const currentCanRedo = canRedoPageAnnotation(bookId, currentPage);

  if (loading) {
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center ${themeConfig.canvasBg}`}>
        <div className="w-full max-w-md mx-auto px-6 animate-pulse">
          <div className="bg-white/90 dark:bg-neutral-900/90 border border-stone-200 dark:border-neutral-800 rounded-xl shadow-lg aspect-[3/4] p-8 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-4 w-2/3 bg-stone-200 dark:bg-neutral-800 rounded mx-auto mb-6" />
              <div className="h-2.5 w-full bg-stone-200 dark:bg-neutral-800 rounded" />
              <div className="h-2.5 w-11/12 bg-stone-200 dark:bg-neutral-800 rounded" />
              <div className="h-2.5 w-full bg-stone-200 dark:bg-neutral-800 rounded" />
              <div className="h-2.5 w-4/5 bg-stone-200 dark:bg-neutral-800 rounded" />
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground pt-4">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <p className="text-xs font-medium">{t.readerLoading}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <span className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </span>
        <p className="text-sm text-destructive font-semibold">{t.readerLoadError}</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold active:scale-95 transition-transform"
        >
          {t.readerRetry}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative w-full h-full flex flex-col select-none ${themeConfig.canvasBg}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        pointerDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (penMode && penTool !== "pan") return;
        const targetEl = e.target instanceof Element ? e.target : null;
        if (showToc || showGoTo || showComfort) {
          if (!targetEl?.closest("[data-viewer-ui]")) {
            setShowComfort(false);
            setShowGoTo(false);
          }
          return;
        }
        if (targetEl?.closest("[data-viewer-ui]")) return;
        const dist = Math.hypot(
          e.clientX - pointerDownRef.current.x,
          e.clientY - pointerDownRef.current.y
        );
        if (dist > 14) return;

        const now = Date.now();
        const isDoubleTap = now - lastTapRef.current < 300;
        lastTapRef.current = now;
        if (isDoubleTap) {
          clearTimeout(tapTimerRef.current);
          setZoom((z) => (z > 1.05 ? 1 : 1.75));
          return;
        }
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = setTimeout(() => {
          setShowToolbar((s) => !s);
        }, 240);
      }}
    >
      {/* Virtualized Page Stream with Precision Pen Layer */}
      <VerticalPageStream
        pdf={pdf}
        bookId={bookId}
        totalPages={totalPages}
        currentPage={currentPage}
        zoom={zoom}
        onZoomChange={(z) => setZoom(clampZoom(z))}
        theme={theme}
        viewMode={viewMode}
        fitMode={fitMode}
        brightness={brightness}
        isRTL={isRTL}
        bookmarks={bookmarks}
        penMode={penMode}
        penTool={penTool}
        penColor={penColor}
        penSize={penSize}
        annotRevision={annotRevision}
        onAnnotationChange={() => setAnnotRevision((r) => r + 1)}
        onCurrentPageChange={onStreamPageChange}
        onNextPage={nextPage}
        onPrevPage={prevPage}
        scrollToPageRef={scrollToPageRef}
        onToggleToolbar={() => setShowToolbar((s) => !s)}
      />

      {/* Zoom level indicator */}
      <div
        className={`absolute top-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-md bg-stone-900/80 text-white text-xs font-mono tabular-nums font-bold pointer-events-none transition-opacity duration-200 ${
          showZoomPct ? "opacity-100" : "opacity-0"
        }`}
      >
        {Math.round(zoom * 100)}%
      </div>

      {/* Panels */}
      <TocPanel
        show={showToc}
        isRTL={isRTL}
        darkMode={isDarkTheme}
        outline={outline}
        totalPages={totalPages}
        currentPage={currentPage}
        bookmarks={bookmarks}
        onClose={() => setShowToc(false)}
        onPageClick={goToPage}
        onToggleBookmark={toggleBookmark}
        onRemoveBookmark={removeBookmark}
      />

      <ThemeComfortPanel
        show={showComfort}
        theme={theme}
        onSelectTheme={setTheme}
        fitMode={fitMode}
        onSelectFitMode={setFitMode}
        brightness={brightness}
        onChangeBrightness={setBrightness}
        onClose={() => setShowComfort(false)}
      />

      <GoToPanel
        show={showGoTo}
        darkMode={isDarkTheme}
        value={goToValue}
        setValue={setGoToValue}
        totalPages={totalPages}
        onGo={() => {
          goToPage(goToValue);
          setShowGoTo(false);
        }}
        onClose={() => setShowGoTo(false)}
      />

      {/* Bottom Toolbar */}
      {showToolbar ? (
        <ViewerToolbar
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          theme={theme}
          bookmarks={bookmarks}
          penMode={penMode}
          penTool={penTool}
          penColor={penColor}
          penSize={penSize}
          annotationCount={currentAnnotCount}
          canRedo={currentCanRedo}
          onTogglePenMode={() => {
            setShowComfort(false);
            setShowToc(false);
            setShowGoTo(false);
            setPenMode((p) => !p);
          }}
          onSelectPenTool={setPenTool}
          onSelectPenColor={setPenColor}
          onSelectPenSize={setPenSize}
          onUndoAnnotation={handleUndoAnnotation}
          onRedoAnnotation={handleRedoAnnotation}
          onClearAnnotations={handleClearAnnotations}
          onNext={nextPage}
          onPrev={prevPage}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onToggleComfort={() => {
            setShowToc(false);
            setShowGoTo(false);
            setShowComfort((s) => !s);
          }}
          onToggleBookmark={toggleBookmark}
          onToggleToc={() => {
            setShowComfort(false);
            setShowGoTo(false);
            setShowToc((s) => !s);
          }}
          onToggleGoTo={() => {
            setShowComfort(false);
            setShowToc(false);
            openGoTo();
          }}
          onSeekProgress={(f) => goToPage(Math.max(1, Math.round(f * totalPages)))}
          onToggleFullscreen={toggleFullscreen}
          onHide={() => {
            setShowComfort(false);
            setPenMode(false);
            setShowToolbar(false);
          }}
        />
      ) : (
        <button
          type="button"
          data-viewer-ui
          onClick={(e) => {
            e.stopPropagation();
            setShowToolbar(true);
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg bg-stone-900/85 text-stone-100 shadow-lg flex items-center gap-1.5 text-xs font-mono tabular-nums hover:bg-stone-900 transition-colors"
          title={t.tbShow}
        >
          <ChevronUp className="w-3.5 h-3.5" />
          <span>
            {currentPage} / {totalPages}
          </span>
        </button>
      )}
    </div>
  );
}

// Normalize PDF.js outline into { title, pageNumber, items[] }
async function normalizeOutline(outline, pdf) {
  if (!outline || !outline.length) return [];
  const walk = async (items, defaultPage = 1) => {
    const res = [];
    let curPage = defaultPage;
    for (const it of items) {
      let pageNumber = null;
      try {
        if (it.dest) {
          let dest = it.dest;
          if (typeof dest === "string") dest = await pdf.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            const idx = await pdf.getPageIndex(dest[0]);
            pageNumber = idx + 1;
          }
        }
      } catch {}
      const resolvedPage = pageNumber || curPage;
      curPage = resolvedPage;
      res.push({
        title: it.title || "",
        pageNumber: resolvedPage,
        items: it.items && it.items.length ? await walk(it.items, resolvedPage) : [],
      });
    }
    return res;
  };
  return walk(outline);
}

// Instant Table of Contents generation without saturating PDF worker
function generateSmartOutline(numPages, lang = "ar") {
  if (!numPages || numPages <= 0) return [];

  const isArabic = lang === "ar";
  const isUrdu = lang === "ur";
  const isTurkish = lang === "tr";
  const isFrench = lang === "fr";
  const isHindi = lang === "hi";

  if (numPages <= 5) {
    return Array.from({ length: numPages }, (_, i) => ({
      title: isArabic
        ? `الصفحة ${i + 1}`
        : isUrdu
        ? `صفحہ ${i + 1}`
        : isTurkish
        ? `Sayfa ${i + 1}`
        : isFrench
        ? `Page ${i + 1}`
        : isHindi
        ? `पृष्ठ ${i + 1}`
        : `Page ${i + 1}`,
      pageNumber: i + 1,
      items: [],
      isAuto: true,
    }));
  }

  if (numPages <= 25) {
    const p1 = 1;
    const p2 = Math.max(2, Math.round(numPages * 0.25));
    const p3 = Math.max(p2 + 1, Math.round(numPages * 0.5));
    const p4 = Math.max(p3 + 1, Math.round(numPages * 0.75));
    const p5 = numPages;

    const titles = isArabic
      ? [
          "المقدمة والتمهيد",
          "الفصل الأول: البداية والمدخل",
          "الفصل الثاني: المتن والموضوع",
          "الفصل الثالث: المسائل والفوائد",
          "الخاتمة والفهارس",
        ]
      : isUrdu
      ? [
          "مقدمہ اور تمہید",
          "باب اول: ابتدائیہ",
          "باب دوم: اصل متن",
          "باب سوم: تفاصیل و مسائل",
          "خاتمہ و اشاریہ",
        ]
      : isTurkish
      ? [
          "Giriş ve Takdim",
          "1. Bölüm: Başlangıç ve Esaslar",
          "2. Bölüm: Ana Metin",
          "3. Bölüm: Konular ve Tahliller",
          "Sonuç ve Fihrist",
        ]
      : isFrench
      ? [
          "Introduction et Préambule",
          "Chapitre 1 : Fondements",
          "Chapitre 2 : Corps du texte",
          "Chapitre 3 : Développements",
          "Conclusion et Index",
        ]
      : isHindi
      ? [
          "प्रस्तावना और परिचय",
          "अध्याय 1: प्रारंभ और आधार",
          "अध्याय 2: मुख्य विषय और पाठ",
          "अध्याय 3: विवरण और विश्लेषण",
          "निष्कर्ष और अनुक्रमणिका",
        ]
      : [
          "Introduction & Preface",
          "Chapter 1: Foundations",
          "Chapter 2: Main Subject",
          "Chapter 3: Further Analysis",
          "Conclusion & Index",
        ];

    return [
      { title: titles[0], pageNumber: p1, items: [], isAuto: true },
      { title: titles[1], pageNumber: p2, items: [], isAuto: true },
      { title: titles[2], pageNumber: p3, items: [], isAuto: true },
      { title: titles[3], pageNumber: p4, items: [], isAuto: true },
      { title: titles[4], pageNumber: p5, items: [], isAuto: true },
    ];
  }

  const p1 = 1;
  const p2 = Math.max(2, Math.round(numPages * 0.12));
  const p3 = Math.max(p2 + 1, Math.round(numPages * 0.3));
  const p4 = Math.max(p3 + 1, Math.round(numPages * 0.5));
  const p5 = Math.max(p4 + 1, Math.round(numPages * 0.7));
  const p6 = Math.max(p5 + 1, Math.round(numPages * 0.88));
  const p7 = numPages;

  const titles = isArabic
    ? [
        "المقدمة وتصدير الكتاب",
        "الباب الأول: الأصول والمبادئ",
        "الباب الثاني: المتن والمقاصد الكبرى",
        "الباب الثالث: التفريعات والمباحث",
        "الباب الرابع: المسائل والأحكام",
        "الباب الخامس: التعليقات والفوائد",
        "الخاتمة وفهرس الموضوعات",
      ]
    : isUrdu
    ? [
        "مقدمہ و پیش لفظ",
        "باب اول: اصول و قواعد",
        "باب دوم: اصل مقاصد و متون",
        "باب سوم: فروع اور مباحث",
        "باب چہارم: مسائل و احکام",
        "باب پنجم: فوائد و تعلیقات",
        "خاتمہ و موضوعی اشاریہ",
      ]
    : isTurkish
    ? [
        "Giriş ve Takdim",
        "1. Kısım: Usul ve İlkeler",
        "2. Kısım: Temel Metin ve Konular",
        "3. Kısım: İnceleme ve Tahliller",
        "4. Kısım: Meseleler ve Hükümler",
        "5. Kısım: Notlar ve Açıklamalar",
        "Sonuç ve Konu Fihristi",
      ]
    : isFrench
    ? [
        "Introduction et Présentation",
        "Partie 1 : Principes et Fondements",
        "Partie 2 : Textes et Grands Thèmes",
        "Partie 3 : Développements et Analyses",
        "Partie 4 : Règles et Préceptes",
        "Partie 5 : Commentaires et Notes",
        "Conclusion et Index des Sujets",
      ]
    : isHindi
    ? [
        "प्रस्तावना और पुस्तक परिचय",
        "भाग 1: सिद्धांत और आधार",
        "भाग 2: मुख्य पाठ और उद्देश्य",
        "भाग 3: विस्तृत चर्चा और शाखाएँ",
        "भाग 4: नियम और प्रावधान",
        "भाग 5: टिप्पणियाँ और लाभ",
        "निष्कर्ष और विषय-सूची",
      ]
    : [
        "Introduction & Presentation",
        "Part 1: Principles & Foundations",
        "Part 2: Core Subject & Texts",
        "Part 3: Detailed Inquiries",
        "Part 4: Rules & Applications",
        "Part 5: Notes & Commentary",
        "Conclusion & Table of Contents",
      ];

  return [
    { title: titles[0], pageNumber: p1, items: [], isAuto: true },
    { title: titles[1], pageNumber: p2, items: [], isAuto: true },
    { title: titles[2], pageNumber: p3, items: [], isAuto: true },
    { title: titles[3], pageNumber: p4, items: [], isAuto: true },
    { title: titles[4], pageNumber: p5, items: [], isAuto: true },
    { title: titles[5], pageNumber: p6, items: [], isAuto: true },
    { title: titles[6], pageNumber: p7, items: [], isAuto: true },
  ];
}