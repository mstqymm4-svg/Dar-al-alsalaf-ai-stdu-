import React, { useRef, useState, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

const getCanvasFilter = (th) => {
  if (th === "dark") return "invert(0.92) hue-rotate(180deg)";
  if (th === "dusk") return "invert(0.86) hue-rotate(180deg)";
  if (th === "sepia") return "sepia(0.3)";
  return "none";
};

const getCanvasBg = (th) => {
  if (th === "dark") return "bg-[#121418]";
  if (th === "dusk") return "bg-[#181C22]";
  if (th === "sepia") return "bg-[#EFE5D3]";
  return "bg-white";
};

/**
 * Direct single-canvas PDF Page Renderer:
 * - Zero double-canvas allocation and zero main-thread canvas.toBlob() GPU readback freezes
 * - Theme switching applies a lightweight CSS layer without re-running PDF.js rendering
 * - Cancels in-flight PDF.js render tasks immediately on page turn or unmount
 */
function PdfPageRenderer({
  pdf,
  pageNumber,
  zoom = 1,
  targetWidth = 0,
  targetHeight = 0,
  theme = "light",
  onAspectRatio = undefined,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastRenderedKeyRef = useRef("");
  const [rendering, setRendering] = useState(true);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const [error, setError] = useState(false);

  const docId = pdf?.fingerprints?.[0] || pdf?.fingerprint || "pdf";
  const renderKey = `${docId}_${pageNumber}_${Math.round(targetWidth)}_${Math.round(targetHeight)}_${Math.round(zoom * 20)}`;

  useEffect(() => {
    if (!pdf || !pageNumber) return;
    if (lastRenderedKeyRef.current === renderKey && hasRenderedOnce) {
      setRendering(false);
      return;
    }

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

        let cssScale = 1.15 * zoom;
        if (targetWidth > 0) {
          cssScale = targetWidth / baseVp.width;
        } else if (targetHeight > 0) {
          cssScale = targetHeight / baseVp.height;
        }

        const isSmallScreen = typeof window !== "undefined" && window.innerWidth < 768;
        const dpr = Math.min(window.devicePixelRatio || 1, isSmallScreen ? 1.35 : 1.75);
        const maxPixelDim = isSmallScreen ? 1650 : 2400;
        const rawRenderScale = cssScale * dpr;
        const maxAllowedScale = Math.min(
          maxPixelDim / baseVp.width,
          maxPixelDim / baseVp.height
        );
        const renderScale = Math.min(rawRenderScale, maxAllowedScale);

        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const pxWidth = Math.max(1, Math.floor(viewport.width));
        const pxHeight = Math.max(1, Math.floor(viewport.height));

        if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
          canvas.width = pxWidth;
          canvas.height = pxHeight;
        }
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pxWidth, pxHeight);

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled) return;

        lastRenderedKeyRef.current = renderKey;
        setRendering(false);
        setHasRenderedOnce(true);
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setError(true);
          setRendering(false);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, zoom, targetWidth, targetHeight, renderKey, hasRenderedOnce, onAspectRatio]);

  const canvasFilter = getCanvasFilter(theme);
  const containerBg = getCanvasBg(theme);

  return (
    <div className={`relative w-full h-full flex items-center justify-center overflow-hidden select-none ${containerBg}`}>
      <canvas
        ref={canvasRef}
        style={{ filter: canvasFilter }}
        className={`w-full h-full block ${containerBg} ${
          hasRenderedOnce ? "opacity-100" : "opacity-0"
        }`}
      />

      {rendering && !hasRenderedOnce && !error && (
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