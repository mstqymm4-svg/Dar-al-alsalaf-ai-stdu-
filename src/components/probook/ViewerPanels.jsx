import { useState, useMemo } from "react";
import {
  X,
  List,
  BookOpen,
  Sun,
  Moon,
  Bookmark,
  Trash2,
  Grid,
  BookmarkPlus,
  Maximize2,
  MoveHorizontal,
  Sparkles,
  FileText,
} from "lucide-react";
import { useT } from "@/lib/i18n";

function OutlineNode({ item, currentPage, onSelect, depth = 0, pageLabel = "ص" }) {
  const isCurrent = item.pageNumber && item.pageNumber === currentPage;
  return (
    <div>
      <button
        type="button"
        onClick={() => item.pageNumber && onSelect(item.pageNumber)}
        style={{ paddingInlineStart: `${12 + depth * 14}px` }}
        className={`w-full text-start py-2.5 pe-3 rounded-xl text-xs transition-all flex items-center justify-between gap-2 ${
          isCurrent
            ? "bg-primary text-primary-foreground font-bold shadow-sm"
            : item.pageNumber
            ? "hover:bg-muted/80 text-foreground"
            : "text-muted-foreground cursor-default"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText
            className={`w-3.5 h-3.5 shrink-0 ${
              isCurrent ? "text-primary-foreground" : "text-primary/70"
            }`}
          />
          <span className="truncate leading-relaxed">{item.title}</span>
        </div>
        {item.pageNumber && (
          <span
            className={`text-[10px] font-mono tabular-nums shrink-0 px-2 py-0.5 rounded-md ${
              isCurrent
                ? "bg-black/20 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {pageLabel} {item.pageNumber}
          </span>
        )}
      </button>
      {item.items?.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {item.items.map((child, idx) => (
            <OutlineNode
              key={idx}
              item={child}
              currentPage={currentPage}
              onSelect={onSelect}
              depth={depth + 1}
              pageLabel={pageLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fast 3-Tab Navigator Drawer:
 *  - Tab 1: Table of Contents (الفهرس)
 *  - Tab 2: Saved Bookmarks (الإشارات المرجعية)
 *  - Tab 3: Quick Page Grid (شبكة الصفحات) — capped/windowed for zero lag on huge books
 */
export function TocPanel({
  show,
  isRTL,
  darkMode,
  outline = [],
  totalPages,
  currentPage,
  bookmarks = [],
  onClose,
  onPageClick,
  onToggleBookmark,
  onRemoveBookmark,
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState("toc");
  const isCurrentBookmarked = bookmarks.includes(currentPage);

  // Windowed page grid around currentPage if book has > 200 pages
  const pageNumbers = useMemo(() => {
    if (!totalPages || totalPages <= 0) return [];
    if (totalPages <= 240) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const set = new Set([1, 2, 3, totalPages - 1, totalPages]);
    const step = Math.max(1, Math.floor(totalPages / 120));
    for (let p = 1; p <= totalPages; p += step) set.add(p);
    for (
      let p = Math.max(1, currentPage - 30);
      p <= Math.min(totalPages, currentPage + 30);
      p++
    ) {
      set.add(p);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [totalPages, currentPage]);

  if (!show) return null;

  return (
    <div
      data-viewer-ui
      onClick={onClose}
      className="fixed inset-0 z-30 bg-black/45 flex"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir={t.dir || "rtl"}
        className={`w-80 max-w-[86vw] h-full border-e flex flex-col shadow-2xl ${
          isRTL ? "ms-0" : "me-0"
        } ${
          darkMode
            ? "bg-neutral-900 border-neutral-800 text-stone-100"
            : "bg-card border-border text-foreground"
        }`}
      >
        {/* Header */}
        <div className="p-3.5 border-b border-border/60 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            <BookOpen className="w-4 h-4 text-primary" />
            <span>{t.idxTitle || "فهرس الكتاب والتنقل"}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Tab Switcher */}
        <div className="grid grid-cols-3 gap-1 p-2 border-b border-border/60 bg-muted/30 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("toc")}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "toc"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span className="truncate">{t.tabToc || "الفهرس"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("bookmarks")}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "bookmarks"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span className="truncate">{t.tabBookmarks || "العلامات"}</span>
            {bookmarks.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === "bookmarks"
                    ? "bg-black/20 text-white"
                    : "bg-amber-500/20 text-amber-500"
                }`}
              >
                {bookmarks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("pages")}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "pages"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span className="truncate">{t.tabPages || "الصفحات"}</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === "toc" && (
            <div className="space-y-1">
              {outline.length > 0 && outline.some((x) => x.isAuto) && (
                <div className="mb-2.5 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-2 text-[11px] text-primary font-medium">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.smartTocNotice || "فهرس ذكي مستخرج تلقائياً من محتوى الكتاب"}</span>
                </div>
              )}

              {outline.length > 0 ? (
                outline.map((item, idx) => (
                  <OutlineNode
                    key={idx}
                    item={item}
                    currentPage={currentPage}
                    pageLabel={t.pageNo || "ص"}
                    onSelect={(p) => {
                      onPageClick(p);
                      onClose();
                    }}
                  />
                ))
              ) : (
                <div className="text-center py-8 px-3 space-y-3">
                  <BookOpen className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                  <p className="text-xs text-muted-foreground">
                    {t.noTocFound || "لا يوجد فهرس مدمج، يمكنك الانتقال السريع عبر شبكة الصفحات"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("pages")}
                    className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
                  >
                    {t.browsePageGrid || "فتح شبكة الصفحات"}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "bookmarks" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={onToggleBookmark}
                className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  isCurrentBookmarked
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                    : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                }`}
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>
                  {isCurrentBookmarked
                    ? `${t.removeBookmarkCurrent || "إزالة علامة الصفحة الحالية"} (${currentPage})`
                    : `${t.addBookmarkCurrent || "حفظ الصفحة الحالية كعلامة"} (${currentPage})`}
                </span>
              </button>

              {bookmarks.length === 0 ? (
                <div className="text-center py-10 px-4 space-y-2">
                  <Bookmark className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs text-muted-foreground font-medium">
                    {t.noBookmarksYet || "لا توجد إشارات مرجعية محفوظة بعد"}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {bookmarks.map((bmPage) => {
                    const isCurrent = bmPage === currentPage;
                    return (
                      <div
                        key={bmPage}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                          isCurrent
                            ? "border-primary bg-primary/10"
                            : "border-border/60 hover:bg-muted/60"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onPageClick(bmPage);
                            onClose();
                          }}
                          className="flex-1 flex items-center gap-2.5 text-start text-xs font-semibold"
                        >
                          <Bookmark className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                          <span>
                            {t.idxPage || t.pageNo || "ص"} {bmPage}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono ms-auto">
                            {totalPages ? `${Math.round((bmPage / totalPages) * 100)}%` : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveBookmark?.(bmPage)}
                          title={t.deleteBookmark || t.delete || "حذف"}
                          className="w-7 h-7 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "pages" && (
            <div className="grid grid-cols-4 gap-1.5">
              {pageNumbers.map((p) => {
                const isCurrent = p === currentPage;
                const isBm = bookmarks.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      onPageClick(p);
                      onClose();
                    }}
                    className={`relative py-2.5 rounded-lg text-xs font-mono tabular-nums transition-all ${
                      isCurrent
                        ? "bg-primary text-primary-foreground font-bold shadow"
                        : isBm
                        ? "bg-amber-500/15 text-amber-500 border border-amber-500/40 font-semibold"
                        : "bg-muted/60 hover:bg-muted text-foreground"
                    }`}
                  >
                    {p}
                    {isBm && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute top-1 right-1" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight Reading Comfort & Paper Theme Popover
 * - Zero backdrop-blur GPU freeze
 * - Removed View Mode selector per user request ("٢ احذف زر تبديل وضع العرض")
 */
export function ThemeComfortPanel({
  show,
  theme,
  onSelectTheme,
  fitMode,
  onSelectFitMode,
  brightness,
  onChangeBrightness,
  onClose,
}) {
  const t = useT();

  const themes = [
    {
      id: "light",
      label: t.themeLightLabel || "نهاري",
      bg: "bg-white text-stone-900 border-stone-300",
      icon: Sun,
    },
    {
      id: "sepia",
      label: t.themeSepiaLabel || t.themeSepia || "ورق دافئ",
      bg: "bg-[#F4ECD8] text-[#3D2E1E] border-[#D8C8A8]",
      icon: BookOpen,
    },
    {
      id: "dusk",
      label: t.themeDuskLabel || "مسائي",
      bg: "bg-[#1E222A] text-slate-200 border-slate-700",
      icon: Moon,
    },
    {
      id: "dark",
      label: t.themeDarkLabel || "ليلي داكن",
      bg: "bg-[#0F1115] text-neutral-200 border-neutral-800",
      icon: Moon,
    },
  ];

  const fitModes = [
    {
      id: "width",
      label: t.fitWidth || "ملائمة العرض",
      icon: MoveHorizontal,
    },
    {
      id: "page",
      label: t.fitPage || "صفحة كاملة",
      icon: Maximize2,
    },
  ];

  const isDark = theme === "dark" || theme === "dusk";

  if (!show) return null;

  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      dir={t.dir || "rtl"}
      className={`absolute bottom-14 left-1/2 -translate-x-1/2 z-30 w-[330px] max-w-[92vw] border rounded-2xl shadow-2xl p-4 space-y-4 ${
        isDark
          ? "bg-neutral-900 border-neutral-800 text-stone-100"
          : "bg-card border-border text-foreground"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold flex items-center gap-1.5">
          <Sun className="w-4 h-4 text-primary" />
          {t.readingSettingsTitle || "إعدادات القراءة وراحة العين"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-lg hover:bg-muted flex items-center justify-center"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 1. Theme Swatches */}
      <div className="space-y-1.5">
        <label className="text-[11px] text-muted-foreground font-medium">
          {t.paperThemeLabel || "لون الورق والإضاءة"}
        </label>
        <div className="grid grid-cols-4 gap-2">
          {themes.map((th) => {
            const active = theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => onSelectTheme(th.id)}
                className={`py-2 px-1.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1 ${
                  th.bg
                } ${active ? "ring-2 ring-primary scale-[1.02] font-bold" : "opacity-85 hover:opacity-100"}`}
              >
                <th.icon className="w-3.5 h-3.5" />
                <span className="text-[10px] leading-tight">{th.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Page Fit Mode */}
      <div className="space-y-1.5">
        <label className="text-[11px] text-muted-foreground font-medium">
          {t.fitModeLabel || "مقاس الصفحة"}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {fitModes.map((fm) => {
            const active = fitMode === fm.id;
            return (
              <button
                key={fm.id}
                type="button"
                onClick={() => onSelectFitMode(fm.id)}
                className={`py-2 px-3 rounded-xl border text-xs flex items-center justify-center gap-1.5 transition-all ${
                  active
                    ? "border-primary bg-primary/15 text-primary font-bold"
                    : "border-border/70 hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                <fm.icon className="w-3.5 h-3.5" />
                <span>{fm.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Brightness Dimmer */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground font-medium">
            {t.pageBrightness || "سطوع الصفحة"}
          </span>
          <span className="font-mono text-xs font-bold">{brightness}%</span>
        </div>
        <input
          type="range"
          min={55}
          max={100}
          step={5}
          value={Math.min(100, brightness)}
          onChange={(e) => onChangeBrightness(Number(e.target.value))}
          className="w-full accent-primary cursor-pointer"
        />
      </div>
    </div>
  );
}

/**
 * Floating "Go to page" dialog.
 */
export function GoToPanel({ show, value, setValue, totalPages, onGo, onClose }) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      dir={t.dir || "rtl"}
      className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 bg-card border border-border rounded-2xl shadow-2xl p-3 flex items-center gap-2"
    >
      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
        {t.goToPageTitle || "انتقال إلى صفحة:"}
      </span>
      <input
        autoFocus
        type="number"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onGo()}
        placeholder={`1 - ${totalPages}`}
        className="w-20 bg-muted/60 rounded-lg px-2.5 py-1.5 text-xs text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <button
        type="button"
        onClick={onGo}
        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
      >
        {t.goBtn || t.goToBtn}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}