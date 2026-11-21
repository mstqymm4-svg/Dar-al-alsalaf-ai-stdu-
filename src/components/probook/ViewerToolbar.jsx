import React, { useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Bookmark,
  List,
  Search,
  Maximize2,
  Minimize2,
  ArrowRight,
  PenTool,
  Highlighter,
  Eraser,
  Type,
  Undo2,
  Redo2,
  Trash2,
  Minus,
  Square,
  Circle,
  Sparkles,
  Check,
  X,
  Volume2,
  Sun,
  Eye,
  EyeOff,
  Hand,
  Underline,
} from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * 1. الشريط العلوي للعارض (Classic Top Header Bar)
 */
export function TopHeaderBar({
  title,
  themeCfg,
  currentPage,
  totalPages,
  isBookmarked,
  onBack,
  onTogglePanel,
  onToggleBookmark,
}) {
  const t = useT();

  return (
    <header
      dir={t.dir || "rtl"}
      className="relative flex items-center justify-between gap-2 px-3 sm:px-5 h-12 border-b z-30 transition-colors select-none shrink-0"
      style={{
        backgroundColor: themeCfg?.toolbar || "#FFFFFF",
        borderColor: themeCfg?.border || "#E2E8F0",
        color: themeCfg?.text || "#0F172A",
      }}
    >
      {/* Back button + Book Title */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
            title={t.backBtn || "رجوع"}
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        )}
        <h1 className="font-bold text-sm sm:text-base truncate leading-tight">
          {title || t.appName || "DAR AL TAWHID"}
        </h1>
      </div>

      {/* Right actions: Page badge + Quick TOC + Bookmark */}
      <div className="flex items-center gap-1.5 shrink-0">
        {totalPages > 0 && (
          <span className="hidden xs:inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-black/[0.04] dark:bg-white/[0.06] tabular-nums">
            {t.pageNo || "ص"} {currentPage} / {totalPages}
          </span>
        )}

        <button
          type="button"
          onClick={() => onTogglePanel?.("toc")}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title={t.tocAndBookmarks || "الفهرس والعلامات"}
        >
          <List className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onToggleBookmark}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
            isBookmarked
              ? "text-amber-500 bg-amber-500/10"
              : "hover:bg-black/5 dark:hover:bg-white/10"
          }`}
          title={t.tbBookmark || "علامة مرجعية"}
        >
          <Bookmark className={`w-4 h-4 ${isBookmarked ? "fill-current" : ""}`} />
        </button>
      </div>
    </header>
  );
}

/**
 * 2. شريط القلم والتدوين الأصلي (Classic Pen & Annotation Dock)
 * مربع لكل أداة مع اسمها مترجم بـ 6 لغات + الألوان + السماكة + تراجع + إعادة + مسح + إغلاق
 */
export function AnnotationDock({
  activeTool,
  onSelectTool,
  activeColor,
  onSelectColor,
  strokeWidth,
  onChangeStrokeWidth,
  onUndo,
  onRedo,
  canRedo = false,
  onClearPage,
  hasAnnotations = false,
  onClose,
  themeCfg,
}) {
  const t = useT();

  const tools = [
    { id: "pan", icon: Hand, label: t.penPan || "تحريك", tip: t.penPanTip },
    { id: "pen", icon: PenTool, label: t.penDraw || "قلم", tip: t.penDrawTip },
    {
      id: "highlighter",
      icon: Highlighter,
      label: t.penHighlight || "تظليل",
      tip: t.penHighlightTip,
    },
    {
      id: "underline",
      icon: Underline,
      label: t.penUnderline || "تسطير",
      tip: t.penUnderlineTip,
    },
    { id: "line", icon: Minus, label: t.penLine || "خط", tip: t.penLineTip },
    { id: "rect", icon: Square, label: t.penRect || "مربع", tip: t.penRectTip },
    {
      id: "circle",
      icon: Circle,
      label: t.penCircle || "دائرة",
      tip: t.penCircleTip,
    },
    { id: "text", icon: Type, label: t.penText || "ملاحظة", tip: t.penTextTip },
    {
      id: "eraser",
      icon: Eraser,
      label: t.penEraser || "ممحاة",
      tip: t.penEraserTip,
    },
    {
      id: "laser",
      icon: Sparkles,
      label: t.penLaser || "ليزر",
      tip: t.penLaserTip,
    },
  ];

  const penColors = [
    { id: "red", value: "#EF4444", label: t.colorRed || "أحمر" },
    { id: "amber", value: "#F59E0B", label: t.colorAmber || "ذهبي" },
    { id: "emerald", value: "#10B981", label: t.colorEmerald || "أخضر" },
    { id: "blue", value: "#3B82F6", label: t.colorBlue || "أزرق" },
    { id: "purple", value: "#8B5CF6", label: t.colorPurple || "بنفسجي" },
    { id: "cyan", value: "#06B6D4", label: t.colorCyan || "سماوي" },
    { id: "ink", value: "#111827", label: t.colorInk || "حبر داكن" },
  ];

  const sizes = [
    { id: "fine", val: 2, dot: "w-1.5 h-1.5", label: t.sizeFine || "رفيع" },
    { id: "med", val: 4, dot: "w-2.5 h-2.5", label: t.sizeMedium || "متوسط" },
    { id: "bold", val: 7, dot: "w-3.5 h-3.5", label: t.sizeBold || "عريض" },
    { id: "xbold", val: 11, dot: "w-4 h-4", label: t.sizeXBold || "سميك" },
  ];

  return (
    <div
      data-viewer-ui
      dir={t.dir || "rtl"}
      onClick={(e) => e.stopPropagation()}
      className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 w-[96vw] max-w-2xl"
    >
      {/* Row 1: Color Swatches & Stroke Sizes + Undo / Redo / Clear / Close */}
      <div
        className="w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl shadow-xl border backdrop-blur-xl"
        style={{
          backgroundColor: themeCfg?.toolbar || "#FFFFFF",
          borderColor: themeCfg?.border || "#E2E8F0",
          color: themeCfg?.text || "#0F172A",
        }}
      >
        {/* Colors */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {penColors.map((c) => {
            const isSelected =
              String(activeColor || "").toUpperCase() === c.value.toUpperCase();
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectColor?.(c.value)}
                title={c.label}
                className={`w-7 h-7 rounded-lg transition-all flex items-center justify-center border ${
                  isSelected
                    ? "ring-2 ring-emerald-600 scale-110 border-white"
                    : "border-black/15 opacity-85 hover:opacity-100"
                }`}
                style={{ backgroundColor: c.value }}
              >
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                )}
              </button>
            );
          })}
        </div>

        {/* Stroke Sizes */}
        <div className="flex items-center gap-1">
          {sizes.map((s) => {
            const active = strokeWidth === s.val;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onChangeStrokeWidth?.(s.val)}
                title={s.label}
                className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-all ${
                  active
                    ? "bg-emerald-700 text-white border-emerald-700"
                    : "border-current/15 hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <span className={`rounded-full bg-current ${s.dot}`} />
              </button>
            );
          })}
        </div>

        {/* Actions: Undo, Redo, Clear Page, Close */}
        <div className="flex items-center gap-1 ms-auto">
          <button
            type="button"
            onClick={onUndo}
            disabled={!hasAnnotations}
            title={t.penUndo || "تراجع"}
            className="h-8 px-2 rounded-lg border border-current/15 flex items-center gap-1 text-[11px] font-bold hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.penUndo || "تراجع"}</span>
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={t.penRedo || "إعادة"}
            className="h-8 px-2 rounded-lg border border-current/15 flex items-center gap-1 text-[11px] font-bold hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.penRedo || "إعادة"}</span>
          </button>

          <button
            type="button"
            onClick={onClearPage}
            disabled={!hasAnnotations}
            title={t.penClearPage || "مسح"}
            className="h-8 px-2 rounded-lg border border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-1 text-[11px] font-bold hover:bg-red-500/20 disabled:opacity-35 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            title={t.penClose || "إغلاق"}
            className="w-8 h-8 rounded-lg border border-current/15 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Tool Square Boxes (Pan, Pen, Highlighter, Underline, Line, Box, Circle, Note, Eraser, Laser) */}
      <div
        className="w-full flex items-center justify-start sm:justify-center gap-1.5 px-2.5 py-2 rounded-2xl shadow-2xl border backdrop-blur-xl overflow-x-auto scrollbar-none"
        style={{
          backgroundColor: themeCfg?.toolbar || "#FFFFFF",
          borderColor: themeCfg?.border || "#E2E8F0",
          color: themeCfg?.text || "#0F172A",
        }}
      >
        {tools.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectTool?.(tool.id)}
              title={tool.tip || tool.label}
              className={`min-w-[54px] h-12 px-2 rounded-xl flex flex-col items-center justify-center gap-1 shrink-0 transition-all border cursor-pointer ${
                active
                  ? "bg-emerald-700 text-white border-emerald-700 shadow-sm scale-[1.02]"
                  : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] font-bold leading-none truncate max-w-[52px]">
                {tool.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 3. الشريط السفلي الأصلي للأزرار + زر واحد فقط للقارئ الذكي
 * (Classic Bottom Control Bar + ONE Smart Reader Button)
 */
export function BottomControlBar({
  currentPage,
  totalPages,
  zoom,
  themeCfg,
  isFullscreen = false,
  isAudioOpen = false,
  onToggleAudioOpen,
  onPrevPage,
  onNextPage,
  onOpenGoTo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onTogglePanel,
  activePanel,
  onToggleBookmark,
  isBookmarked,
  onToggleFullscreen,
  onToggleAnnotation,
  isAnnotationActive,
  audioState,
}) {
  const t = useT();
  const [barHidden, setBarHidden] = useState(false);
  const isPlaying = audioState?.playerState === "playing";

  if (barHidden) {
    return (
      <div className="fixed bottom-3 left-3 z-40">
        <button
          type="button"
          onClick={() => setBarHidden(false)}
          className="h-10 px-3.5 rounded-xl bg-emerald-700 text-white text-xs font-bold shadow-lg flex items-center gap-1.5 hover:bg-emerald-800 transition-colors"
          title={t.tbShow || "إظهار الشريط"}
        >
          <Eye className="w-4 h-4" />
          <span>{t.tbShow || "إظهار الشريط"}</span>
        </button>
      </div>
    );
  }

  return (
    <footer
      data-viewer-ui
      dir={t.dir || "rtl"}
      className="relative border-t z-30 transition-colors select-none shrink-0"
      style={{
        backgroundColor: themeCfg?.toolbar || "#FFFFFF",
        borderColor: themeCfg?.border || "#E2E8F0",
        color: themeCfg?.text || "#0F172A",
      }}
    >
      <div className="max-w-5xl mx-auto px-2 sm:px-4 h-14 flex items-center justify-between gap-1.5 overflow-x-auto scrollbar-none">
        {/* Group 1: Page Navigation (Prev | Page X / Y | Next) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            title={t.tbPrev || "السابقة"}
            className="h-10 px-2.5 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-35 flex items-center gap-1 text-xs font-bold transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
            <span className="hidden md:inline">{t.tbPrev || "السابقة"}</span>
          </button>

          <button
            type="button"
            onClick={onOpenGoTo}
            title={t.tbGoTo || "انتقال إلى صفحة"}
            className="h-10 px-3 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:border-emerald-600 text-xs font-mono font-bold tabular-nums whitespace-nowrap transition-colors"
          >
            {currentPage} / {totalPages || 1}
          </button>

          <button
            type="button"
            onClick={onNextPage}
            disabled={totalPages > 0 && currentPage >= totalPages}
            title={t.tbNext || "التالية"}
            className="h-10 px-2.5 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-35 flex items-center gap-1 text-xs font-bold transition-colors"
          >
            <span className="hidden md:inline">{t.tbNext || "التالية"}</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Group 2: Zoom Controls (- | 100% | +) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onZoomOut}
            title={t.tbZoomOut || "تصغير"}
            className="w-9 h-10 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onResetZoom}
            title={t.tbResetZoom || "إعادة ضبط التكبير (100%)"}
            className="h-10 px-2 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:border-emerald-600 text-xs font-mono font-bold tabular-nums transition-colors"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            onClick={onZoomIn}
            title={t.tbZoomIn || "تكبير"}
            className="w-9 h-10 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Group 3: Classic Viewer Tools + THE SINGLE SMART READER BUTTON */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* ★ الزر الوحيد للقارئ الذكي في شريط الأزرار ★ */}
          <button
            type="button"
            onClick={onToggleAudioOpen}
            title={t.smartReaderTitle || "القارئ الذكي"}
            className={`h-10 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              isAudioOpen || isPlaying
                ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                : "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600/20"
            }`}
          >
            <Volume2
              className={`w-4 h-4 shrink-0 ${isPlaying ? "animate-pulse" : ""}`}
            />
            <span className="whitespace-nowrap">
              {t.smartReaderBtn || "القارئ الذكي"}
            </span>
          </button>

          {/* زر القلم والتدوين الأصلي */}
          <button
            type="button"
            onClick={onToggleAnnotation}
            title={t.penToolTitle || "أداة القلم والتظليل"}
            className={`h-10 px-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              isAnnotationActive
                ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <PenTool className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{t.penDraw || "قلم"}</span>
          </button>

          {/* زر الفهرس */}
          <button
            type="button"
            onClick={() => onTogglePanel?.("toc")}
            title={t.tocAndBookmarks || "الفهرس والعلامات"}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
              activePanel === "toc"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <List className="w-4 h-4" />
          </button>

          {/* زر البحث داخل الكتاب */}
          <button
            type="button"
            onClick={() => onTogglePanel?.("search")}
            title={t.tbSearch || "بحث"}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
              activePanel === "search"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* زر إعدادات القراءة وراحة العين (الوضع الليلي/ورق تراثي/طريقة العرض) */}
          <button
            type="button"
            onClick={() => onTogglePanel?.("settings")}
            title={t.readingSettingsTitle || "إعدادات القراءة وراحة العين"}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
              activePanel === "settings"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <Sun className="w-4 h-4" />
          </button>

          {/* زر العلامة المرجعية */}
          <button
            type="button"
            onClick={onToggleBookmark}
            title={t.tbBookmark || "علامة مرجعية"}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
              isBookmarked
                ? "bg-amber-500 text-white border-amber-500"
                : "border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${isBookmarked ? "fill-current" : ""}`}
            />
          </button>

          {/* زر ملء الشاشة */}
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={t.tbFullscreen || "ملء الشاشة"}
            className="hidden sm:flex w-10 h-10 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 items-center justify-center transition-colors"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* زر إخفاء الشريط */}
          <button
            type="button"
            onClick={() => setBarHidden(true)}
            title={t.tbHide || "إخفاء الشريط"}
            className="w-10 h-10 rounded-xl border border-current/15 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <EyeOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
}