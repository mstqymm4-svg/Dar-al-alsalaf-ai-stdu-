import { useState, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  ZoomIn,
  ZoomOut,
  Moon,
  Sun,
  Palette,
  List,
  Maximize,
  ChevronDown,
  PenTool,
  Highlighter,
  Eraser,
  Type,
  Minus,
  Square,
  Circle,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "@/lib/i18n";

const PEN_COLORS = [
  { id: "red", value: "#EF4444", labelKey: "colorRed", fallback: "أحمر" },
  { id: "amber", value: "#F59E0B", labelKey: "colorAmber", fallback: "ذهبي" },
  { id: "emerald", value: "#10B981", labelKey: "colorEmerald", fallback: "أخضر" },
  { id: "blue", value: "#3B82F6", labelKey: "colorBlue", fallback: "أزرق" },
  { id: "purple", value: "#8B5CF6", labelKey: "colorPurple", fallback: "بنفسجي" },
  { id: "pink", value: "#EC4899", labelKey: "colorPink", fallback: "وردي" },
  { id: "cyan", value: "#06B6D4", labelKey: "colorCyan", fallback: "سماوي" },
  { id: "ink", value: "#111827", labelKey: "colorInk", fallback: "حبر داكن" },
];

const PEN_SIZES = [
  { id: "fine", value: 2, dot: "w-1.5 h-1.5", labelKey: "sizeFine", fallback: "رفيع" },
  { id: "medium", value: 3.5, dot: "w-2.5 h-2.5", labelKey: "sizeMedium", fallback: "متوسط" },
  { id: "bold", value: 6, dot: "w-3.5 h-3.5", labelKey: "sizeBold", fallback: "عريض" },
  { id: "xbold", value: 9, dot: "w-4 h-4", labelKey: "sizeXBold", fallback: "سميك" },
];

/**
 * Ergonomic bottom toolbar for ProBookViewer.
 * - Restores the single Night Mode / Comfort button as it was (zero freeze)
 * - Smooth horizontal touch scrolling left/right on both the main toolbar and Pen palette
 * - Draggable left/right touch progress scrubber bar
 * - Upgraded Pen suite: Pan, Pen, Highlighter, Line/Underline, Rectangle, Circle, Text Note, Eraser
 */
export default function ViewerToolbar({
  currentPage,
  totalPages,
  zoom,
  theme,
  bookmarks = [],
  penMode = false,
  penTool = "pen",
  penColor = "#EF4444",
  penSize = 3.5,
  annotationCount = 0,
  canRedo = false,
  onTogglePenMode,
  onSelectPenTool,
  onSelectPenColor,
  onSelectPenSize,
  onUndoAnnotation,
  onRedoAnnotation,
  onClearAnnotations,
  onNext,
  onPrev,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleComfort,
  onToggleBookmark,
  onToggleToc,
  onToggleGoTo,
  onSeekProgress,
  onToggleFullscreen,
  onHide,
}) {
  const t = useT();
  const dark = theme === "dark" || theme === "dusk";
  const pct = totalPages ? Math.round((currentPage / totalPages) * 100) : 0;
  const [hoverPage, setHoverPage] = useState(null);
  const [hoverX, setHoverX] = useState(0);
  const scrubbingRef = useRef(false);

  const themeIcon =
    theme === "dark" || theme === "dusk" ? (
      <Moon className="w-4 h-4" />
    ) : theme === "sepia" ? (
      <Palette className="w-4 h-4" />
    ) : (
      <Sun className="w-4 h-4" />
    );

  const isBookmarked = bookmarks.includes(currentPage);

  const seekFromClientX = (el, clientX, commit = false) => {
    if (!totalPages) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHoverPage(Math.max(1, Math.round(ratio * totalPages)));
    setHoverX(Math.min(rect.width - 16, Math.max(16, clientX - rect.left)));
    if (commit && onSeekProgress) {
      onSeekProgress(ratio);
    }
  };

  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className={`shrink-0 border-t transition-colors z-20 ${
        dark
          ? "border-neutral-800 bg-[#14171D] text-stone-100"
          : theme === "sepia"
          ? "border-[#D5C7AD] bg-[#F3EAD8] text-[#3D2E1E]"
          : "border-stone-200 bg-[#FBF9F5] text-stone-900"
      }`}
    >
      {/* Upgraded Pen, Highlighter, Shapes & Notes Palette Bar (Horizontally Scrollable Left/Right) */}
      {penMode && (
        <div
          dir="rtl"
          style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
          className={`border-b px-2.5 py-2 overflow-x-auto scrollbar-none ${
            dark
              ? "border-neutral-800 bg-[#0F1217]"
              : theme === "sepia"
              ? "border-[#D5C7AD] bg-[#EAE0CC]"
              : "border-stone-200 bg-stone-100/95"
          }`}
        >
          <div className="min-w-max mx-auto flex items-center justify-between gap-2.5">
            {/* 1. Tool Type Selector */}
            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => onSelectPenTool?.("pan")}
                title={t.penPanTip || "تحريك وتصفح الصفحات"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "pan"
                    ? "bg-stone-700 text-white shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Hand className="w-3.5 h-3.5" />
                <span>{t.penPan || "تحريك"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("pen")}
                title={t.penDrawTip || "قلم كتابة حر"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "pen"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>{t.penDraw || "قلم"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("highlighter")}
                title={t.penHighlightTip || "قلم تظليل شفاف"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "highlighter"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span>{t.penHighlight || "تظليل"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("line")}
                title={t.penLineTip || "رسم خط مستقيم"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "line"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Minus className="w-3.5 h-3.5" />
                <span>{t.penLine || "خط"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("rect")}
                title={t.penRectTip || "رسم إطار مستطيل"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "rect"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                <span>{t.penRect || "مربع"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("circle")}
                title={t.penCircleTip || "رسم دائرة لتحديد النص"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "circle"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Circle className="w-3.5 h-3.5" />
                <span>{t.penCircle || "دائرة"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("text")}
                title={t.penTextTip || "إضافة ملاحظة نصية على الصفحة"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "text"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                <span>{t.penText || "نص"}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectPenTool?.("eraser")}
                title={t.penEraserTip || "ممحاة"}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  penTool === "eraser"
                    ? "bg-rose-600 text-white shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>{t.penEraser || "ممحاة"}</span>
              </button>
            </div>

            {/* 2. Color Swatches & Stroke Sizes */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((c) => {
                  const isSelected = penColor === c.value;
                  const displayBg =
                    dark && c.value === "#111827" ? "#F9FAFB" : c.value;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelectPenColor?.(c.value);
                        if (penTool === "eraser" || penTool === "pan") {
                          onSelectPenTool?.("pen");
                        }
                      }}
                      title={t[c.labelKey] || c.fallback}
                      className={`w-6 h-6 rounded-full border border-black/15 dark:border-white/20 flex items-center justify-center transition-transform shrink-0 ${
                        isSelected
                          ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background"
                          : "opacity-85 hover:opacity-100 hover:scale-105"
                      }`}
                      style={{ backgroundColor: displayBg }}
                    />
                  );
                })}
              </div>

              <div className="h-4 w-px bg-stone-300 dark:bg-neutral-700 mx-0.5" />

              {/* Stroke Thickness */}
              <div className="flex items-center gap-1">
                {PEN_SIZES.map((sz) => {
                  const isSelected = penSize === sz.value;
                  const dotColor =
                    dark && penColor === "#111827" ? "#F9FAFB" : penColor;
                  return (
                    <button
                      key={sz.id}
                      type="button"
                      onClick={() => onSelectPenSize?.(sz.value)}
                      title={t[sz.labelKey] || sz.fallback}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-primary/20 text-primary ring-1 ring-primary"
                          : "hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span
                        className={`rounded-full bg-current ${sz.dot}`}
                        style={{
                          color:
                            penTool !== "eraser" && penTool !== "pan"
                              ? dotColor
                              : undefined,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Undo / Redo / Clear / Close Pen */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onUndoAnnotation}
                disabled={annotationCount === 0}
                title={t.penUndo || "تراجع"}
                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onRedoAnnotation}
                disabled={!canRedo}
                title={t.penRedo || "إعادة"}
                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClearAnnotations}
                disabled={annotationCount === 0}
                title={t.penClearPage || "مسح جميع رسومات هذه الصفحة"}
                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePenMode}
                title={t.penClose || "إغلاق شريط القلم"}
                className="p-1.5 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 transition-colors ms-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Touch-Draggable Reading Progress Scrubber Bar */}
      <div
        dir="ltr"
        style={{ touchAction: "none" }}
        className={`h-3 cursor-pointer group relative flex items-center ${
          dark ? "bg-neutral-800" : theme === "sepia" ? "bg-[#DFD2BA]" : "bg-stone-200"
        }`}
        onPointerDown={(e) => {
          e.stopPropagation();
          scrubbingRef.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
          seekFromClientX(e.currentTarget, e.clientX, true);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (scrubbingRef.current) {
            seekFromClientX(e.currentTarget, e.clientX, true);
          } else if (e.pointerType === "mouse") {
            seekFromClientX(e.currentTarget, e.clientX, false);
          }
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (scrubbingRef.current) {
            scrubbingRef.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {}
            seekFromClientX(e.currentTarget, e.clientX, true);
          }
          setHoverPage(null);
        }}
        onPointerCancel={() => {
          scrubbingRef.current = false;
          setHoverPage(null);
        }}
        onMouseLeave={() => {
          if (!scrubbingRef.current) setHoverPage(null);
        }}
      >
        <div
          className="h-full bg-primary transition-all duration-75"
          style={{ width: `${pct}%` }}
        />

        {/* Draggable Scrubber Thumb Handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary ring-2 ring-white dark:ring-neutral-900 shadow pointer-events-none"
          style={{ left: `${pct}%` }}
        />

        {/* Bookmark ticks on progress bar */}
        {totalPages > 0 &&
          bookmarks.map((bmPage) => {
            const bmPct = Math.min(100, Math.max(0, (bmPage / totalPages) * 100));
            return (
              <span
                key={bmPage}
                className="absolute top-0 bottom-0 w-1 bg-amber-500 pointer-events-none"
                style={{ left: `${bmPct}%` }}
              />
            );
          })}

        {/* Hover / Drag page tooltip */}
        {hoverPage !== null && (
          <div
            className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded bg-stone-900 text-stone-100 text-[10px] font-mono tabular-nums pointer-events-none shadow-md"
            style={{ left: `${hoverX}px` }}
          >
            {t.pageNo || "ص"} {hoverPage}
          </div>
        )}
      </div>

      {/* Main Bottom Toolbar Controls Row (Horizontally Scrollable Left & Right) */}
      <div
        dir="ltr"
        style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
        className="w-full overflow-x-auto scrollbar-none"
      >
        <div className="min-w-max max-w-4xl mx-auto flex items-center justify-between px-3 py-1.5 sm:py-2 gap-3 sm:gap-4">
          {/* Left group: Zoom controls */}
          <div className="flex items-center gap-1 shrink-0">
            <ToolBtn onClick={onZoomOut} dark={dark} title={t.tbZoomOut || "تصغير"}>
              <ZoomOut className="w-4 h-4" />
            </ToolBtn>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResetZoom?.();
              }}
              title={t.tbResetZoom || "إعادة ضبط التكبير (100%)"}
              className={`inline-flex text-[11px] font-mono tabular-nums font-bold px-2 py-1 rounded-md transition-colors ${
                dark ? "hover:bg-neutral-800 text-stone-300" : "hover:bg-stone-200/70 text-stone-700"
              }`}
            >
              {Math.round(zoom * 100)}%
            </button>
            <ToolBtn onClick={onZoomIn} dark={dark} title={t.tbZoomIn || "تكبير"}>
              <ZoomIn className="w-4 h-4" />
            </ToolBtn>
          </div>

          {/* Center group: Page navigation */}
          <div className="flex items-center gap-1.5 shrink-0">
            <ToolBtn
              onClick={onPrev}
              dark={dark}
              title={t.tbPrev || "الصفحة السابقة"}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </ToolBtn>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleGoTo?.();
              }}
              title={t.tbGoTo || "انتقال إلى صفحة"}
              className={`text-xs font-mono tabular-nums font-bold px-3 py-1.5 rounded-xl shrink-0 whitespace-nowrap transition-colors ${
                dark
                  ? "text-stone-100 bg-neutral-800 hover:bg-neutral-700"
                  : theme === "sepia"
                  ? "text-[#3D2E1E] bg-[#E5D8C1] hover:bg-[#DBC9AC]"
                  : "text-stone-900 bg-stone-200/80 hover:bg-stone-300/80"
              }`}
            >
              {currentPage} / {totalPages}
            </button>

            <ToolBtn
              onClick={onNext}
              dark={dark}
              title={t.tbNext || "الصفحة التالية"}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </ToolBtn>
          </div>

          {/* Right group: Reading & Annotation tools */}
          <div className="flex items-center gap-1 shrink-0">
            {/* TOC & Bookmarks Drawer */}
            <ToolBtn
              onClick={onToggleToc}
              dark={dark}
              title={t.tocAndBookmarks || t.idxTitle || "الفهرس والعلامات المرجعية"}
              badge={bookmarks.length > 0 ? bookmarks.length : null}
            >
              <List className="w-4 h-4" />
            </ToolBtn>

            {/* Precision Pen & Highlighter Tool */}
            <ToolBtn
              onClick={onTogglePenMode}
              dark={dark}
              title={t.penToolTitle || "قلم الكتابة والتلوين والتظليل"}
              active={penMode}
              badge={!penMode && annotationCount > 0 ? annotationCount : null}
            >
              <PenTool className="w-4 h-4" />
            </ToolBtn>

            {/* Bookmark Current Page */}
            <ToolBtn
              onClick={onToggleBookmark}
              dark={dark}
              title={t.tbBookmark || "حفظ علامة مرجعية"}
              active={isBookmarked}
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-amber-500 fill-amber-500" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </ToolBtn>

            {/* Night Mode & Reading Comfort Button (Restored as original, 0ms instant) */}
            <ToolBtn
              onClick={onToggleComfort}
              dark={dark}
              title={t.tbComfort || "الوضع الليلي وإعدادات الإضاءة"}
              active={theme !== "light"}
            >
              {themeIcon}
            </ToolBtn>

            <ToolBtn
              onClick={onToggleFullscreen}
              dark={dark}
              title={t.tbFullscreen || "ملء الشاشة"}
            >
              <Maximize className="w-4 h-4" />
            </ToolBtn>

            <ToolBtn onClick={onHide} dark={dark} title={t.tbHide || "إخفاء الشريط"}>
              <ChevronDown className="w-4 h-4" />
            </ToolBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  dark,
  title,
  active = false,
  disabled = false,
  badge = null,
  className = "",
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick?.(e);
      }}
      title={title}
      disabled={disabled}
      className={`relative w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-xl flex items-center justify-center transition-colors active:scale-90 shrink-0 disabled:opacity-25 disabled:cursor-default ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : dark
          ? "hover:bg-neutral-800 text-stone-200"
          : "hover:bg-black/5 text-current"
      } ${className}`}
    >
      {children}
      {badge != null && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-mono tabular-nums font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}