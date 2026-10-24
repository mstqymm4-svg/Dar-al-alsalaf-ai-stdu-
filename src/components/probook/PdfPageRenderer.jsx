import { useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Renders a single PDF page to a canvas element.
 * - Calculates optimal fit scale based on container dimensions
 * - High DPR rendering for crisp text (up to 2x)
 * - Preserves exact PDF layout: embedded fonts, images, tables, colors
 * - Cancels in-progress renders on dependency change (prevents memory leaks)
 */
export default function PdfPageRenderer({
  pdf,
  pageNumber,
  zoom = 1,
  darkFilter = "none",
  containerWidth = 0,
  containerHeight = 0,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(0.7);

  useEffect(() => {
    if (!pdf || !pageNumber) return;
    let cancelled = false;
    setRendering(true);
    setError(false);

    const render = async () => {
      try {
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch (e) {}
        }

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseVp = page.getViewport({ scale: 1 });
        if (!cancelled) setAspectRatio(baseVp.width / baseVp.height);

        // Fit page within container
        let fitScale = 1.2;
        if (containerWidth > 0 && containerHeight > 0) {
          fitScale = Math.min(
            containerWidth / baseVp.width,
            containerHeight / baseVp.height
          ) * 0.95;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const renderScale = fitScale * zoom * dpr;
        const cssScale = fitScale * zoom;

        const viewport = page.getViewport({ scale: renderScale });
        const cssViewport = page.getViewport({ scale: cssScale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.textBaseline = "alphabetic";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (!cancelled) setRendering(false);
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setError(true);
          setRendering(false);
        }
      }
    };

    const timer = setTimeout(render, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (e) {}
      }
    };
  }, [pdf, pageNumber, zoom, containerWidth, containerHeight]);

  const loadingH = containerHeight > 0 ? containerHeight * 0.85 : 500;
  const loadingW = loadingH * aspectRatio;

  return (
    <div
      className="relative flex items-center justify-center bg-white shadow-2xl"
      style={{ minHeight: loadingH, minWidth: Math.min(loadingW, 300) }}
    >
      <canvas ref={canvasRef} className="block bg-white" />
      {rendering && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-xs text-muted-foreground">{t.pageNo} {pageNumber}</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <span className="text-sm text-destructive">{t.renderPageFail} {pageNumber}</span>
        </div>
      )}
    </div>
  );
}