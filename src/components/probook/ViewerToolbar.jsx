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
  MoveUpRight,
  Square,
  Circle,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  X,
  Check,
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
  { id: "fine", value: 2, px: 5, labelKey: "sizeFine", fallback: "رفيع" },
  { id: "medium", value: 3.5, px: 8, labelKey: "sizeMedium", fallback: "متوسط" },
  { id: "bold", value: 6, px: 11, labelKey: "sizeBold", fallback: "عريض" },
  { id: "xbold", value: 9, px: 14, labelKey: "sizeXBold", fallback: "سميك" },
];

/**
 * Organized, clutter-free bottom toolbar & 2-row Floating Pen Dock for ProBookViewer.
 * - Zero crowding: Pen Dock is cleanly organized into two compact rows (Row 1: Tools + Actions, Row 2: Color Palette + Stroke Thickness)
 * - Responsive across all devices (phones, tablets, laptops, large screens) without overflowing
 * - Single-tap Night Mode / Comfort button (0ms instant)
 * - Draggable left/right touch progress scrubber bar
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
      <Moon className="w-4 h-4 text-amber-400 fill-amber-400/20" />
    ) : theme === "sepia" ? (
      <Palette className="w-4 h-4 text-amber-700" />
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

  const activeColorPreview =
    dark && penColor === "#111827" ? "#F9FAFB" : penColor;

  const toolItems = [
    {
      id: "pan",
      icon: Hand,
      label: t.penPan || "تحريك",
      tip: t.penPanTip || "تحريك وتصفح الصفحات",
      activeClass: dark
        ? "bg-slate-700 text-white shadow-sm ring-1 ring-white/25"
        : "bg-stone-800 text-white shadow-sm",
    },
    {
      id: "pen",
      icon: PenTool,
      label: t.penDraw || "قلم",
      tip: t.penDrawTip || "قلم كتابة حر",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "highlighter",
      icon: Highlighter,
      label: t.penHighlight || "تظليل",
      tip: t.penHighlightTip || "قلم تظليل شفاف",
      activeClass: "bg-amber-500 text-white shadow-sm ring-1 ring-amber-400/50",
    },
    {
      id: "line",
      icon: Minus,
      label: t.penLine || "خط",
      tip: t.penLineTip || "رسم خط مستقيم",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "arrow",
      icon: MoveUpRight,
      label: t.penArrow || "سهم",
      tip: t.penArrowTip || "رسم سهم إشارة وتوضيح",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "rect",
      icon: Square,
      label: t.penRect || "مربع",
      tip: t.penRectTip || "رسم إطار مستطيل",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "circle",
      icon: Circle,
      label: t.penCircle || "دائرة",
      tip: t.penCircleTip || "رسم دائرة لتحديد النص",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "text",
      icon: Type,
      label: t.penText || "نص",
      tip: t.penTextTip || "إضافة ملاحظة نصية على الصفحة",
      activeClass: "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50",
    },
    {
      id: "eraser",
      icon: Eraser,
      label: t.penEraser || "ممحاة",
      tip: t.penEraserTip || "ممحاة (مرّر فوق الرسم لمسحه)",
      activeClass: "bg-rose-600 text-white shadow-sm ring-1 ring-rose-400/50",
    },
  ];

  const showColorAndSizeRow = penTool !== "pan" && penTool !== "eraser";

  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className={`relative shrink-0 border-t transition-colors z-20 safe-area-bottom ${
        theme === "dark"
          ? "border-slate-800 bg-[#0D1017] text-stone-100"
          : theme === "dusk"
          ? "border-slate-700 bg-[#141923] text-slate-100"
          : theme === "sepia"
          ? "border-[#CBB994] bg-[#EFE4CE] text-[#3D2E1E]"
          : "border-stone-300 bg-[#FAF8F5] text-stone-900"
      }`}
    >
      {/* Clean 2-Tier Solid Pen & Annotation Dock (100% Opaque, Zero crowding, fits all devices!) */}
      {penMode && (
        <div
          dir="rtl"
          className="absolute bottom-full inset-x-0 pb-2 px-2 sm:px-4 z-30 pointer-events-none flex justify-center"
        >
          <div
            style={{
              backgroundColor:
                theme === "dark"
                  ? "#111622"
                  : theme === "dusk"
                  ? "#181E2C"
                  : theme === "sepia"
                  ? "#F4EAD5"
                  : "#FFFFFF",
            }}
            className={`pointer-events-auto w-full max-w-lg rounded-2xl border-2 p-2.5 space-y-2 transition-colors ${
              theme === "dark"
                ? "bg-[#111622] border-slate-700 text-stone-100 shadow-[0_14px_38px_rgba(0,0,0,0.9)]"
                : theme === "dusk"
                ? "bg-[#181E2C] border-slate-600 text-slate-100 shadow-[0_14px_38px_rgba(0,0,0,0.85)]"
                : theme === "sepia"
                ? "bg-[#F4EAD5] border-[#C4B08B] text-[#3D2E1E] shadow-[0_12px_32px_rgba(61,46,30,0.28)]"
                : "bg-white border-stone-300 text-stone-900 shadow-[0_12px_32px_rgba(15,23,42,0.22)]"
            }`}
          >
            {/* Row 1: Tools Strip (Left/Right Scrollable on very narrow screens) + Pinned Undo/Redo/Clear/Close */}
            <div className="flex items-center justify-between gap-1.5">
              {/* Tools list: shows icon + label ONLY for the active tool on mobile to eliminate crowding */}
              <div
                style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
                className={`flex-1 flex items-center gap-1 p-1 rounded-xl overflow-x-auto scrollbar-none border ${
                  theme === "dark"
                    ? "bg-[#1A2130] border-slate-700"
                    : theme === "dusk"
                    ? "bg-[#222A3A] border-slate-600"
                    : theme === "sepia"
                    ? "bg-[#E6D8BC] border-[#CBB994]"
                    : "bg-stone-100 border-stone-200"
                }`}
              >
                {toolItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = penTool === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectPenTool?.(item.id)}
                      title={item.tip}
                      className={`relative flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                        isActive
                          ? `${item.activeClass} px-2.5`
                          : dark
                          ? "w-8 text-stone-200 hover:bg-slate-700 hover:text-white"
                          : "w-8 text-stone-700 hover:bg-stone-200 hover:text-stone-950"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className={isActive ? "inline" : "hidden lg:inline"}>
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action Buttons (Undo / Redo / Clear / Close) — Always visible & 100% solid */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onUndoAnnotation}
                  disabled={annotationCount === 0}
                  title={t.penUndo || "تراجع"}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30 transition-colors ${
                    dark
                      ? "bg-[#1A2130] hover:bg-slate-700 text-stone-200"
                      : theme === "sepia"
                      ? "bg-[#E6D8BC] hover:bg-[#D9C8A7] text-[#3D2E1E]"
                      : "bg-stone-100 hover:bg-stone-200 text-stone-800"
                  }`}
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onRedoAnnotation}
                  disabled={!canRedo}
                  title={t.penRedo || "إعادة"}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30 transition-colors ${
                    dark
                      ? "bg-[#1A2130] hover:bg-slate-700 text-stone-200"
                      : theme === "sepia"
                      ? "bg-[#E6D8BC] hover:bg-[#D9C8A7] text-[#3D2E1E]"
                      : "bg-stone-100 hover:bg-stone-200 text-stone-800"
                  }`}
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClearAnnotations}
                  disabled={annotationCount === 0}
                  title={t.penClearPage || "مسح جميع رسومات هذه الصفحة"}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 disabled:opacity-30 transition-colors ${
                    dark
                      ? "bg-[#1A2130] hover:bg-rose-950"
                      : theme === "sepia"
                      ? "bg-[#E6D8BC] hover:bg-rose-100"
                      : "bg-stone-100 hover:bg-rose-100"
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onTogglePenMode}
                  title={t.penClose || "إغلاق شريط القلم"}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    dark
                      ? "bg-slate-700 hover:bg-slate-600 text-white"
                      : theme === "sepia"
                      ? "bg-[#D9C8A7] hover:bg-[#CBB994] text-[#3D2E1E]"
                      : "bg-stone-200 hover:bg-stone-300 text-stone-900"
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Row 2: Color Swatches & Stroke Thickness (Shown when drawing/highlighting/noting) */}
            {showColorAndSizeRow && (
              <div
                style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
                className={`flex items-center justify-between gap-2 pt-2 border-t overflow-x-auto scrollbar-none ${
                  dark
                    ? "border-slate-700"
                    : theme === "sepia"
                    ? "border-[#CBB994]"
                    : "border-stone-200"
                }`}
              >
                {/* Ink Colors */}
                <div className="flex items-center gap-1.5 shrink-0 py-0.5 px-0.5">
                  {PEN_COLORS.map((c) => {
                    const isSelected = penColor === c.value;
                    const displayBg =
                      dark && c.value === "#111827" ? "#F9FAFB" : c.value;
                    const checkContrast =
                      dark && c.value === "#111827" ? "#111827" : "#FFFFFF";
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectPenColor?.(c.value)}
                        title={t[c.labelKey] || c.fallback}
                        className={`relative w-6 h-6 rounded-full flex items-center justify-center transition-all shrink-0 ${
                          isSelected
                            ? "scale-110 ring-2 ring-primary ring-offset-1 ring-offset-background shadow"
                            : "hover:scale-105 ring-1 ring-stone-400 dark:ring-slate-500"
                        }`}
                        style={{ backgroundColor: displayBg }}
                      >
                        {isSelected && (
                          <Check
                            className="w-3 h-3 stroke-[3]"
                            style={{ color: checkContrast }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Stroke Thickness Selector */}
                {penTool !== "text" && (
                  <div
                    className={`flex items-center gap-1 p-0.5 rounded-xl shrink-0 border ${
                      theme === "dark"
                        ? "bg-[#1A2130] border-slate-700"
                        : theme === "dusk"
                        ? "bg-[#222A3A] border-slate-600"
                        : theme === "sepia"
                        ? "bg-[#E6D8BC] border-[#CBB994]"
                        : "bg-stone-100 border-stone-200"
                    }`}
                  >
                    {PEN_SIZES.map((sz) => {
                      const isSelected = penSize === sz.value;
                      return (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() => onSelectPenSize?.(sz.value)}
                          title={t[sz.labelKey] || sz.fallback}
                          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                            isSelected
                              ? dark
                                ? "bg-slate-700 ring-1 ring-primary text-white shadow-xs"
                                : "bg-white ring-1 ring-primary text-stone-900 shadow-xs"
                              : dark
                              ? "hover:bg-slate-700"
                              : "hover:bg-stone-200"
                          }`}
                        >
                          <span
                            className="rounded-full transition-transform"
                            style={{
                              width: `${sz.px}px`,
                              height: `${sz.px}px`,
                              backgroundColor: activeColorPreview,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interactive Touch-Draggable Reading Progress Scrubber Bar */}
      <div
        dir="ltr"
        style={{ touchAction: "none" }}
        className={`h-3 cursor-pointer group relative flex items-center ${
          theme === "dark"
            ? "bg-[#181C26]"
            : theme === "dusk"
            ? "bg-[#1E2532]"
            : theme === "sepia"
            ? "bg-[#DFD0B5]"
            : "bg-stone-200/90"
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

      {/* Main Bottom Toolbar Controls Row (Fits all devices cleanly & scrolls smoothly if needed) */}
      <div
        dir="ltr"
        style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
        className="w-full overflow-x-auto scrollbar-none"
      >
        <div className="min-w-max max-w-4xl mx-auto flex items-center justify-between px-2.5 sm:px-4 py-1.5 sm:py-2 gap-2 sm:gap-4">
          {/* Left group: Zoom controls */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
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
              className={`inline-flex text-[11px] font-mono tabular-nums font-bold px-1.5 sm:px-2 py-1 rounded-md transition-colors ${
                dark ? "hover:bg-white/10 text-stone-200" : "hover:bg-stone-200/70 text-stone-700"
              }`}
            >
              {Math.round(zoom * 100)}%
            </button>
            <ToolBtn onClick={onZoomIn} dark={dark} title={t.tbZoomIn || "تكبير"}>
              <ZoomIn className="w-4 h-4" />
            </ToolBtn>
          </div>

          {/* Center group: Page navigation */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
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
              className={`text-xs font-mono tabular-nums font-bold px-2.5 sm:px-3.5 py-1.5 rounded-xl shrink-0 whitespace-nowrap transition-colors ${
                theme === "dark"
                  ? "text-stone-100 bg-[#1A1F2B] hover:bg-[#232A3A] ring-1 ring-white/10"
                  : theme === "dusk"
                  ? "text-slate-100 bg-[#222938] hover:bg-[#2A3346] ring-1 ring-white/10"
                  : theme === "sepia"
                  ? "text-[#3D2E1E] bg-[#E2D4B7] hover:bg-[#D7C6A5]"
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
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
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

            {/* Night Mode & Reading Comfort Button */}
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
          ? "hover:bg-white/10 text-stone-200"
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