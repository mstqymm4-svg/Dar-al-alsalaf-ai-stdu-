import React, { useRef, useState, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

// In-memory LRU cache of rendered page images for instant re-display without worker lag
const renderedImageCache = new Map();
const MAX_IMAGE_CACHE = 24;

function getCachedPageImage(key) {
  return renderedImageCache.get(key) || null;
}

function setCachedPageImage(key, dataUrl) {
  if (renderedImageCache.size >= MAX_IMAGE_CACHE) {
    const firstKey = renderedImageCache.keys().next().value;
    renderedImageCache.delete(firstKey);
  }
  renderedImageCache.set(key, dataUrl);
}

/**
 * Ultra-performant PDF Page Renderer:
 * - Instant display from in-memory cache when revisiting pages
 * - Direct hardware-accelerated canvas rasterization
 * - Capped DPR (1.5x) to eliminate GPU memory exhaustion and frame drops
 * - Smooth fade-in without layout shift
 * - Immediate render task cancellation on unmount or fast turn
 */
function PdfPageRenderer({
  pdf,
  pageNumber,
  zoom = 1,
  targetWidth = 0,
  targetHeight = 0,
  onAspectRatio,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const [cachedUrl, setCachedUrl] = useState(null);
  const [error, setError] = useState(false);

  // Unique cache key per page and zoom
  const cacheKey = `${pdf?.fingerprint || "pdf"}_${pageNumber}_${Math.round(zoom * 10)}`;

  useEffect(() => {
    // Check if we already have this page in memory
    const existing = getCachedPageImage(cacheKey);
    if (existing) {
      setCachedUrl(existing);
      setHasRenderedOnce(true);
      setRendering(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!pdf || !pageNumber) return;
    let cancelled = false;
    setError(false);

    const render = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
          renderTaskRef.current = null;
        }

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseVp = page.getViewport({ scale: 1 });
        const ratio = baseVp.width / baseVp.height;
        if (onAspectRatio) {
          onAspectRatio(pageNumber, ratio);
        }

        let cssScale = 1.2 * zoom;
        if (targetWidth > 0) {
          cssScale = targetWidth / baseVp.width;
        } else if (targetHeight > 0) {
          cssScale = targetHeight / baseVp.height;
        }

        // Capped DPR for super sharp fonts without GPU memory bloat or lag
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const maxPixelDim = 2400;
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
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";

        const pxWidth = Math.floor(viewport.width);
        const pxHeight = Math.floor(viewport.height);

        if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
          canvas.width = pxWidth;
          canvas.height = pxHeight;
        }

        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (!cancelled) {
          setRendering(false);
          setHasRenderedOnce(true);

          // Save small preview snapshot to memory cache asynchronously
          setTimeout(() => {
            if (!cancelled && canvas) {
              try {
                const dataUrl = canvas.toDataURL("image/webp", 0.85);
                setCachedPageImage(cacheKey, dataUrl);
              } catch {}
            }
          }, 60);
        }
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setError(true);
          setRendering(false);
        }
      }
    };

    const rafId = requestAnimationFrame(() => {
      render();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, zoom, targetWidth, targetHeight, cacheKey]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-white overflow-hidden select-none">
      {/* If cached image exists, display it instantly to prevent flash */}
      {cachedUrl && !hasRenderedOnce && (
        <img
          src={cachedUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
      )}

      <canvas
        ref={canvasRef}
        className={`block bg-white transition-opacity duration-150 ${
          hasRenderedOnce ? "opacity-100" : "opacity-0"
        }`}
      />

      {rendering && !hasRenderedOnce && !cachedUrl && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-50/90">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
          <span className="text-xs font-mono tabular-nums text-stone-500">
            {t.pageNo || "ص"} {pageNumber}
          </span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 px-4 text-center">
          <span className="text-xs text-destructive font-medium">
            {t.renderPageFail || "فشل عرض الصفحة"} {pageNumber}
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(PdfPageRenderer, (prev, next) => {
  return (
    prev.pdf === next.pdf &&
    prev.pageNumber === next.pageNumber &&
    prev.zoom === next.zoom &&
    Math.round(prev.targetWidth) === Math.round(next.targetWidth) &&
    Math.round(prev.targetHeight) === Math.round(next.targetHeight)
  );
});