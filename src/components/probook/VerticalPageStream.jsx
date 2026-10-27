import { useState, useEffect, useRef, useCallback } from "react";
import { Bookmark } from "lucide-react";
import PdfPageRenderer from "./PdfPageRenderer";

const DEFAULT_RATIO = 0.707; // Standard A4 portrait aspect ratio (width / height)
const RENDER_BUFFER = 2; // Pre-render currentPage ± 2 for instant scrolling
const PREFETCH = 6; // Pre-measure aspect ratios within ±6 pages

const clampZoom = (z) => Math.max(0.5, Math.min(3, +Number(z).toFixed(2)));

export const READER_THEMES = {
  light: {
    id: "light",
    canvasBg: "bg-[#F4F1EA]",
    pageShadow: "shadow-[0_6px_28px_rgba(28,25,23,0.12)] ring-1 ring-stone-300/70",
    filter: "none",
    badgeBg: "bg-stone-900/75 text-stone-100",
  },
  sepia: {
    id: "sepia",
    canvasBg: "bg-[#EAE0CE]",
    pageShadow: "shadow-[0_8px_30px_rgba(68,51,28,0.16)] ring-1 ring-[#D5C7AD]",
    filter: "sepia(0.38) saturate(1.08) contrast(1.01) brightness(0.97)",
    badgeBg: "bg-[#3D2E1E]/85 text-[#F7EFE2]",
  },
  dusk: {
    id: "dusk",
    canvasBg: "bg-[#1C2026]",
    pageShadow: "shadow-[0_10px_34px_rgba(0,0,0,0.45)] ring-1 ring-slate-700/60",
    filter: "invert(0.86) hue-rotate(180deg) sepia(0.12) contrast(0.96)",
    badgeBg: "bg-slate-800/90 text-slate-200",
  },
  dark: {
    id: "dark",
    canvasBg: "bg-[#0D0F12]",
    pageShadow: "shadow-[0_10px_36px_rgba(0,0,0,0.65)] ring-1 ring-neutral-800",
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
}) {
  const scrollRef = useRef(null);
  const [aspect, setAspect] = useState({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const aspectCache = useRef({});
  const pendingAspect = useRef(new Set());
  const ratios = useRef({});
  const touchRef = useRef({ mode: "idle", startX: 0, startY: 0, dist: 0, baseZoom: 1 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [pinchZoom, setPinchZoom] = useState(null);

  const handleAspectRatio = useCallback((pageNum, ratio) => {
    if (!ratio || aspectCache.current[pageNum]) return;
    aspectCache.current[pageNum] = ratio;
    setAspect((prev) => (prev[pageNum] ? prev : { ...prev, [pageNum]: ratio }));
  }, []);

  // ── Pinch-to-zoom & horizontal swipe in single/spread mode ──
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
    // Horizontal page swipe when in single or spread mode at 1x zoom
    if (
      st.mode === "single" &&
      viewMode !== "scroll" &&
      zoomRef.current <= 1.05 &&
      e.changedTouches?.length === 1
    ) {
      const dx = e.changedTouches[0].clientX - st.startX;
      const dy = e.changedTouches[0].clientY - st.startY;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
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

  // ── Expose scrollToPage to parent ──
  useEffect(() => {
    scrollToPageRef.current = (n) => {
      if (viewMode !== "scroll") {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        }
        return;
      }
      const node = scrollRef.current?.querySelector(`[data-page="${n}"]`);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
  }, [scrollToPageRef, viewMode]);

  // ── Measure container width & height ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Track most-visible page in continuous scroll mode ──
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !totalPages || viewMode !== "scroll") return;
    ratios.current = {};
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          ratios.current[e.target.dataset.page] = e.intersectionRatio;
        }
        let best = null;
        let bestRatio = 0;
        for (const [pg, r] of Object.entries(ratios.current)) {
          if (r > bestRatio) {
            bestRatio = r;
            best = Number(pg);
          }
        }
        if (best != null && bestRatio > 0.25) onCurrentPageChange(best);
      },
      { root, threshold: [0.25, 0.5, 0.75] }
    );
    const nodes = root.querySelectorAll("[data-page]");
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [totalPages, onCurrentPageChange, viewMode]);

  // ── Pre-measure aspect ratios near currentPage ──
  useEffect(() => {
    if (!pdf || !totalPages) return;
    const lo = Math.max(1, currentPage - PREFETCH);
    const hi = Math.min(totalPages, currentPage + PREFETCH);
    for (let i = lo; i <= hi; i++) {
      if (aspectCache.current[i] || pendingAspect.current.has(i)) continue;
      pendingAspect.current.add(i);
      pdf
        .getPage(i)
        .then((page) => {
          const vp = page.getViewport({ scale: 1 });
          const r = vp.width / vp.height;
          aspectCache.current[i] = r;
          setAspect((a) => ({ ...a, [i]: r }));
        })
        .catch(() => {})
        .finally(() => pendingAspect.current.delete(i));
    }
  }, [pdf, currentPage, totalPages]);

  const themeConfig = READER_THEMES[theme] || READER_THEMES.light;
  const brightnessFilter =
    brightness !== 100 ? `brightness(${Number(brightness) / 100})` : "";
  const combinedFilter =
    [themeConfig.filter !== "none" ? themeConfig.filter : "", brightnessFilter]
      .filter(Boolean)
      .join(" ") || "none";

  // Calculate base page width depending on container, viewMode, and fitMode
  const getPageDimensions = (pageNumber, activeZoom) => {
    const r = aspect[pageNumber] || aspectCache.current[pageNumber] || DEFAULT_RATIO;
    const availW = Math.max(280, containerSize.width - (containerSize.width > 640 ? 48 : 16));
    const availH = Math.max(360, containerSize.height - 28);

    let baseW;
    if (viewMode === "spread" && containerSize.width >= 768) {
      const halfW = (availW - 16) / 2;
      const fitPageW = availH * r;
      baseW = Math.min(halfW, fitPageW);
    } else if (fitMode === "page" || viewMode === "single") {
      const fitPageW = availH * r;
      baseW = Math.min(availW, fitPageW, 860);
    } else {
      // Fit comfortable reading width (up to 840px on desktop, full width on mobile)
      baseW = Math.min(availW, 840);
    }

    const finalW = Math.round(baseW * activeZoom);
    const finalH = Math.round(finalW / r);
    return { width: finalW, height: finalH, ratio: r };
  };

  const effZoom = pinchZoom ?? zoom;

  // ── Mode 1: Single Page or Two-Page Spread ──
  if (viewMode === "single" || viewMode === "spread") {
    const isSpread = viewMode === "spread" && containerSize.width >= 768 && totalPages > 1;
    // In spread mode, pair pages (1-2, 3-4, etc.)
    const primaryPage = isSpread
      ? currentPage % 2 === 0
        ? currentPage - 1
        : currentPage
      : currentPage;
    const secondaryPage =
      isSpread && primaryPage + 1 <= totalPages ? primaryPage + 1 : null;
    const pagesToShow = secondaryPage ? [primaryPage, secondaryPage] : [primaryPage];

    return (
      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto overscroll-contain transition-colors duration-300 ${themeConfig.canvasBg}`}
        style={{ touchAction: "pan-x pan-y" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          dir={isRTL ? "rtl" : "ltr"}
          className="min-h-full min-w-full flex items-center justify-center p-3 sm:p-5 gap-3"
        >
          {pagesToShow.map((p) => {
            const effDim = getPageDimensions(p, effZoom);
            const comDim = getPageDimensions(p, zoom);
            const isBookmarked = bookmarks.includes(p);

            return (
              <div
                key={p}
                data-page={p}
                className={`relative bg-white rounded-sm shrink-0 overflow-hidden transition-shadow ${themeConfig.pageShadow}`}
                style={{
                  width: effDim.width,
                  height: effDim.height,
                  filter: combinedFilter,
                }}
              >
                {isBookmarked && (
                  <div className="absolute top-0 left-4 z-20 text-amber-500 drop-shadow">
                    <Bookmark className="w-6 h-6 fill-amber-500" />
                  </div>
                )}
                <div
                  style={{
                    width: comDim.width,
                    height: comDim.height,
                    transform: `scale(${effZoom / zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  {pdf && (
                    <PdfPageRenderer
                      pdf={pdf}
                      pageNumber={p}
                      zoom={zoom}
                      targetWidth={comDim.width}
                      targetHeight={comDim.height}
                      onAspectRatio={handleAspectRatio}
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
        </div>
      </div>
    );
  }

  // ── Mode 2: Continuous Vertical Scroll Stream ──
  return (
    <div
      ref={scrollRef}
      className={`flex-1 overflow-auto overscroll-contain transition-colors duration-300 ${themeConfig.canvasBg}`}
      style={{ touchAction: "pan-x pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div dir="ltr" className="flex flex-col items-center gap-4 py-4 px-2 sm:px-6">
        {Array.from({ length: totalPages }, (_, idx) => {
          const p = idx + 1;
          const effDim = getPageDimensions(p, effZoom);
          const comDim = getPageDimensions(p, zoom);
          const shouldRender = Math.abs(p - currentPage) <= RENDER_BUFFER;
          const isBookmarked = bookmarks.includes(p);

          return (
            <div
              key={p}
              data-page={p}
              className={`relative bg-white rounded-sm shrink-0 mx-auto overflow-hidden ${themeConfig.pageShadow}`}
              style={{
                width: effDim.width,
                height: effDim.height,
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
                  width: comDim.width,
                  height: comDim.height,
                  transform: `scale(${effZoom / zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {shouldRender && pdf ? (
                  <PdfPageRenderer
                    pdf={pdf}
                    pageNumber={p}
                    zoom={zoom}
                    targetWidth={comDim.width}
                    targetHeight={comDim.height}
                    onAspectRatio={handleAspectRatio}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-stone-50 text-xs font-mono tabular-nums text-stone-400 select-none">
                    <span>{p}</span>
                  </div>
                )}
              </div>
              <div
                className={`absolute bottom-2 left-3 px-2 py-0.5 rounded text-[10px] font-mono tabular-nums opacity-70 pointer-events-none ${themeConfig.badgeBg}`}
              >
                {p}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}