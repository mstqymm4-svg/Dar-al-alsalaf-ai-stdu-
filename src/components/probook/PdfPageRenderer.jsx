import React, { useRef, useState, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

// In-memory LRU cache of rendered page images for instant re-display without worker lag
const renderedImageCache = new Map();
const MAX_IMAGE_CACHE = 32;

function getCachedPageImage(key) {
  return renderedImageCache.get(key) || null;
}

function setCachedPageImage(key, blobUrl) {
  if (renderedImageCache.has(key)) {
    const prev = renderedImageCache.get(key);
    if (prev && prev !== blobUrl && prev.startsWith("blob:")) {
      try { URL.revokeObjectURL(prev); } catch {}
    }
    renderedImageCache.delete(key);
  } else if (renderedImageCache.size >= MAX_IMAGE_CACHE) {
    const firstKey = renderedImageCache.keys().next().value;
    const oldUrl = renderedImageCache.get(firstKey);
    if (oldUrl && oldUrl.startsWith("blob:")) {
      try { URL.revokeObjectURL(oldUrl); } catch {}
    }
    renderedImageCache.delete(firstKey);
  }
  renderedImageCache.set(key, blobUrl);
}

const getCanvasFilter = (th) => {
  if (th === "dark") return "invert(0.92) hue-rotate(180deg) contrast(1.05)";
  if (th === "dusk") return "invert(0.86) hue-rotate(180deg) sepia(0.12)";
  if (th === "sepia") return "sepia(0.35) saturate(1.05) contrast(1.01)";
  return "none";
};

const getCanvasBg = (th) => {
  if (th === "dark") return "bg-[#121418]";
  if (th === "dusk") return "bg-[#181C22]";
  if (th === "sepia") return "bg-[#EFE5D3]";
  return "bg-white";
};

/**
 * Ultra-performant PDF Page Renderer:
 * - Instant display from in-memory cache when revisiting pages
 * - Direct hardware-accelerated canvas rasterization
 * - Non-blocking async toBlob snapshot caching (zero main-thread freeze)
 * - Clean per-canvas filter inversion for mobile Dark Mode without WebKit compositing bugs
 */
function PdfPageRenderer({
  pdf,
  pageNumber,
  zoom = 1,
  targetWidth = 0,
  targetHeight = 0,
  theme = "light",
  onAspectRatio,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const [cachedUrl, setCachedUrl] = useState(null);
  const [error, setError] = useState(false);

  // Unique cache key per page, zoom and theme
  const cacheKey = `${pdf?.fingerprint || "pdf"}_${pageNumber}_${Math.round(zoom * 10)}_${theme}`;

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

    // If already cached in memory, use cached image instantly and skip PDF worker render
    const existing = getCachedPageImage(cacheKey);
    if (existing) {
      setCachedUrl(existing);
      setHasRenderedOnce(true);
      setRendering(false);
      return;
    }

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

        // Adaptive DPR and max canvas buffer for fast mobile & desktop rendering
        const isSmallScreen = typeof window !== "undefined" && window.innerWidth < 768;
        const dpr = Math.min(window.devicePixelRatio || 1, isSmallScreen ? 1.65 : 2.0);
        const maxPixelDim = isSmallScreen ? 2200 : 3200;
        const rawRenderScale = cssScale * dpr;
        const maxAllowedScale = Math.min(
          maxPixelDim / baseVp.width,
          maxPixelDim / baseVp.height
        );
        const renderScale = Math.min(rawRenderScale, maxAllowedScale);

        const viewport = page.getViewport({ scale: renderScale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const pxWidth = Math.floor(viewport.width);
        const pxHeight = Math.floor(viewport.height);

        // Render to an offscreen canvas first so visible canvas NEVER clears/flashes white on zoom
        const offscreen = document.createElement("canvas");
        offscreen.width = pxWidth;
        offscreen.height = pxHeight;
        const offCtx = offscreen.getContext("2d", { alpha: false });
        if (!offCtx) return;

        offCtx.imageSmoothingEnabled = true;
        offCtx.imageSmoothingQuality = "high";

        const task = page.render({ canvasContext: offCtx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled) return;

        // Atomic swap into visible canvas
        if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
          canvas.width = pxWidth;
          canvas.height = pxHeight;
        }
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(offscreen, 0, 0);
        }

        setRendering(false);
        setHasRenderedOnce(true);

        // Save snapshot to memory cache off the main thread using async toBlob
        if (typeof canvas.toBlob === "function") {
          setTimeout(() => {
            if (!cancelled && canvas) {
              try {
                canvas.toBlob(
                  (blob) => {
                    if (!cancelled && blob) {
                      const url = URL.createObjectURL(blob);
                      setCachedPageImage(cacheKey, url);
                    }
                  },
                  "image/webp",
                  0.82
                );
              } catch {}
            }
          }, 120);
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

  const canvasFilter = getCanvasFilter(theme);
  const containerBg = getCanvasBg(theme);

  return (
    <div className={`relative w-full h-full flex items-center justify-center overflow-hidden select-none ${containerBg}`}>
      {/* If cached image exists, display it instantly */}
      {cachedUrl && (
        <img
          src={cachedUrl}
          alt=""
          style={{ filter: canvasFilter }}
          className={`w-full h-full object-contain pointer-events-none ${containerBg}`}
        />
      )}

      <canvas
        ref={canvasRef}
        style={{ filter: canvasFilter }}
        className={`w-full h-full block transition-opacity duration-150 ${containerBg} ${
          hasRenderedOnce && !cachedUrl ? "opacity-100" : "opacity-0"
        } ${cachedUrl ? "hidden" : ""}`}
      />

      {rendering && !hasRenderedOnce && !cachedUrl && !error && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${containerBg} text-stone-400`}>
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
          <span className="text-xs font-mono tabular-nums">
            {t.pageNo || "ص"} {pageNumber}
          </span>
        </div>
      )}

      {error && (
        <div className={`absolute inset-0 flex items-center justify-center ${containerBg} px-4 text-center`}>
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
    prev.theme === next.theme &&
    Math.round(prev.targetWidth) === Math.round(next.targetWidth) &&
    Math.round(prev.targetHeight) === Math.round(next.targetHeight)
  );
});