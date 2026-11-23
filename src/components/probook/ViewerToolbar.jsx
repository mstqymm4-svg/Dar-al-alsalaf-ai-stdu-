import React, { useState } from "react";
import {
  ArrowRight,
  Search,
  Bookmark,
  BookmarkCheck,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Sun,
  EyeOff,
  Eye,
  BookMarked,
  PenTool,
  Highlighter,
  Eraser,
  Type,
  Undo2,
  Redo2,
  Trash2,
  MousePointer,
  X,
  Volume2,
  Sparkles,
  ScrollText,
  FileText,
} from "lucide-react";
import { useT } from "@/lib/i18n";

const PEN_COLORS = [
  { id: "red", value: "#EF4444", key: "colorRed", fallback: "أحمر" },
  { id: "amber", value: "#F59E0B", key: "colorAmber", fallback: "ذهبي" },
  { id: "emerald", value: "#10B981", key: "colorEmerald", fallback: "أخضر" },
  { id: "blue", value: "#3B82F6", key: "colorBlue", fallback: "أزرق" },
  { id: "purple", value: "#8B5CF6", key: "colorPurple", fallback: "بنفسجي" },
  { id: "pink", value: "#EC4899", key: "colorPink", fallback: "وردي" },
  { id: "cyan", value: "#06B6D4", key: "colorCyan", fallback: "سماوي" },
  { id: "ink", value: "#1E293B", key: "colorInk", fallback: "حبر داكن" },
];

const PEN_STROKE_WIDTHS = [
  { width: 2, key: "sizeFine", fallback: "رفيع", dot: 5 },
  { width: 4, key: "sizeMedium", fallback: "متوسط", dot: 8 },
  { width: 7, key: "sizeBold", fallback: "عريض", dot: 11 },
  { width: 12, key: "sizeXBold", fallback: "سميك جداً", dot: 14 },
];

/**
 * Top Header Bar — Book title, quick actions, and progress indicator
 */
