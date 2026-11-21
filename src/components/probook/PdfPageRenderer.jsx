import React, { useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

// Universal CSS filter (supported identically on iOS Safari, Android WebView, Chrome, Firefox, Edge):
// - invert(1) hue-rotate(180deg) preserves colored verses/headings (blue stays blue, red stays red, green stays green)
// - contrast(0.90) brightness(0.95) maps harsh pure black/white into comfortable midnight slate (#12151C) & warm cream text
const getCanvasFilter = (th) => {
  if (th === "dark") return "invert(1) hue-rotate(180deg) contrast(0.90) brightness(0.95)";
  if (th === "dusk") return "invert(1) hue-rotate(180deg) contrast(0.83) brightness(0.93)";
  if (th === "sepia") return "sepia(0.32) contrast(0.96) brightness(0.97)";
  return "none";
};

const getCanvasBg = (th) => {
  if (th === "dark") return "bg-[#12151C]";
  if (th === "dusk") return "bg-[#1A202B]";
  if (th === "sepia") return "bg-[#F2E7D2]";
  return "bg-white";
};

/**
 * Direct single-canvas PDF Page Renderer:
 * - Zero double-canvas allocation and zero main-thread canvas.toBlob() GPU readback freezes
 * - Universal cross-device CSS filter (with -webkit-filter) that preserves colored Quranic verses/ink in Night Mode on all browsers & mobile WebViews
 * - Cancels in-flight PDF.js render tasks immediately on page turn or unmount
 */
function PdfPageRenderer({
  pdf: pdfProp,
  pdfDoc,
  pageNumber,
  zoom = 1,
  fitMode = "width",
  targetWidth = 0,
  targetHeight = 0,
  theme = "light",
  themeFilter = undefined,
  themeBg = undefined,
  onAspectRatio = undefined,
  children,
}) {
  const pdf = pdfProp || pdfDoc;
  const t = useT();
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastRenderedKeyRef = useRef("");
  const hasRenderedRef = useRef(false);
  const onAspectRatioRef = useRef(onAspectRatio);
  onAspectRatioRef.current = onAspectRatio;

  const [rendering, setRendering] = useState(true);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [pageDimensions, setPageDimensions] = useState({ width: 0, height: 0 });
  const [winSize, setWinSize] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    let resizeTimer = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setWinSize({ w: window.innerWidth, h: window.innerHeight });
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, []);

  const docId = pdf?.fingerprints?.[0] || pdf?.fingerprint || "pdf";
  // Quantize targetWidth/targetHeight to 2px steps so sub-pixel scrollbar jitter never cancels a render
  const qW = Math.floor(Math.max(0, targetWidth) / 2) * 2;
  const qH = Math.floor(Math.max(0, targetHeight) / 2) * 2;
  const qWinW = Math.floor(winSize.w / 8) * 8;
  const qWinH = Math.floor(winSize.h / 8) * 8;
  const renderKey = `${docId}_${pageNumber}_${fitMode}_${qW}_${qH}_${qWinW}_${qWinH}_${Math.round(zoom * 20)}`;

  useEffect(() => {
    if (!pdf || !pageNumber) return;
    if (lastRenderedKeyRef.current === renderKey && hasRenderedRef.current) {
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
        if (onAspectRatioRef.current) {
          onAspectRatioRef.current(pageNumber, ratio);
        }

        const viewportWidth = winSize.w || 800;
        const viewportHeight = winSize.h || 900;
        const isMobileViewport = viewportWidth < 640;
        const defaultTargetWidth = isMobileViewport
          ? Math.max(260, viewportWidth - 12)
          : Math.min(Math.max(460, viewportWidth - 48), 820);

        let cssScale = (defaultTargetWidth / baseVp.width) * zoom;
        if (targetWidth > 0) {
          cssScale = (targetWidth / baseVp.width) * zoom;
        } else if (targetHeight > 0) {
          cssScale = (targetHeight / baseVp.height) * zoom;
        } else if (fitMode === "page") {
          const availH = Math.max(320, viewportHeight - 130);
          const availW = isMobileViewport ? viewportWidth - 12 : viewportWidth - 48;
          const fitScale = Math.min(availW / baseVp.width, availH / baseVp.height);
          cssScale = fitScale * zoom;
        }

        const cssWidth = Math.round(baseVp.width * cssScale);
        const cssHeight = Math.round(baseVp.height * cssScale);

        const isSmallScreen = viewportWidth < 768;
        const dpr = Math.min(window.devicePixelRatio || 1, isSmallScreen ? 2.0 : 2.25);
        const maxPixelDim = isSmallScreen ? 1800 : 2600;
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

        // Render onto an offscreen canvas first so the visible canvas never flickers or blanks out
        const offscreen = document.createElement("canvas");
        offscreen.width = pxWidth;
        offscreen.height = pxHeight;
        const offCtx = offscreen.getContext("2d", { alpha: false });
        if (!offCtx) return;

        offCtx.fillStyle = "#ffffff";
        offCtx.fillRect(0, 0, pxWidth, pxHeight);

        const task = page.render({ canvasContext: offCtx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled) return;

        if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
          canvas.width = pxWidth;
          canvas.height = pxHeight;
        }
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        setPageDimensions({ width: cssWidth, height: cssHeight });

        const visCtx = canvas.getContext("2d", { alpha: false });
        if (visCtx) {
          visCtx.drawImage(offscreen, 0, 0);
        }

        lastRenderedKeyRef.current = renderKey;
        hasRenderedRef.current = true;
        setHasRenderedOnce(true);
        setRendering(false);
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
  }, [pdf, pageNumber, zoom, fitMode, targetWidth, targetHeight, winSize.w, winSize.h, renderKey]);

  const canvasFilter = themeFilter !== undefined ? themeFilter : getCanvasFilter(theme);
  const containerBg = getCanvasBg(theme);

  const fallbackW = Math.min(620, Math.max(260, winSize.w - 16));

  // Inject width & height into custom React overlay children (such as PageAnnotationLayer)
  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && typeof child.type !== "string") {
      return React.cloneElement(child, {
        width: child.props.width || pageDimensions.width,
        height: child.props.height || pageDimensions.height,
      });
    }
    return child;
  });

  return (
    <div
      data-pdf-page-number={pageNumber}
      style={{
        width: pageDimensions.width > 0 ? `${pageDimensions.width}px` : undefined,
        height: pageDimensions.height > 0 ? `${pageDimensions.height}px` : undefined,
        minWidth: pageDimensions.width === 0 ? `${Math.round(fallbackW * zoom)}px` : undefined,
        minHeight: pageDimensions.height === 0 ? `${Math.round(fallbackW * 1.38 * zoom)}px` : undefined,
        backgroundColor: themeBg || undefined,
      }}
      className={`relative flex items-center justify-center overflow-hidden select-none ${containerBg}`}
    >
      <canvas
        ref={canvasRef}
        data-pdf-canvas={pageNumber}
        style={{
          filter: canvasFilter,
          WebkitFilter: canvasFilter,
        }}
        className={`block ${containerBg} ${
          hasRenderedOnce ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Warm Amber Eye-Protection Tint in Night/Dusk Mode */}
      {(theme === "dark" || theme === "dusk") && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor:
              theme === "dark"
                ? "rgba(254, 243, 199, 0.035)"
                : "rgba(254, 243, 199, 0.025)",
          }}
        />
      )}

      {/* Overlay layers (SmartWordHighlightLayer, PageAnnotationLayer, etc.) */}
      {enhancedChildren}

      {rendering && !hasRenderedOnce && !error && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${containerBg} text-stone-400`}>
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
          <span className="text-xs font-mono tabular-nums">
            {t.pageNo || "ص"} {pageNumber}
          </span>
        </div>
      )}

      {error && !hasRenderedOnce && (
        <div className={`absolute inset-0 flex items-center justify-center ${containerBg} px-4 text-center`}>
          <span className="text-xs text-destructive font-medium">
            {t.renderPageFail || "فشل عرض الصفحة"} {pageNumber}
          </span>
        </div>
      )}
    </div>
  );
}

export default PdfPageRenderer;