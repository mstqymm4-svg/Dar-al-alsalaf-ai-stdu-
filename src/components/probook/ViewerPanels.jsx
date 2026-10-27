import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  X,
  Search,
  Loader2,
  Bookmark,
  BookmarkCheck,
  Trash2,
  LayoutGrid,
  List,
  ChevronRight,
  ChevronLeft,
  Sun,
  Columns,
  FileText,
  ScrollText,
  Maximize2,
  MoveHorizontal,
} from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Multi-tab side drawer:
 * 1. الفهرس (Table of Contents)
 * 2. العلامات (Saved Bookmarks)
 * 3. الصفحات (Quick Page Grid)
 */
export function TocPanel({
  show,
  isRTL,
  darkMode,
  outline = [],
  totalPages = 0,
  currentPage = 1,
  bookmarks = [],
  initialTab = "toc",
  onClose,
  onPageClick,
  onToggleBookmark,
  onRemoveBookmark,
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState(initialTab);

  const surfaceCls = darkMode
    ? "bg-[#161920] text-stone-100 border-neutral-800"
    : "bg-[#FBF9F5] text-stone-900 border-stone-200";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-viewer-ui
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex bg-black/55 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: isRTL ? 320 : -320 }}
            animate={{ x: 0 }}
            exit={{ x: isRTL ? 320 : -320 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className={`w-80 sm:w-96 max-w-[88%] h-full flex flex-col border-e overflow-hidden shadow-2xl ${surfaceCls}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${
                darkMode ? "border-neutral-800 bg-[#161920]" : "border-stone-200 bg-[#FBF9F5]"
              }`}
            >
              <h3 className="text-sm font-bold flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                <span>{t.idxTitle || "فهرس وأدوات الكتاب"}</span>
              </h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Segmented Tabs */}
            <div
              className={`grid grid-cols-3 gap-1 p-2 border-b shrink-0 ${
                darkMode ? "bg-neutral-900/60 border-neutral-800" : "bg-stone-100/80 border-stone-200"
              }`}
            >
              <button
                onClick={() => setActiveTab("toc")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === "toc"
                    ? darkMode
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "bg-white text-stone-900 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>الفهرس</span>
              </button>

              <button
                onClick={() => setActiveTab("bookmarks")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === "bookmarks"
                    ? darkMode
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "bg-white text-stone-900 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>العلامات ({bookmarks.length})</span>
              </button>

              <button
                onClick={() => setActiveTab("pages")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === "pages"
                    ? darkMode
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "bg-white text-stone-900 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>الصفحات</span>
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-3">
              {activeTab === "toc" && (
                <>
                  {outline.length === 0 ? (
                    <div className="text-center py-8 px-4 space-y-3">
                      <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">
                        {t.idxEmpty || "لا يتوفر فهرس مدمج في هذا الملف"}
                      </p>
                      <button
                        onClick={() => setActiveTab("pages")}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                      >
                        تصفح شبكة الصفحات ({totalPages})
                      </button>
                    </div>
                  ) : (
                    <OutlineTree
                      items={outline}
                      currentPage={currentPage}
                      onPageClick={(p) => {
                        onPageClick(p);
                        onClose();
                      }}
                      darkMode={darkMode}
                    />
                  )}
                </>
              )}

              {activeTab === "bookmarks" && (
                <div className="space-y-3">
                  <button
                    onClick={onToggleBookmark}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                      bookmarks.includes(currentPage)
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : darkMode
                        ? "border-neutral-800 hover:bg-neutral-800/70"
                        : "border-stone-200 hover:bg-stone-100"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {bookmarks.includes(currentPage) ? (
                        <BookmarkCheck className="w-4 h-4 fill-amber-500 text-amber-500" />
                      ) : (
                        <Bookmark className="w-4 h-4" />
                      )}
                      <span>
                        {bookmarks.includes(currentPage)
                          ? `إزالة علامة الصفحة الحالية (${currentPage})`
                          : `حفظ الصفحة الحالية (${currentPage}) في العلامات`}
                      </span>
                    </span>
                  </button>

                  {bookmarks.length === 0 ? (
                    <div className="text-center py-10 px-4">
                      <Bookmark className="w-9 h-9 mx-auto mb-2 text-muted-foreground/35" />
                      <p className="text-xs text-muted-foreground">
                        لم تقم بحفظ أي علامات مرجعية في هذا الكتاب بعد.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {bookmarks.map((pageNum) => (
                        <div
                          key={pageNum}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
                            pageNum === currentPage
                              ? "border-primary/40 bg-primary/10"
                              : darkMode
                              ? "border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800"
                              : "border-stone-200/80 bg-white hover:bg-stone-100/70"
                          }`}
                        >
                          <button
                            onClick={() => {
                              onPageClick(pageNum);
                              onClose();
                            }}
                            className="flex-1 flex items-center gap-2.5 text-start text-xs font-medium"
                          >
                            <Bookmark className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                            <span>الصفحة {pageNum}</span>
                            <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                              ({Math.round((pageNum / Math.max(1, totalPages)) * 100)}%)
                            </span>
                          </button>
                          <button
                            onClick={() => onRemoveBookmark?.(pageNum)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="حذف العلامة"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "pages" && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-2.5 px-1">
                    {t.idxJumpPage || "اختر رقم الصفحة للانتقال المباشر:"}
                  </p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: totalPages || 0 }, (_, i) => i + 1).map((p) => {
                      const isCurrent = p === currentPage;
                      const isBm = bookmarks.includes(p);
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            onPageClick(p);
                            onClose();
                          }}
                          className={`relative aspect-square rounded-lg text-xs font-mono tabular-nums font-medium transition-colors flex items-center justify-center ${
                            isCurrent
                              ? "bg-primary text-primary-foreground font-bold shadow-sm"
                              : darkMode
                              ? "bg-neutral-800/80 hover:bg-neutral-700 text-stone-200"
                              : "bg-stone-200/60 hover:bg-stone-300/80 text-stone-800"
                          }`}
                        >
                          {p}
                          {isBm && (
                            <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Search panel with context snippets, progress bar, and Next/Prev navigation.
 */
export function SearchPanel({
  show,
  darkMode,
  query,
  setQuery,
  onSearch,
  searching,
  searchProgress = 0,
  results = [],
  resultIdx = 0,
  onSelectResult,
  onNextResult,
  onPrevResult,
  onClose,
}) {
  const t = useT();
  const surfaceCls = darkMode
    ? "bg-[#161920] text-stone-100 border-neutral-800"
    : "bg-[#FBF9F5] text-stone-900 border-stone-200";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-viewer-ui
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className={`absolute top-3 left-1/2 -translate-x-1/2 w-96 max-w-[94%] border rounded-2xl shadow-2xl p-3 z-30 ${surfaceCls}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              autoFocus
              placeholder={t.idxSearchPlaceholder || "ابحث عن كلمة أو عبارة في الكتاب..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="flex-1 text-sm h-9"
            />
            <Button
              size="sm"
              onClick={onSearch}
              disabled={searching || !query.trim()}
              className="shrink-0 h-9 px-3"
            >
              {searching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="shrink-0 h-9 w-9"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {searching && (
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>جاري البحث في صفحات الكتاب...</span>
                <span className="font-mono tabular-nums">{searchProgress}%</span>
              </div>
              <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${searchProgress}%` }}
                />
              </div>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="mt-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-muted-foreground font-mono tabular-nums">
                  النتيجة {resultIdx + 1} من {results.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onPrevResult}
                    className="px-2 py-1 rounded hover:bg-muted text-xs font-medium flex items-center gap-1"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    السابق
                  </button>
                  <button
                    onClick={onNextResult}
                    className="px-2 py-1 rounded hover:bg-muted text-xs font-medium text-primary flex items-center gap-1"
                  >
                    التالي
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1 border-t border-border/60 pt-2">
                {results.map((res, idx) => {
                  const pageNum = typeof res === "object" ? res.page : res;
                  const snippet = typeof res === "object" ? res.snippet : "";
                  const active = idx === resultIdx;
                  return (
                    <button
                      key={`${pageNum}-${idx}`}
                      onClick={() => onSelectResult?.(idx)}
                      className={`w-full text-start px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-start justify-between gap-2 ${
                        active
                          ? "bg-primary/15 text-primary font-medium"
                          : "hover:bg-muted/70"
                      }`}
                    >
                      <span className="line-clamp-1 flex-1">
                        {snippet || `تطابق في الصفحة ${pageNum}`}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-muted-foreground shrink-0">
                        ص {pageNum}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Reading Theme, View Mode, Fit Mode & Brightness Comfort Popover
 */
export function ThemeComfortPanel({
  show,
  theme,
  onSelectTheme,
  viewMode,
  onSelectViewMode,
  fitMode,
  onSelectFitMode,
  brightness,
  onChangeBrightness,
  onClose,
}) {
  const darkMode = theme === "dark" || theme === "dusk";
  const surfaceCls = darkMode
    ? "bg-[#161920] text-stone-100 border-neutral-800"
    : "bg-[#FBF9F5] text-stone-900 border-stone-200";

  const themes = [
    { id: "light", label: "نهاري ورقي", swatch: "bg-[#F4F1EA] border-stone-300 text-stone-900" },
    { id: "sepia", label: "قرطاس تراثي", swatch: "bg-[#EAE0CE] border-[#C9B79C] text-[#3D2E1E]" },
    { id: "dusk", label: "مسائي هادئ", swatch: "bg-[#1C2026] border-slate-700 text-slate-100" },
    { id: "dark", label: "ليلي داكن", swatch: "bg-[#0D0F12] border-neutral-700 text-neutral-100" },
  ];

  const viewModes = [
    { id: "scroll", label: "تمرير عمودي", icon: ScrollText },
    { id: "single", label: "صفحة مفردة", icon: FileText },
    { id: "spread", label: "صفحتان", icon: Columns },
  ];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-viewer-ui
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-80 sm:w-96 max-w-[94%] border rounded-2xl shadow-2xl p-4 z-30 space-y-4 ${surfaceCls}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold">إعدادات القراءة وراحة العين</span>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Theme Swatches */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground block">سمة الورق والإضاءة</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {themes.map((th) => (
                <button
                  key={th.id}
                  onClick={() => onSelectTheme(th.id)}
                  className={`px-2.5 py-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center ${
                    th.swatch
                  } ${
                    theme === th.id
                      ? "ring-2 ring-primary font-bold scale-[1.02]"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  {th.label}
                </button>
              ))}
            </div>
          </div>

          {/* View Mode */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground block">نمط عرض الصفحات</span>
            <div className="grid grid-cols-3 gap-1.5">
              {viewModes.map((vm) => {
                const Icon = vm.icon;
                const active = viewMode === vm.id;
                return (
                  <button
                    key={vm.id}
                    onClick={() => onSelectViewMode(vm.id)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? "border-primary bg-primary/15 text-primary font-bold"
                        : darkMode
                        ? "border-neutral-800 hover:bg-neutral-800"
                        : "border-stone-200 hover:bg-stone-100"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{vm.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fit Mode */}
          {viewMode === "scroll" && (
            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground block">ملائمة حجم الصفحة</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onSelectFitMode("width")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl border text-xs font-medium transition-colors ${
                    fitMode === "width"
                      ? "border-primary bg-primary/15 text-primary font-bold"
                      : darkMode
                      ? "border-neutral-800 hover:bg-neutral-800"
                      : "border-stone-200 hover:bg-stone-100"
                  }`}
                >
                  <MoveHorizontal className="w-3.5 h-3.5" />
                  <span>ملائمة العرض</span>
                </button>
                <button
                  onClick={() => onSelectFitMode("page")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl border text-xs font-medium transition-colors ${
                    fitMode === "page"
                      ? "border-primary bg-primary/15 text-primary font-bold"
                      : darkMode
                      ? "border-neutral-800 hover:bg-neutral-800"
                      : "border-stone-200 hover:bg-stone-100"
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>الصفحة كاملة</span>
                </button>
              </div>
            </div>
          )}

          {/* Brightness Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sun className="w-3.5 h-3.5" />
                <span>سطوع الصفحة</span>
              </span>
              <span className="font-mono tabular-nums">{brightness}%</span>
            </div>
            <input
              type="range"
              min="55"
              max="110"
              step="5"
              value={brightness}
              onChange={(e) => onChangeBrightness(Number(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Modal for jumping to a specific page. */
export function GoToPanel({ show, value, setValue, totalPages, onGo, onClose }) {
  const t = useT();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-viewer-ui
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.92 }}
            className="bg-card border border-border rounded-2xl p-4 w-72 max-w-[90%] space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">الانتقال إلى صفحة</span>
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                1 – {totalPages}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                autoFocus
                min="1"
                max={totalPages}
                placeholder={t.idxPageNumber || "رقم الصفحة"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onGo()}
                className="flex-1 text-center font-mono tabular-nums"
              />
              <Button size="sm" onClick={onGo}>
                {t.idxGo || "انتقال"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Recursive outline tree renderer. */
function OutlineTree({ items, currentPage, onPageClick, darkMode, depth = 0 }) {
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => {
        const isCurrent = item.pageNumber && item.pageNumber === currentPage;
        return (
          <div key={i}>
            <button
              onClick={() => item.pageNumber && onPageClick(item.pageNumber)}
              disabled={!item.pageNumber}
              className={`w-full text-start px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between gap-2 ${
                isCurrent
                  ? "bg-primary/15 text-primary font-bold"
                  : item.pageNumber
                  ? darkMode
                    ? "hover:bg-neutral-800 text-stone-200"
                    : "hover:bg-stone-200/60 text-stone-800"
                  : "text-muted-foreground/50 cursor-default"
              }`}
              style={{ paddingInlineStart: `${depth * 14 + 10}px` }}
            >
              <span className="line-clamp-1">{item.title}</span>
              {item.pageNumber && (
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                  {item.pageNumber}
                </span>
              )}
            </button>
            {item.items?.length > 0 && (
              <OutlineTree
                items={item.items}
                currentPage={currentPage}
                onPageClick={onPageClick}
                darkMode={darkMode}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}