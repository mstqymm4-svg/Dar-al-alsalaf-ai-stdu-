import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Bookmark, ChevronLeft, ChevronRight, FileText, ScrollText } from "lucide-react";
import PdfPageRenderer from "./PdfPageRenderer";
import { motion, AnimatePresence } from "framer-motion";

const DEFAULT_RATIO = 0.707; // Standard portrait aspect ratio (width / height)
const RENDER_BUFFER = 2; // Pre-render currentPage ± 2 pages (5 pages max active)
const GAP = 16; // 1rem gap between pages

const clampZoom = (z) => Math.max(0.5, Math.min(3, +Number(z).toFixed(2)));

export const READER_THEMES = {
  light: {
    id: "light",
    canvasBg: "bg-[#F5F2EB]",
    pageShadow: "shadow-[0_4px_24px_rgba(28,25,23,0.12)] ring-1 ring-stone-300/80",
    filter: "none",
    badgeBg: "bg-stone-900/80 text-stone-100",
  },
  sepia: {
    id: "sepia",
    canvasBg: "bg-[#EFE5D3]",
    pageShadow: "shadow-[0_6px_26px_rgba(68,51,28,0.15)] ring-1 ring-[#D8CAAE]",
    filter: "sepia(0.35) saturate(1.05) contrast(1.01) brightness(0.98)",
    badgeBg: "bg-[#3D2E1E]/85 text-[#F7EFE2]",
  },
  dusk: {
    id: "dusk",
    canvasBg: "bg-[#181C22]",
    pageShadow: "shadow-[0_8px_32px_rgba(0,0,0,0.55)] ring-1 ring-slate-700/60",
    filter: "invert(0.86) hue-rotate(180deg) sepia(0.12) contrast(0.96)",
    badgeBg: "bg-slate-800/90 text-slate-200",
  },
  dark: {
    id: "dark",
    canvasBg: "bg-[#0B0D11]",
    pageShadow: "shadow-[0_8px_35px_rgba(0,0,0,0.75)] ring-1 ring-neutral-800",
    filter: "invert(0.92) hue-rotate(180deg) contrast(1.02)",
    badgeBg: "bg-neutral-800/90 text-neutral-200",
  },
};