export function TopHeaderBar({
  title,
  themeCfg,
  currentPage,
  totalPages,
  isBookmarked,
  viewMode = "vertical",
  onToggleViewMode,
  onBack,
  onTogglePanel,
  onToggleBookmark,
}) {
  const t = useT() || {};

  const progressPct =
    totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl transition-colors duration-200 select-none"
      style={{
        backgroundColor: themeCfg?.toolbar || "#FFFFFF",
        borderColor: themeCfg?.border || "#E2E8F0",
        color: themeCfg?.text || "#0F172A",
      }}
    >
      <div className="max-w-7xl mx-auto px-2.5 sm:px-5 h-12 sm:h-13 flex items-center justify-between gap-2">
        {/* Right side: Back + TOC + Book Title */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-current/15 hover:bg-current/5 text-xs font-bold transition active:scale-95 shrink-0 cursor-pointer"
            title={t.backToLib || "رجوع"}
          >
            <ArrowRight className="w-4 h-4" />
            <span className="hidden sm:inline">{t.backBtn || "رجوع"}</span>
          </button>

          <button
            type="button"
            onClick={() => onTogglePanel?.("toc")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-600/20 text-xs font-bold transition shrink-0 cursor-pointer"
            title={t.idxTitle || "الفهرس"}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.idxTitle || "الفهرس"}</span>
          </button>

          <h1 className="text-xs sm:text-sm md:text-base font-bold truncate leading-tight">
            {title}
          </h1>
        </div>

        {/* Left side: Quick Actions (View Mode, Search, Bookmark, Eye Comfort) */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {onToggleViewMode && (
            <button
              type="button"
              onClick={onToggleViewMode}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-current/15 hover:bg-current/5 text-[11px] font-bold transition cursor-pointer"
              title={
                viewMode === "vertical"
                  ? t.viewModeScroll || "تمرير عمودي"
                  : t.viewModeSingle || "صفحة مفردة"
              }
            >
              {viewMode === "vertical" ? (
                <ScrollText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              )}
              <span className="hidden md:inline">
                {viewMode === "vertical"
                  ? t.viewModeScroll || "تمرير عمودي"
                  : t.viewModeSingle || "صفحة مفردة"}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onTogglePanel?.("search")}
            className="w-8 h-8 rounded-xl hover:bg-current/10 flex items-center justify-center transition cursor-pointer"
            title={t.tbSearch || "بحث"}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleBookmark}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
              isBookmarked
                ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                : "hover:bg-current/10"
            }`}
            title={t.tbBookmark || "علامة مرجعية"}
          >
            {isBookmarked ? (
              <BookmarkCheck className="w-4 h-4 fill-amber-500 text-amber-500" />
            ) : (
              <Bookmark className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTogglePanel?.("settings")}
            className="w-8 h-8 rounded-xl hover:bg-current/10 flex items-center justify-center transition text-amber-500 cursor-pointer"
            title={t.tbTheme || "إعدادات القراءة"}
          >
            <Sun className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Slim Reading Progress Bar */}
      <div className="h-0.5 w-full bg-current/10 overflow-hidden">
        <div
          className="h-full bg-emerald-600 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </header>
  );
}

/**
 * Floating Pen, Highlighter & Notes Dock (Clean, shape-free annotation bar)
 * Geometric shapes (line, rect, circle, underline) have been completely removed.
 */
export function AnnotationDock({
  isOpen = true,
  activeTool,
  onSelectTool,
  activeColor,
  onSelectColor,
  strokeWidth = 4,
  onChangeStrokeWidth,
  onUndo,
  onRedo,
  canRedo = false,
  hasAnnotations = false,
  onClearPage,
  onClose,
}) {
  const t = useT() || {};
  if (!isOpen) return null;

  // Only essential writing/annotation tools — NO geometric shapes
  const tools = [
    {
      id: "pan",
      icon: MousePointer,
      label: t.penPan || "تحريك",
      tip: t.penPanTip || "تحريك وتصفح الصفحات",
    },
    {
      id: "pen",
      icon: PenTool,
      label: t.penDraw || "قلم",
      tip: t.penDrawTip || "قلم كتابة حر",
    },
    {
      id: "highlighter",
      icon: Highlighter,
      label: t.penHighlight || "تظليل",
      tip: t.penHighlightTip || "قلم تظليل شفاف",
    },
    {
      id: "text",
      icon: Type,
      label: t.penText || "ملاحظة",
      tip: t.penTextTip || "إضافة ملاحظة نصية على الصفحة",
    },
    {
      id: "eraser",
      icon: Eraser,
      label: t.penEraser || "ممحاة",
      tip: t.penEraserTip || "ممحاة (مرّر فوق الرسم لمسحه)",
    },
    {
      id: "laser",
      icon: Sparkles,
      label: t.penLaser || "ليزر",
      tip: t.penLaserTip || "مؤشر ليزر للشرح يختفي تلقائياً",
    },
  ];

  return (
    <div
      dir="rtl"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-18 inset-x-0 z-40 flex justify-center px-2.5 sm:px-4 pointer-events-none select-none"
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-3 py-2 rounded-2xl bg-slate-900/95 text-white border border-emerald-500/30 shadow-2xl backdrop-blur-xl max-w-full overflow-x-auto">
        {/* Writing & Highlighting Tools (Shape-free) */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool?.(tool.id)}
                title={tool.tip}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "hover:bg-white/10 text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Color Swatches */}
        {activeTool !== "pan" && activeTool !== "eraser" && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-xl">
            {PEN_COLORS.map((c) => {
              const selected =
                String(activeColor || "").toLowerCase() === c.value.toLowerCase();
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectColor?.(c.value)}
                  title={t[c.key] || c.fallback}
                  className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                    selected
                      ? "scale-125 ring-2 ring-white ring-offset-1 ring-offset-slate-900"
                      : "opacity-80 hover:opacity-100 hover:scale-110"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              );
            })}
          </div>
        )}

        {/* Stroke Widths */}
        {activeTool !== "pan" && activeTool !== "text" && (
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
            {PEN_STROKE_WIDTHS.map((sw) => {
              const selected = Number(strokeWidth) === sw.width;
              return (
                <button
                  key={sw.width}
                  type="button"
                  onClick={() => onChangeStrokeWidth?.(sw.width)}
                  title={t[sw.key] || sw.fallback}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                    selected
                      ? "bg-emerald-500/25 ring-1 ring-emerald-400"
                      : "hover:bg-white/10"
                  }`}
                >
                  <span
                    className="rounded-full"
                    style={{
                      width: `${sw.dot}px`,
                      height: `${sw.dot}px`,
                      backgroundColor: activeColor || "#10B981",
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* Undo / Redo / Clear Page / Close */}
        <div className="flex items-center gap-1 border-r border-white/15 pr-1.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!hasAnnotations}
            title={t.penUndo || "تراجع"}
            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center disabled:opacity-30 transition cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={t.penRedo || "إعادة"}
            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center disabled:opacity-30 transition cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClearPage}
            disabled={!hasAnnotations}
            title={t.penClearPage || "مسح جميع رسومات هذه الصفحة"}
            className="w-7 h-7 rounded-lg hover:bg-rose-500/20 text-rose-400 flex items-center justify-center disabled:opacity-30 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t.penClose || "إغلاق شريط القلم"}
            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Polished, Responsive Bottom Control Bar — Compatible with all devices (phones, tablets, desktop)
 */
export function BottomControlBar({
  currentPage,
  totalPages,
  zoom = 1,
  themeCfg,
  isFullscreen = false,
  viewMode = "vertical",
  onToggleViewMode,
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
  isBookmarked = false,
  onToggleFullscreen,
  onToggleAnnotation,
  isAnnotationActive = false,
  audioState,
}) {
  const t = useT() || {};
  const [isHidden, setIsHidden] = useState(false);

  const isAudioPlaying = audioState?.playerState === "playing";

  if (isHidden) {
    return (
      <button
        type="button"
        onClick={() => setIsHidden(false)}
        className="fixed bottom-[calc(0.85rem+env(safe-area-inset-bottom,0px))] left-4 z-40 px-3.5 py-2 rounded-full border shadow-xl backdrop-blur-md flex items-center gap-2 text-xs font-bold transition hover:scale-105 active:scale-95 cursor-pointer"
        style={{
          backgroundColor: themeCfg?.toolbar || "#FFFFFF",
          borderColor: themeCfg?.border || "#E2E8F0",
          color: themeCfg?.text || "#0F172A",
        }}
        title={t.tbShow || "إظهار الشريط"}
      >
        <Eye className="w-4 h-4 text-emerald-600" />
        <span className="tabular-nums">
          {currentPage} / {totalPages || 1}
        </span>
      </button>
    );
  }

  return (
    <footer
      dir="rtl"
      className="sticky bottom-0 z-30 border-t px-2 sm:px-4 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] backdrop-blur-xl transition-colors select-none"
      style={{
        backgroundColor: themeCfg?.toolbar || "#FFFFFF",
        borderColor: themeCfg?.border || "#E2E8F0",
        color: themeCfg?.text || "#0F172A",
      }}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
        {/* 1. Page Navigation Group */}
        <div className="flex items-center gap-1 bg-current/5 px-1 py-0.5 rounded-xl shrink-0">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="w-8 h-8 rounded-lg hover:bg-current/10 flex items-center justify-center disabled:opacity-30 transition active:scale-95 cursor-pointer"
            title={t.tbPrev || "الصفحة السابقة"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenGoTo}
            className="px-2.5 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 border border-emerald-600/25 text-xs font-bold tabular-nums transition min-w-[66px] text-center cursor-pointer"
            title={t.tbGoTo || "الانتقال إلى صفحة"}
          >
            {currentPage} <span className="opacity-50">/</span> {totalPages || 1}
          </button>

          <button
            type="button"
            onClick={onNextPage}
            disabled={totalPages > 0 && currentPage >= totalPages}
            className="w-8 h-8 rounded-lg hover:bg-current/10 flex items-center justify-center disabled:opacity-30 transition active:scale-95 cursor-pointer"
            title={t.tbNext || "الصفحة التالية"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* 2. View Mode Toggle (Scroll vs Single Page) */}
        {onToggleViewMode && (
          <button
            type="button"
            onClick={onToggleViewMode}
            className="h-8 px-2.5 rounded-xl bg-current/5 hover:bg-current/10 border border-current/10 flex items-center justify-center gap-1 text-xs font-bold transition shrink-0 cursor-pointer"
            title={
              viewMode === "vertical"
                ? t.viewModeScroll || "تمرير عمودي"
                : t.viewModeSingle || "صفحة مفردة"
            }
          >
            {viewMode === "vertical" ? (
              <ScrollText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="hidden md:inline text-[11px]">
              {viewMode === "vertical"
                ? t.viewModeScroll || "تمرير عمودي"
                : t.viewModeSingle || "صفحة مفردة"}
            </span>
          </button>
        )}

        {/* 3. Zoom Controls */}
        <div className="flex items-center gap-0.5 bg-current/5 px-1 py-0.5 rounded-xl shrink-0">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={zoom <= 0.6}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg hover:bg-current/10 flex items-center justify-center disabled:opacity-30 transition cursor-pointer"
            title={t.tbZoomOut || "تصغير"}
          >
            <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            type="button"
            onClick={onResetZoom}
            className="px-1.5 py-1 rounded-lg hover:bg-current/10 text-[11px] font-bold tabular-nums min-w-[42px] text-center transition cursor-pointer"
            title={t.tbResetZoom || "100%"}
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            onClick={onZoomIn}
            disabled={zoom >= 2.5}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg hover:bg-current/10 flex items-center justify-center disabled:opacity-30 transition cursor-pointer"
            title={t.tbZoomIn || "تكبير"}
          >
            <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* 4. Single Smart Reader Button + Pen Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleAudioOpen}
            className={`h-8 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition shadow-xs cursor-pointer ${
              isAudioOpen || isAudioPlaying
                ? "bg-emerald-600 text-white shadow-emerald-600/25"
                : "bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 border border-emerald-600/25"
            }`}
            title={t.smartReaderTitle || "القارئ الصوتي الذكي"}
          >
            <Volume2 className={`w-4 h-4 ${isAudioPlaying ? "animate-pulse" : ""}`} />
            <span className="text-[11px]">{t.smartReaderBtn || "القارئ الذكي"}</span>
          </button>

          <button
            type="button"
            onClick={onToggleAnnotation}
            className={`h-8 px-2.5 rounded-xl flex items-center justify-center gap-1 text-xs font-bold transition cursor-pointer ${
              isAnnotationActive
                ? "bg-amber-500 text-slate-950 shadow-sm"
                : "bg-current/5 hover:bg-current/10 border border-current/10"
            }`}
            title={t.penToolTitle || "قلم الكتابة والتظليل"}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">{t.penDraw || "قلم"}</span>
          </button>
        </div>

        {/* 5. Secondary Tools: TOC, Search, Eye Comfort, Bookmark, Fullscreen, Hide */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePanel?.("toc")}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
              activePanel === "toc"
                ? "bg-emerald-600 text-white"
                : "hover:bg-current/10"
            }`}
            title={t.idxTitle || "الفهرس"}
          >
            <BookMarked className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onTogglePanel?.("search")}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
              activePanel === "search"
                ? "bg-emerald-600 text-white"
                : "hover:bg-current/10"
            }`}
            title={t.tbSearch || "بحث"}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onTogglePanel?.("settings")}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
              activePanel === "settings"
                ? "bg-emerald-600 text-white"
                : "hover:bg-current/10 text-amber-500"
            }`}
            title={t.tbTheme || "راحة العين"}
          >
            <Sun className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleBookmark}
            className={`w-8 h-8 rounded-xl hidden sm:flex items-center justify-center transition cursor-pointer ${
              isBookmarked
                ? "bg-amber-500/20 text-amber-500"
                : "hover:bg-current/10"
            }`}
            title={t.tbBookmark || "علامة"}
          >
            {isBookmarked ? (
              <BookmarkCheck className="w-4 h-4 fill-amber-500" />
            ) : (
              <Bookmark className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            className="w-8 h-8 rounded-xl hover:bg-current/10 hidden sm:flex items-center justify-center transition cursor-pointer"
            title={t.tbFullscreen || "ملء الشاشة"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsHidden(true)}
            className="w-8 h-8 rounded-xl hover:bg-current/10 flex items-center justify-center opacity-70 hover:opacity-100 transition cursor-pointer"
            title={t.tbHide || "إخفاء الشريط"}
          >
            <EyeOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
}