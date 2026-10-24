import { useState, useEffect, useRef } from "react";
import PdfPageRenderer from "./PdfPageRenderer";

/**
 * Vertical continuous page stream — stacks all PDF pages vertically.
 * - Lazy-renders only pages near the current viewport (RENDER_BUFFER)
 * - Pre-measures aspect ratios ahead (PREFETCH) to reserve stable slot heights
 * - IntersectionObserver tracks the most-visible page → onCurrentPageChange
 * - Exposes scrollToPage(n) via scrollToPageRef for prev/next / go-to jumps
 * Reading direction is always LTR (English style): scroll down to advance.
 */
const DEFAULT_RATIO = 0.707; // A4 portrait fallback
const RENDER_BUFFER = 1; // render currentPage ± 1 (fast open, light memory)
const PREFETCH = 4; // measure aspect ratios within ±4

const clampZoom = (z) => Math.max(0.5, Math.min(3, +Number(z).toFixed(2)));

export default function VerticalPageStream({
  pdf,
  totalPages,
  currentPage,
  zoom,
  onZoomChange,
  theme,
  onCurrentPageChange,
  scrollToPageRef,
}) {
  const scrollRef = useRef(null);
  const [aspect, setAspect] = useState({});
  const [width, setWidth] = useState(0);
  const aspectCache = useRef({});
  const pendingAspect = useRef(new Set());
  const ratios = useRef({});
  const touchRef = useRef({ mode: "idle" });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Live zoom during a pinch gesture. While pinching we only scale the page
  // visually with a CSS transform — the expensive canvas re-render happens
  // ONCE when the fingers lift (prevents the main-thread freeze of rendering
  // the PDF on every touchmove event).
  const [pinchZoom, setPinchZoom] = useState(null);

  // ── Custom touch handling: single-finger drag scroll + pinch-to-zoom ──
  // touch-action:none disables native gestures, so scrolling and pinch zoom
  // are handled here in JS — keeping the browser page-zoom out of the way.
  const onTouchStart = (e) => {
    const st = touchRef.current;
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      st.mode = "pinch";
      st.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      st.baseZoom = zoomRef.current;
    } else if (e.touches.length === 1) {
      st.mode = "drag";
      st.lastX = e.touches[0].clientX;
      st.lastY = e.touches[0].clientY;
      st.vY = 0;
      st.lastT = Date.now();
    }
  };

  const onTouchMove = (e) => {
    const st = touchRef.current;
    const el = scrollRef.current;
    if (!el) return;
    if (st.mode === "pinch" && e.touches.length === 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (st.dist > 0) setPinchZoom(clampZoom(st.baseZoom * (d / st.dist)));
    } else if (st.mode === "drag" && e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      st.vY = (t.clientY - st.lastY) / Math.max(1, now - st.lastT);
      st.lastT = now;
      el.scrollLeft -= t.clientX - st.lastX;
      el.scrollTop -= t.clientY - st.lastY;
      st.lastX = t.clientX;
      st.lastY = t.clientY;
    }
  };

  // Commit the pinch result to the parent (single canvas re-render) & reset
  const finishPinch = () => {
    if (pinchZoom != null) onZoomChange?.(pinchZoom);
    setPinchZoom(null);
  };

  const onTouchEnd = (e) => {
    const st = touchRef.current;
    const wasPinch = st.mode === "pinch";
    if (e.touches.length === 0) {
      if (st.mode === "drag" && Math.abs(st.vY) > 0.05) {
        // Momentum: continue scrolling with decay after the finger lifts
        let v = st.vY;
        const el = scrollRef.current;
        let last = performance.now();
        const step = (now) => {
          if (!el) return;
          const dt = now - last;
          last = now;
          v *= Math.pow(0.94, dt / 16);
          el.scrollTop -= v * dt;
          if (Math.abs(v) > 0.02) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      st.mode = "idle";
      if (wasPinch) finishPinch();
    } else if (e.touches.length === 1) {
      // A pinch ended with one finger still down — commit the zoom and end
      // the gesture cleanly instead of jumping into a drag halfway through.
      st.mode = "idle";
      if (wasPinch) finishPinch();
    }
  };

  const onTouchCancel = () => {
    const st = touchRef.current;
    const wasPinch = st.mode === "pinch";
    st.mode = "idle";
    if (wasPinch) finishPinch();
  };

  // ── Expose scrollToPage to parent ──
  useEffect(() => {
    scrollToPageRef.current = (n) => {
      const node = scrollRef.current?.querySelector(`[data-page="${n}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }, [scrollToPageRef]);

  // ── Measure container width ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Track most-visible page ──
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !totalPages) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          ratios.current[e.target.dataset.page] = e.intersectionRatio;
        }
        let best = null, bestRatio = 0;
        for (const [pg, r] of Object.entries(ratios.current)) {
          if (r > bestRatio) { bestRatio = r; best = Number(pg); }
        }
        if (best != null && bestRatio > 0.3) onCurrentPageChange(best);
      },
      { root, threshold: [0.3, 0.5, 0.75] }
    );
    const nodes = root.querySelectorAll("[data-page]");
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [totalPages, onCurrentPageChange]);

  // ── Pre-measure aspect ratios near the current page ──
  useEffect(() => {
    if (!pdf || !totalPages) return;
    const lo = Math.max(1, currentPage - PREFETCH);
    const hi = Math.min(totalPages, currentPage + PREFETCH);
    for (let i = lo; i <= hi; i++) {
      if (aspectCache.current[i] || pendingAspect.current.has(i)) continue;
      pendingAspect.current.add(i);
      pdf.getPage(i)
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

  const slotWidth = width > 0 ? width - 16 : 0;
  // Reading themes: dark inverts the page, sepia gives a warm "paper" tone
  const pageFilter =
    theme === "dark"
      ? "invert(0.92) hue-rotate(180deg)"
      : theme === "sepia"
      ? "sepia(0.45) saturate(1.15) contrast(1.02) brightness(0.97)"
      : "none";

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto overscroll-contain bg-muted/30"
      style={{ touchAction: "none" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div dir="ltr" className="flex flex-col items-start gap-3 py-3 px-2">
        {Array.from({ length: totalPages }, (_, idx) => {
          const p = idx + 1;
          const r = aspect[p] || DEFAULT_RATIO;
          // eff = live zoom (pinch) — outer slot sizes follow it cheaply.
          // Inner wrapper keeps the committed zoom and is scaled visually;
          // the canvas itself re-renders only once, after the pinch.
          const eff = pinchZoom ?? zoom;
          const effW = slotWidth > 0 ? slotWidth * eff : 0;
          const comW = slotWidth > 0 ? slotWidth * zoom : 0;
          const effH = effW > 0 ? effW / r : 400;
          const comH = comW > 0 ? comW / r : 400;
          const shouldRender = Math.abs(p - currentPage) <= RENDER_BUFFER;
          return (
            <div
              key={p}
              data-page={p}
              className="bg-white shadow-lg shrink-0 mx-auto overflow-hidden"
              style={{
                width: effW > 0 ? effW : "100%",
                height: effH,
                filter: pageFilter,
              }}
            >
              <div
                style={{
                  width: comW > 0 ? comW : "100%",
                  height: comH,
                  transform: `scale(${eff / zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {shouldRender && pdf ? (
                  <PdfPageRenderer
                    pdf={pdf}
                    pageNumber={p}
                    zoom={zoom}
                    containerWidth={slotWidth}
                    containerHeight={comH}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 select-none">
                    {p}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}