export default function VerticalPageStream({
  pdf,
  totalPages,
  currentPage,
  zoom,
  onZoomChange,
  theme = "light",
  viewMode = "scroll", // "scroll" | "single" | "spread"
  fitMode = "width", // "width" | "page"
  brightness = 100,
  isRTL = true,
  bookmarks = [],
  onCurrentPageChange,
  onNextPage,
  onPrevPage,
  scrollToPageRef,
  onToggleToolbar,
}) {
  const scrollRef = useRef(null);
  const [baseRatio, setBaseRatio] = useState(DEFAULT_RATIO);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const touchRef = useRef({ mode: "idle", startX: 0, startY: 0, dist: 0, baseZoom: 1 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [pinchZoom, setPinchZoom] = useState(null);

  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const rafScrollRef = useRef(null);
  const lastReportedPageRef = useRef(currentPage);
  lastReportedPageRef.current = currentPage;

  // ── Sample base aspect ratio once from Page 1 ──
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    pdf.getPage(1)
      .then((page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        const r = vp.width / vp.height;
        if (r > 0.3 && r < 2.5) {
          setBaseRatio(r);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pdf]);

  // ── Measure container dimensions with ResizeObserver ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Touch gestures: Pinch-to-zoom & horizontal swipe ──
  const onTouchStart = (e) => {
    const st = touchRef.current;
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      st.mode = "pinch";
      st.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      st.baseZoom = zoomRef.current;
    } else if (e.touches.length === 1) {
      st.mode = "single";
      st.startX = e.touches[0].clientX;
      st.startY = e.touches[0].clientY;
    }
  };

  const onTouchMove = (e) => {
    const st = touchRef.current;
    if (st.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (st.dist > 0) {
        setPinchZoom(clampZoom(st.baseZoom * (d / st.dist)));
      }
    }
  };

  const finishPinch = () => {
    if (pinchZoom != null) onZoomChange?.(pinchZoom);
    setPinchZoom(null);
  };

  const onTouchEnd = (e) => {
    const st = touchRef.current;
    if (st.mode === "pinch") {
      st.mode = "idle";
      finishPinch();
      return;
    }
    // Horizontal swipe in single/spread mode
    if (
      st.mode === "single" &&
      viewMode !== "scroll" &&
      zoomRef.current <= 1.05 &&
      e.changedTouches?.length === 1
    ) {
      const dx = e.changedTouches[0].clientX - st.startX;
      const dy = e.changedTouches[0].clientY - st.startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (isRTL) {
          if (dx > 0) onNextPage?.();
          else onPrevPage?.();
        } else {
          if (dx < 0) onNextPage?.();
          else onPrevPage?.();
        }
      }
    }
    st.mode = "idle";
  };

  const effZoom = pinchZoom ?? zoom;

  // ── Calculate dimensions efficiently ──
  const { pageWidth, pageHeight } = useMemo(() => {
    const r = baseRatio || DEFAULT_RATIO;
    const availW = Math.max(280, containerSize.width - (containerSize.width > 640 ? 48 : 16));
    const availH = Math.max(360, containerSize.height - 28);

    let baseW;
    if (viewMode === "spread" && containerSize.width >= 768) {
      const halfW = (availW - 16) / 2;
      const fitPageW = availH * r;
      baseW = Math.min(halfW, fitPageW);
    } else if (fitMode === "page" || viewMode === "single") {
      const fitPageW = availH * r;
      baseW = Math.min(availW, fitPageW, 880);
    } else {
      baseW = Math.min(availW, 860);
    }

    const finalW = Math.round(baseW * effZoom);
    const finalH = Math.round(finalW / r);
    return { pageWidth: finalW, pageHeight: finalH };
  }, [baseRatio, containerSize, viewMode, fitMode, effZoom]);

  const committedDim = useMemo(() => {
    const r = baseRatio || DEFAULT_RATIO;
    const availW = Math.max(280, containerSize.width - (containerSize.width > 640 ? 48 : 16));
    const availH = Math.max(360, containerSize.height - 28);

    let baseW;
    if (viewMode === "spread" && containerSize.width >= 768) {
      const halfW = (availW - 16) / 2;
      const fitPageW = availH * r;
      baseW = Math.min(halfW, fitPageW);
    } else if (fitMode === "page" || viewMode === "single") {
      const fitPageW = availH * r;
      baseW = Math.min(availW, fitPageW, 880);
    } else {
      baseW = Math.min(availW, 860);
    }

    const finalW = Math.round(baseW * zoom);
    const finalH = Math.round(finalW / r);
    return { width: finalW, height: finalH };
  }, [baseRatio, containerSize, viewMode, fitMode, zoom]);

  const totalItemHeight = pageHeight + GAP;

  // ── Expose scrollToPage to parent ──
  useEffect(() => {
    scrollToPageRef.current = (n) => {
      if (!scrollRef.current) return;
      if (viewMode !== "scroll") {
        scrollRef.current.scrollTop = 0;
        return;
      }
      isProgrammaticScrollRef.current = true;
      const targetY = (Math.max(1, Math.min(totalPages, n)) - 1) * totalItemHeight;
      scrollRef.current.scrollTo({ top: targetY, behavior: "smooth" });
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    };
  }, [scrollToPageRef, viewMode, totalPages, totalItemHeight]);

  // ── Continuous scroll tracking with RAF ──
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current || viewMode !== "scroll" || !totalPages) return;
    if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);

    rafScrollRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.scrollTop;
      const pageIndex = Math.floor((top + el.clientHeight * 0.35) / totalItemHeight);
      const calculatedPage = Math.max(1, Math.min(totalPages, pageIndex + 1));

      if (calculatedPage !== lastReportedPageRef.current) {
        lastReportedPageRef.current = calculatedPage;
        onCurrentPageChange(calculatedPage);
      }
    });
  }, [viewMode, totalPages, totalItemHeight, onCurrentPageChange]);

  const themeConfig = READER_THEMES[theme] || READER_THEMES.light;
  const brightnessFilter = brightness !== 100 ? `brightness(${Number(brightness) / 100})` : "";
  const combinedFilter =
    [themeConfig.filter !== "none" ? themeConfig.filter : "", brightnessFilter]
      .filter(Boolean)
      .join(" ") || "none";

  // ── Mode 1: Single Page or Two-Page Spread (Kindle/iBooks style with tap zones) ──
  if (viewMode === "single" || viewMode === "spread") {
    const isSpread = viewMode === "spread" && containerSize.width >= 768 && totalPages > 1;
    const primaryPage = isSpread
      ? currentPage % 2 === 0
        ? currentPage - 1
        : currentPage
      : currentPage;
    const secondaryPage =
      isSpread && primaryPage + 1 <= totalPages ? primaryPage + 1 : null;
    const pagesToShow = secondaryPage ? [primaryPage, secondaryPage] : [primaryPage];

    const handleZoneClick = (zone) => {
      if (zone === "next") {
        isRTL ? onPrevPage?.() : onNextPage?.();
      } else if (zone === "prev") {
        isRTL ? onNextPage?.() : onPrevPage?.();
      } else {
        onToggleToolbar?.();
      }
    };

    return (
      <div
        ref={scrollRef}
        className={`flex-1 overflow-hidden transition-colors duration-200 select-none relative flex flex-col items-center justify-center ${themeConfig.canvasBg}`}
        style={{ touchAction: "pan-x pan-y" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Animated Page Container */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${primaryPage}_${isSpread}`}
            initial={{ opacity: 0.85, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.85, scale: 0.99 }}
            transition={{ duration: 0.15 }}
            dir={isRTL ? "rtl" : "ltr"}
            className="flex items-center justify-center p-2 sm:p-4 gap-3 relative z-[2]"
          >
            {pagesToShow.map((p) => {
              const isBookmarked = bookmarks.includes(p);
              return (
                <div
                  key={p}
                  data-page={p}
                  className={`relative bg-white rounded-sm shrink-0 overflow-hidden transition-shadow ${themeConfig.pageShadow}`}
                  style={{
                    width: pageWidth,
                    height: pageHeight,
                    filter: combinedFilter,
                  }}
                >
                  {isBookmarked && (
                    <div className="absolute top-0 left-4 z-20 text-amber-500 drop-shadow pointer-events-none">
                      <Bookmark className="w-6 h-6 fill-amber-500" />
                    </div>
                  )}
                  <div
                    style={{
                      width: committedDim.width,
                      height: committedDim.height,
                      transform: `scale(${effZoom / zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    {pdf && (
                      <PdfPageRenderer
                        pdf={pdf}
                        pageNumber={p}
                        zoom={zoom}
                        targetWidth={committedDim.width}
                        targetHeight={committedDim.height}
                      />
                    )}
                  </div>
                  <div
                    className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded text-[11px] font-mono tabular-nums pointer-events-none ${themeConfig.badgeBg}`}
                  >
                    {p} / {totalPages}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        {/* Kindle/iBooks-style Tap Zones (Invisible overlay on top of page for thumb-turning) */}
        <div className="absolute inset-0 z-[5] grid grid-cols-5 pointer-events-auto">
          {/* Left Zone (20%): Prev or Next depending on RTL */}
          <div
            onClick={(e) => { e.stopPropagation(); handleZoneClick("prev"); }}
            className="cursor-pointer group flex items-center justify-start ps-3"
            title={isRTL ? "الصفحة التالية" : "الصفحة السابقة"}
          >
            <div className="w-10 h-10 rounded-full bg-black/35 hover:bg-black/60 text-white items-center justify-center hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shadow-lg backdrop-blur">
              <ChevronLeft className="w-5 h-5" />
            </div>
          </div>

          {/* Center Zone (60%): Toggle toolbar and controls */}
          <div
            onClick={(e) => { e.stopPropagation(); handleZoneClick("center"); }}
            className="col-span-3 cursor-pointer"
          />

          {/* Right Zone (20%): Next or Prev depending on RTL */}
          <div
            onClick={(e) => { e.stopPropagation(); handleZoneClick("next"); }}
            className="cursor-pointer group flex items-center justify-end pe-3"
            title={isRTL ? "الصفحة السابقة" : "الصفحة التالية"}
          >
            <div className="w-10 h-10 rounded-full bg-black/35 hover:bg-black/60 text-white items-center justify-center hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shadow-lg backdrop-blur">
              <ChevronRight className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode 2: Continuous Vertical Scroll Stream (Virtualized with stable placeholders) ──
  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-auto overscroll-contain transition-colors duration-200 select-none ${themeConfig.canvasBg}`}
      style={{ touchAction: "pan-x pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div dir="ltr" className="flex flex-col items-center py-4 px-2 sm:px-6">
        {Array.from({ length: totalPages }, (_, idx) => {
          const p = idx + 1;
          const shouldRender = Math.abs(p - currentPage) <= RENDER_BUFFER;
          const isBookmarked = bookmarks.includes(p);

          return (
            <div
              key={p}
              data-page={p}
              className={`relative bg-white rounded-sm shrink-0 mx-auto overflow-hidden my-2 ${themeConfig.pageShadow}`}
              style={{
                width: pageWidth,
                height: pageHeight,
                filter: shouldRender ? combinedFilter : "none",
              }}
            >
              {isBookmarked && (
                <div className="absolute top-0 left-4 z-20 text-amber-500 drop-shadow pointer-events-none">
                  <Bookmark className="w-6 h-6 fill-amber-500" />
                </div>
              )}

              {shouldRender ? (
                <div
                  style={{
                    width: committedDim.width,
                    height: committedDim.height,
                    transform: `scale(${effZoom / zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  {pdf && (
                    <PdfPageRenderer
                      pdf={pdf}
                      pageNumber={p}
                      zoom={zoom}
                      targetWidth={committedDim.width}
                      targetHeight={committedDim.height}
                    />
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-stone-100/60 text-stone-400 font-mono text-xs select-none">
                  <span className="text-sm font-bold opacity-60">{p}</span>
                  <span className="text-[10px] opacity-40">/ {totalPages}</span>
                </div>
              )}

              <div
                className={`absolute bottom-2 left-3 px-2 py-0.5 rounded text-[10px] font-mono tabular-nums opacity-75 pointer-events-none ${themeConfig.badgeBg}`}
              >
                {p} / {totalPages}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}