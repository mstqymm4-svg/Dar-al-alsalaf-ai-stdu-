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

  // Scroll to target page when triggered by toolbar/TOC/search
  useEffect(() => {
    if (!scrollTriggerPage || !pageRefs.current[scrollTriggerPage]) return;
    const targetEl = pageRefs.current[scrollTriggerPage];
    if (targetEl && containerRef.current) {
      isProgrammaticScroll.current = true;
      targetEl.scrollIntoView({ behavior: "auto", block: "start" });
      setVisibleSet((prev) => {
        const next = new Set(prev);
        next.add(scrollTriggerPage);
        if (scrollTriggerPage > 1) next.add(scrollTriggerPage - 1);
        if (scrollTriggerPage < totalPages) next.add(scrollTriggerPage + 1);
        return next;
      });
      setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 250);
    }
  }, [scrollTriggerPage, totalPages]);

  // IntersectionObserver to lazy-load canvases & update current page number
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
            ratios.set(p, entry.intersectionRatio);
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
          if (bestPage && bestRatio > 0.2) {
            onVisiblePageChange?.(bestPage);
          }
        }
      },
      {
        root,
        rootMargin: "400px 0px",
        threshold: [0.05, 0.25, 0.5, 0.75],
      }
    );

    Object.values(pageRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [totalPages, onVisiblePageChange]);

  const pages = Array.from({ length: totalPages || 0 }, (_, idx) => idx + 1);

  const fallbackW =
    typeof window !== "undefined"
      ? Math.min(620, Math.max(280, window.innerWidth - 16))
      : 540;

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full overflow-y-auto overflow-x-auto px-2 sm:px-4 py-3 sm:py-5 space-y-4 select-none"
    >
      {pages.map((p) => {
        const shouldRender = visibleSet.has(p) || Math.abs(p - currentPage) <= 1;
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
                  {isCurrentAudioPage && (
                    <SmartWordHighlightLayer
                      pageData={activePageData}
                      activeSentenceIndex={activeSentenceIndex}
                      activeWordIndex={activeWordIndex}
                      isPlayingOrPaused={isAudioActive}
                      wordHighlightEnabled={wordHighlightEnabled}
                      sentenceHighlightEnabled={sentenceHighlightEnabled}
                      highlightColorId={highlightColorId}
                      isAnnotationActive={isAnnotationActive}
                      onSelectSentenceOrWord={onSelectSentenceOrWord}
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