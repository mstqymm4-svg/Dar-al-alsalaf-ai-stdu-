import { useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { getCachedPage, cachePage } from "@/lib/pdfLoader";

/**
 * Renders a single PDF page to a canvas element.
 * - Uses rendered-page memory cache for instant display on revisit
 * - Keeps previous frame visible during zoom re-renders (no white flash)
 * - High DPR rendering (up to 2.25x) for crisp Arabic calligraphy & diacritics
 * - Cancels in-progress renders on dependency change
 */
export default function PdfPageRenderer({
  pdf,
  pageNumber,
  zoom = 1,
  targetWidth = 0,
  targetHeight = 0,
  onAspectRatio,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [cachedSrc, setCachedSrc] = useState(null);

  useEffect(() => {
    if (!pdf || !pageNumber) return;
    let cancelled = false;
    setError(false);

    const widthKey = Math.round(targetWidth || 600);
    const zoomKey = Number(zoom || 1).toFixed(2);
    const cacheKey = `${pdf?.fingerprints?.[0] || "pdf"}_p${pageNumber}_w${widthKey}_z${zoomKey}`;
    const fallbackPreviewKey = `${pdf?.fingerprints?.[0] || "pdf"}_p${pageNumber}_latest`;

    const exactCached = getCachedPage(cacheKey);
    const previewCached = exactCached || getCachedPage(fallbackPreviewKey);
    if (previewCached) {
      setCachedSrc(previewCached);
    }

    if (!exactCached) {
      setRendering(true);
    }

    const render = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseVp = page.getViewport({ scale: 1 });
        const ratio = baseVp.width / baseVp.height;
        if (onAspectRatio) onAspectRatio(pageNumber, ratio);

        let cssScale = 1.2 * zoom;
        if (targetWidth > 0) {
          cssScale = targetWidth / baseVp.width;
        } else if (targetHeight > 0) {
          cssScale = targetHeight / baseVp.height;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
        // Cap maximum canvas pixel dimension to avoid mobile GPU memory exhaustion
        const maxPixelDim = 3200;
        const rawRenderScale = cssScale * dpr;
        const maxAllowedScale = Math.min(
          maxPixelDim / baseVp.width,
          maxPixelDim / baseVp.height
        );
        const renderScale = Math.min(rawRenderScale, maxAllowedScale);

        const viewport = page.getViewport({ scale: renderScale });
        const cssViewport = page.getViewport({ scale: cssScale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (!cancelled) {
          setRendering(false);
          setHasRenderedOnce(true);
          try {
            if (zoom <= 1.5 && canvas.width <= 1800) {
              const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
              cachePage(cacheKey, dataUrl);
              cachePage(fallbackPreviewKey, dataUrl);
              setCachedSrc(dataUrl);
            }
          } catch {}
        }
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setError(true);
          setRendering(false);
        }
      }
    };

    const timer = setTimeout(render, 10);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdf, pageNumber, zoom, targetWidth, targetHeight]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-white overflow-hidden select-none">
      {cachedSrc && !hasRenderedOnce && (
        <img
          src={cachedSrc}
          alt={`${t.pageNo || "صفحة"} ${pageNumber}`}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
      )}

      <canvas
        ref={canvasRef}
        className={`block bg-white transition-opacity duration-150 ${
          hasRenderedOnce ? "opacity-100" : "opacity-0"
        }`}
      />

      {rendering && !hasRenderedOnce && !cachedSrc && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-stone-50/90">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="text-xs font-mono tabular-nums text-stone-500">
            {t.pageNo} {pageNumber}
          </span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 px-4 text-center">
          <span className="text-xs text-destructive font-medium">
            {t.renderPageFail} {pageNumber}
          </span>
        </div>
      )}
    </div>
  );
}