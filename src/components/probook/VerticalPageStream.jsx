import React, { useEffect, useRef, useState } from "react";
import PdfPageRenderer from "./PdfPageRenderer";
import PageAnnotationLayer from "./PageAnnotationLayer";
import SmartWordHighlightLayer from "./SmartWordHighlightLayer";

/**
 * Virtualized Vertical PDF Stream
 * Renders all pages in a vertical column using IntersectionObserver so only visible
 * pages (+1 buffer above/below) render heavy canvases, and tracks currentPage on scroll.
 * Also overlays SmartWordHighlightLayer on the currently active audio page!
 */
export default function VerticalPageStream({
  pdfDoc,
  totalPages,
  currentPage,
  onVisiblePageChange,
  zoom = 1,
  fitMode = "width",
  theme = "light",
  themeCfg,
  isAnnotationActive = false,
  annotationTool,
  annotationColor,
  annotationStrokeWidth,
  annotationRevision = 0,
  onAnnotationChange,
  bookId,
  scrollTriggerPage,
  // Intelligent Reader Word/Sentence Highlight props
  activePageData = null,
  pageDataMap = {},
  activeSentenceIndex = 0,
  activeWordIndex = 0,
  isAudioActive = false,
  wordHighlightEnabled = true,
  sentenceHighlightEnabled = true,
  highlightColorId = "cyan",
  onSelectSentenceOrWord,
}) {
  const containerRef = useRef(null);
  const pageRefs = useRef({});
  const [visibleSet, setVisibleSet] = useState(
    () => new Set([1, 2, currentPage])
  );
  const isProgrammaticScroll = useRef(false);

  // Scroll to target page when triggered by toolbar/TOC/search/prev/next
  useEffect(() => {
    const targetPage =
      typeof scrollTriggerPage === "object"
        ? Number(scrollTriggerPage?.page || 0)
        : Number(scrollTriggerPage || 0);
    if (!targetPage || !pageRefs.current[targetPage]) return;
    const targetEl = pageRefs.current[targetPage];
    if (targetEl && containerRef.current) {
      isProgrammaticScroll.current = true;
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setVisibleSet((prev) => {
        const next = new Set(prev);
        next.add(targetPage);
        if (targetPage > 1) next.add(targetPage - 1);
        if (targetPage < totalPages) next.add(targetPage + 1);
        return next;
      });
      setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 450);
    }
  }, [scrollTriggerPage, totalPages]);

  // IntersectionObserver + scroll tracking to lazy-load canvases & update current page number
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !totalPages) return;

    const ratios = new Map();

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        setVisibleSet((prev) => {
          const next = new Set(prev);
          entries.forEach((entry) => {
            const p = Number(entry.target.getAttribute("data-page-num"));
            if (!p) return;
            ratios.set(p, entry.isIntersecting ? entry.intersectionRatio : 0);
            if (entry.isIntersecting) {
              if (!next.has(p)) {
                next.add(p);
                changed = true;
              }
              if (p > 1 && !next.has(p - 1)) {
                next.add(p - 1);
                changed = true;
              }
              if (p < totalPages && !next.has(p + 1)) {
                next.add(p + 1);
                changed = true;
              }
            }
          });
          return changed ? next : prev;
        });

        if (!isProgrammaticScroll.current) {
          let bestPage = null;
          let bestRatio = 0;
          ratios.forEach((ratio, p) => {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestPage = p;
            }
          });
          if (bestPage && bestRatio > 0.15) {
            onVisiblePageChange?.(bestPage);
          }
        }
      },
      {
        root,
        rootMargin: "450px 0px",
        threshold: [0.05, 0.2, 0.4, 0.6, 0.8],
      }
    );

    Object.values(pageRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    const handleScroll = () => {
      if (isProgrammaticScroll.current || !root) return;
      const rootRect = root.getBoundingClientRect();
      const targetY = rootRect.top + rootRect.height * 0.38;
      let closestPage = null;
      let minDist = Infinity;

      for (let p = 1; p <= totalPages; p++) {
        const el = pageRefs.current[p];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= targetY && rect.bottom >= targetY) {
          closestPage = p;
          break;
        }
        const centerDist = Math.abs((rect.top + rect.bottom) / 2 - targetY);
        if (centerDist < minDist) {
          minDist = centerDist;
          closestPage = p;
        }
      }

      if (closestPage) {
        onVisiblePageChange?.(closestPage);
      }
    };

    root.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", handleScroll);
    };
  }, [totalPages, onVisiblePageChange]);

  const pages = Array.from({ length: totalPages || 0 }, (_, idx) => idx + 1);

  const fallbackW =
    typeof window !== "undefined"
      ? Math.min(620, Math.max(280, window.innerWidth - 16))
      : 540;

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full overflow-y-auto overflow-x-auto px-2 sm:px-4 pt-3 sm:pt-5 pb-28 space-y-4 select-none scroll-smooth"
    >
      {pages.map((p) => {
        const shouldRender = visibleSet.has(p) || Math.abs(p - currentPage) <= 1;
        const pageDataForThisPage =
          (activePageData && Number(activePageData.pageNumber) === p
            ? activePageData
            : null) ||
          pageDataMap?.[p] ||
          null;
        const isCurrentAudioPage =
          activePageData && Number(activePageData.pageNumber) === p;

        return (
          <div
            key={p}
            data-page-num={p}
            ref={(el) => {
              pageRefs.current[p] = el;
            }}
            className="mx-auto flex flex-col items-center"
          >
            {shouldRender ? (
              <div className="relative inline-block shadow-lg rounded-lg overflow-hidden border border-black/5 dark:border-white/5">
                <PdfPageRenderer
                  pdfDoc={pdfDoc}
                  pageNumber={p}
                  zoom={zoom}
                  fitMode={fitMode}
                  theme={theme}
                  themeFilter={themeCfg?.pageFilter}
                  themeBg={themeCfg?.pageBg}
                >
                  {pageDataForThisPage && (
                    <SmartWordHighlightLayer
                      pageData={pageDataForThisPage}
                      activeSentenceIndex={
                        isCurrentAudioPage ? activeSentenceIndex : -1
                      }
                      activeWordIndex={
                        isCurrentAudioPage ? activeWordIndex : -1
                      }
                      isPlayingOrPaused={isCurrentAudioPage && isAudioActive}
                      wordHighlightEnabled={wordHighlightEnabled}
                      sentenceHighlightEnabled={sentenceHighlightEnabled}
                      highlightColorId={highlightColorId}
                      isAnnotationActive={isAnnotationActive}
                      onSelectSentenceOrWord={(sIdx, wIdx) =>
                        onSelectSentenceOrWord?.(sIdx, wIdx, p, pageDataForThisPage)
                      }
                    />
                  )}
                  <PageAnnotationLayer
                    bookId={bookId}
                    pageNumber={p}
                    active={isAnnotationActive}
                    tool={annotationTool}
                    color={annotationColor}
                    size={annotationStrokeWidth}
                    theme={theme}
                    revision={annotationRevision}
                    onAnnotationChange={onAnnotationChange}
                  />
                </PdfPageRenderer>
              </div>
            ) : (
              <div
                className="rounded-lg border border-current/10 flex items-center justify-center opacity-40"
                style={{
                  width: Math.round(fallbackW * zoom),
                  height: Math.round(fallbackW * 1.38 * zoom),
                  backgroundColor: themeCfg?.pageBg || "#ffffff",
                }}
              >
                <span className="text-xs font-medium tabular-nums">صفحة {p}</span>
              </div>
            )}
            <div className="mt-1 text-[11px] opacity-50 font-medium tabular-nums">
              {p}
            </div>
          </div>
        );
      })}
    </div>
  );
}