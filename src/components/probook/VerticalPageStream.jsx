import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Bookmark, ChevronLeft, ChevronRight } from "lucide-react";
import PdfPageRenderer from "./PdfPageRenderer";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/lib/i18n";

const DEFAULT_RATIO = 0.707; // Standard portrait aspect ratio (width / height)
const RENDER_BUFFER = 2; // Pre-render currentPage ± 2 pages
const GAP = 16; // 1rem gap between pages

const clampZoom = (z) => Math.max(0.5, Math.min(3, +Number(z).toFixed(2)));

export const READER_THEMES = {
  light: {
    id: "light",
    canvasBg: "bg-[#F5F2EB]",
    pageBg: "bg-white",
    pageShadow: "shadow-[0_4px_24px_rgba(28,25,23,0.12)] ring-1 ring-stone-300/80",
    badgeBg: "bg-stone-900/80 text-stone-100",
  },
  sepia: {
    id: "sepia",
    canvasBg: "bg-[#EFE5D3]",
    pageBg: "bg-[#EFE5D3]",
    pageShadow: "shadow-[0_6px_26px_rgba(68,51,28,0.15)] ring-1 ring-[#D8CAAE]",
    badgeBg: "bg-[#3D2E1E]/85 text-[#F7EFE2]",
  },
  dusk: {
    id: "dusk",
    canvasBg: "bg-[#181C22]",
    pageBg: "bg-[#181C22]",
    pageShadow: "shadow-[0_8px_32px_rgba(0,0,0,0.55)] ring-1 ring-slate-700/60",
    badgeBg: "bg-slate-800/90 text-slate-200",
  },
  dark: {
    id: "dark",
    canvasBg: "bg-[#0B0D11]",
    pageBg: "bg-[#121418]",
    pageShadow: "shadow-[0_8px_35px_rgba(0,0,0,0.75)] ring-1 ring-neutral-800",
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
  const t = useT();
  const scrollRef = useRef(null);
  const [baseRatio, setBaseRatio] = useState(DEFAULT_RATIO);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const touchRef = useRef({
    mode: "idle",
    hadMultiTouch: false,
    startX: 0,
    startY: 0,
    dist: 0,
    baseZoom: 1,
    startEffZoom: 1,
    midX: 0,
    midY: 0,
    startContentX: 0,
    startContentY: 0,
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [pinchZoom, setPinchZoom] = useState(null);
  const pinchZoomRef = useRef(null);
  pinchZoomRef.current = pinchZoom;

  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const rafScrollRef = useRef(null);
  const lastReportedPageRef = useRef(currentPage);
  lastReportedPageRef.current = currentPage;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

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
  }, [viewMode]);

  const effZoom = pinchZoom ?? zoom;
  const effZoomRef = useRef(effZoom);
  effZoomRef.current = effZoom;
  const isZoomed = effZoom > 1.05;

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

  const lastMultiTouchTimeRef = useRef(0);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const isRTLRef = useRef(isRTL);
  isRTLRef.current = isRTL;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const onNextPageRef = useRef(onNextPage);
  onNextPageRef.current = onNextPage;
  const onPrevPageRef = useRef(onPrevPage);
  onPrevPageRef.current = onPrevPage;

  // Keep viewport anchored around the two-finger pinch midpoint while scaling
  useEffect(() => {
    const st = touchRef.current;
    const el = scrollRef.current;
    if (st.mode === "pinch" && el && st.startEffZoom > 0) {
      const ratio = effZoom / st.startEffZoom;
      el.scrollLeft = Math.max(0, st.startContentX * ratio - st.midX);
      el.scrollTop = Math.max(0, st.startContentY * ratio - st.midY);
    }
  }, [effZoom]);

  // Preserve reading position cleanly when zoom changes via toolbar +/- buttons, wheel, or double-tap
  const prevZoomRef = useRef(zoom);
  useEffect(() => {
    const prevZ = prevZoomRef.current;
    if (prevZ !== zoom) {
      prevZoomRef.current = zoom;
      const el = scrollRef.current;
      // If ending a pinch, anchor was already maintained frame-by-frame
      if (el && prevZ > 0 && touchRef.current.mode !== "pinch") {
        const wasPinchCommit = Date.now() - lastMultiTouchTimeRef.current < 150;
        if (!wasPinchCommit) {
          const ratio = zoom / prevZ;
          const cx = el.scrollLeft + el.clientWidth / 2;
          const cy = el.scrollTop + el.clientHeight / 2;
          isProgrammaticScrollRef.current = true;
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            scrollRef.current.scrollLeft = Math.max(0, cx * ratio - scrollRef.current.clientWidth / 2);
            scrollRef.current.scrollTop = Math.max(0, cy * ratio - scrollRef.current.clientHeight / 2);
          });
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 350);
        }
      }
    }
  }, [zoom]);

  // ── Native non-passive touch listeners so pinch NEVER triggers browser scroll/page-flip ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const finishPinch = () => {
      const finalZoom = pinchZoomRef.current;
      if (finalZoom != null) {
        onZoomChangeRef.current?.(finalZoom);
      }
      pinchZoomRef.current = null;
      setPinchZoom(null);
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 450);
    };

    const handleTouchStart = (e) => {
      const st = touchRef.current;
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        lastMultiTouchTimeRef.current = Date.now();
        st.hadMultiTouch = true;
        st.mode = "pinch";
        isProgrammaticScrollRef.current = true;

        const [a, b] = e.touches;
        st.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        st.baseZoom = effZoomRef.current;
        st.startEffZoom = effZoomRef.current;

        const rect = el.getBoundingClientRect();
        st.midX = (a.clientX + b.clientX) / 2 - rect.left;
        st.midY = (a.clientY + b.clientY) / 2 - rect.top;
        st.startContentX = el.scrollLeft + st.midX;
        st.startContentY = el.scrollTop + st.midY;
      } else if (e.touches.length === 1) {
        st.mode = "single";
        st.hadMultiTouch = false;
        st.startX = e.touches[0].clientX;
        st.startY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e) => {
      const st = touchRef.current;
      if (st.mode === "pinch" || e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        if (e.touches.length < 2) return;
        lastMultiTouchTimeRef.current = Date.now();
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (st.dist > 10) {
          const nextZ = clampZoom(st.baseZoom * (d / st.dist));
          pinchZoomRef.current = nextZ;
          setPinchZoom(nextZ);
        }
      }
    };

    const handleTouchEnd = (e) => {
      const st = touchRef.current;
      if (st.mode === "pinch") {
        if (e.touches.length === 0) {
          st.mode = "idle";
          finishPinch();
        } else if (e.touches.length === 1) {
          // One finger still down after releasing pinch — commit zoom and lock swipe
          lastMultiTouchTimeRef.current = Date.now();
          st.mode = "idle";
          finishPinch();
        }
        return;
      }

      // Horizontal swipe in single/spread mode (strictly ONLY when unzoomed and not post-pinch)
      const recentlyPinched = Date.now() - lastMultiTouchTimeRef.current < 500;
      if (
        st.mode === "single" &&
        !st.hadMultiTouch &&
        viewModeRef.current !== "scroll" &&
        effZoomRef.current <= 1.05 &&
        !recentlyPinched &&
        e.changedTouches?.length === 1 &&
        e.touches.length === 0
      ) {
        const dx = e.changedTouches[0].clientX - st.startX;
        const dy = e.changedTouches[0].clientY - st.startY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          if (isRTLRef.current) {
            if (dx > 0) onNextPageRef.current?.();
            else onPrevPageRef.current?.();
          } else {
            if (dx < 0) onNextPageRef.current?.();
            else onPrevPageRef.current?.();
          }
        }
      }
      if (e.touches.length === 0) {
        st.mode = "idle";
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: false });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [viewMode]);

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
    // During programmatic scroll, active pinch, or right after pinching, do NOT change page
    const recentlyPinched = Date.now() - lastMultiTouchTimeRef.current < 500;
    if (
      isProgrammaticScrollRef.current ||
      viewMode !== "scroll" ||
      !totalPages ||
      pinchZoom !== null ||
      touchRef.current.mode === "pinch" ||
      recentlyPinched
    ) return;
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
  }, [viewMode, totalPages, totalItemHeight, onCurrentPageChange, pinchZoom]);

  const themeConfig = READER_THEMES[theme] || READER_THEMES.light;
  const brightnessFilter = brightness !== 100 ? `brightness(${Number(brightness) / 100})` : "none";

  // ── Mode 1: Single Page or Two-Page Spread ──
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
      if (Date.now() - lastMultiTouchTimeRef.current < 500) return;
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
        className={`flex-1 transition-colors duration-200 select-none relative ${themeConfig.canvasBg} ${
          isZoomed ? "overflow-auto overscroll-contain flex p-3 sm:p-4" : "overflow-hidden flex flex-col items-center justify-center"
        }`}
        style={{ touchAction: isZoomed ? "pan-x pan-y" : "manipulation", filter: brightnessFilter }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Animated Page Container (m-auto safely centers when small without clipping top/left when zoomed) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${primaryPage}_${isSpread}`}
            initial={{ opacity: 0.85, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.85, scale: 0.99 }}
            transition={{ duration: 0.15 }}
            dir={isRTL ? "rtl" : "ltr"}
            className="flex items-center justify-center p-2 sm:p-4 gap-3 relative z-[2] m-auto shrink-0"
          >
            {pagesToShow.map((p) => {
              const isBookmarked = bookmarks.includes(p);
              return (
                <div
                  key={p}
                  data-page={p}
                  className={`relative rounded-sm shrink-0 overflow-hidden transition-shadow ${themeConfig.pageBg} ${themeConfig.pageShadow}`}
                  style={{
                    width: pageWidth,
                    height: pageHeight,
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
                        theme={theme}
                        targetWidth={committedDim.width}
                        targetHeight={committedDim.height}
                      />
                    )}
                  </div>
                  <div
                    className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded text-[11px] font-mono tabular-nums pointer-events-none z-10 ${themeConfig.badgeBg}`}
                  >
                    {p} / {totalPages}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        {/* Tap Zones for turning pages (Only active when NOT zoomed in) */}
        {!isZoomed && (
          <div className="absolute inset-0 z-[5] grid grid-cols-5 pointer-events-auto">
            {/* Left Zone (20%) */}
            <div
              onClick={(e) => { e.stopPropagation(); handleZoneClick("prev"); }}
              className="cursor-pointer group flex items-center justify-start ps-3"
              title={isRTL ? (t.nextPage || "الصفحة التالية") : (t.prevPage || "الصفحة السابقة")}
            >
              <div className="w-10 h-10 rounded-full bg-black/35 hover:bg-black/60 text-white items-center justify-center hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shadow-lg backdrop-blur">
                <ChevronLeft className="w-5 h-5" />
              </div>
            </div>

            {/* Center Zone (60%) */}
            <div
              onClick={(e) => { e.stopPropagation(); handleZoneClick("center"); }}
              className="col-span-3 cursor-pointer"
            />

            {/* Right Zone (20%) */}
            <div
              onClick={(e) => { e.stopPropagation(); handleZoneClick("next"); }}
              className="cursor-pointer group flex items-center justify-end pe-3"
              title={isRTL ? (t.prevPage || "الصفحة السابقة") : (t.nextPage || "الصفحة التالية")}
            >
              <div className="w-10 h-10 rounded-full bg-black/35 hover:bg-black/60 text-white items-center justify-center hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shadow-lg backdrop-blur">
                <ChevronRight className="w-5 h-5" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Mode 2: Continuous Vertical Scroll Stream ──
  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-auto overscroll-contain transition-colors duration-200 select-none ${themeConfig.canvasBg}`}
      style={{ touchAction: "pan-x pan-y", filter: brightnessFilter }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div dir="ltr" className="flex flex-col items-center py-4 px-2 sm:px-6 min-w-max mx-auto">
        {Array.from({ length: totalPages }, (_, idx) => {
          const p = idx + 1;
          const shouldRender = Math.abs(p - currentPage) <= RENDER_BUFFER;
          const isBookmarked = bookmarks.includes(p);

          return (
            <div
              key={p}
              data-page={p}
              className={`relative rounded-sm shrink-0 mx-auto overflow-hidden my-2 ${themeConfig.pageBg} ${themeConfig.pageShadow}`}
              style={{
                width: pageWidth,
                height: pageHeight,
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
                      theme={theme}
                      targetWidth={committedDim.width}
                      targetHeight={committedDim.height}
                    />
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 opacity-40 font-mono text-xs select-none">
                  <span className="text-sm font-bold">{p}</span>
                  <span className="text-[10px]">/ {totalPages}</span>
                </div>
              )}

              <div
                className={`absolute bottom-2 left-3 px-2 py-0.5 rounded text-[10px] font-mono tabular-nums opacity-85 pointer-events-none z-10 ${themeConfig.badgeBg}`}
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