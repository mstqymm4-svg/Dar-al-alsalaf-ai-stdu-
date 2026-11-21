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
  FileText,
} from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Explicit, 100% solid opaque reader-theme palettes so that the TOC drawer,
 * comfort panel, and Go-To dialog ALWAYS have sharp, legible contrast
 * regardless of whether the global app theme is light or dark.
 */
const PANEL_THEMES = {
  light: {
    drawerBg: "bg-[#FFFFFF] border-[#E2DDD5] text-[#1C1917]",
    headerBorder: "border-[#E6E1DA]",
    tabBarBg: "bg-[#F5F2EC] border-[#E6E1DA]",
    tabActive: "bg-[#15803D] text-white shadow-sm",
    tabInactive: "text-[#57534E] hover:bg-[#EAE5DC] hover:text-[#1C1917]",
    closeBtn: "text-[#57534E] hover:bg-[#EAE5DC] hover:text-[#1C1917]",
    itemActive: "bg-[#15803D] text-white font-bold shadow-sm",
    itemHover: "text-[#1C1917] hover:bg-[#F3EFE8]",
    itemDisabled: "text-[#78716C] cursor-default",
    itemIconActive: "text-white",
    itemIconIdle: "text-[#15803D]",
    badgeActive: "bg-black/20 text-white",
    badgeIdle: "bg-[#EFECE6] text-[#44403C] border border-[#E2DDD5]",
    mutedText: "text-[#57534E]",
    emptyIcon: "text-[#A8A29E]",
    cardIdle: "bg-[#FAF8F5] border-[#E6E1DA] text-[#1C1917] hover:bg-[#F2EDE4]",
    cardActive: "bg-[#ECFDF5] border-[#15803D] text-[#14532D]",
    gridBtnIdle: "bg-[#F5F2EC] hover:bg-[#EAE5DC] text-[#1C1917] border border-[#E6E1DA]",
    gridBtnActive: "bg-[#15803D] text-white font-bold shadow",
    gridBtnBm: "bg-[#FEF3C7] text-[#B45309] border border-[#F59E0B] font-semibold",
    addBmIdle: "border-[#15803D]/40 bg-[#ECFDF5] text-[#15803D] hover:bg-[#D1FAE5]",
    addBmActive: "border-[#F59E0B]/50 bg-[#FEF3C7] text-[#B45309]",
    inputBg: "bg-[#F5F2EC] border border-[#D6D0C4] text-[#1C1917] placeholder:text-[#78716C]",
    accentIcon: "text-[#15803D]",
    primaryBtn: "bg-[#15803D] hover:bg-[#166534] text-white",
  },
  sepia: {
    drawerBg: "bg-[#F4EAD5] border-[#D8C8A8] text-[#2C1E11]",
    headerBorder: "border-[#DECFAFFE]",
    tabBarBg: "bg-[#EADBC0] border-[#D8C8A8]",
    tabActive: "bg-[#8B5A2B] text-[#FFFDF9] shadow-sm",
    tabInactive: "text-[#5C4328] hover:bg-[#DFCCA9] hover:text-[#2C1E11]",
    closeBtn: "text-[#5C4328] hover:bg-[#DFCCA9] hover:text-[#2C1E11]",
    itemActive: "bg-[#8B5A2B] text-[#FFFDF9] font-bold shadow-sm",
    itemHover: "text-[#2C1E11] hover:bg-[#EADBC0]",
    itemDisabled: "text-[#7A5F43] cursor-default",
    itemIconActive: "text-[#FFFDF9]",
    itemIconIdle: "text-[#8B5A2B]",
    badgeActive: "bg-black/20 text-[#FFFDF9]",
    badgeIdle: "bg-[#E6D5B8] text-[#4A341D] border border-[#D3C09E]",
    mutedText: "text-[#5C4328]",
    emptyIcon: "text-[#9C8265]",
    cardIdle: "bg-[#EFE2C8] border-[#D8C8A8] text-[#2C1E11] hover:bg-[#E6D5B8]",
    cardActive: "bg-[#E5D2B0] border-[#8B5A2B] text-[#2C1E11]",
    gridBtnIdle: "bg-[#EADBC0] hover:bg-[#DFCCA9] text-[#2C1E11] border border-[#D8C8A8]",
    gridBtnActive: "bg-[#8B5A2B] text-[#FFFDF9] font-bold shadow",
    gridBtnBm: "bg-[#FDE68A] text-[#92400E] border border-[#D97706] font-semibold",
    addBmIdle: "border-[#8B5A2B]/50 bg-[#EADBC0] text-[#5C3A1B] hover:bg-[#DFCCA9]",
    addBmActive: "border-[#D97706] bg-[#FDE68A] text-[#92400E]",
    inputBg: "bg-[#EADBC0] border border-[#C8B594] text-[#2C1E11] placeholder:text-[#7A5F43]",
    accentIcon: "text-[#8B5A2B]",
    primaryBtn: "bg-[#8B5A2B] hover:bg-[#70461F] text-[#FFFDF9]",
  },
  dusk: {
    drawerBg: "bg-[#181E29] border-[#2C3548] text-[#F1F5F9]",
    headerBorder: "border-[#2A3346]",
    tabBarBg: "bg-[#111620] border-[#2A3346]",
    tabActive: "bg-[#10B981] text-[#052E16] font-bold shadow-sm",
    tabInactive: "text-[#94A3B8] hover:bg-[#232B3B] hover:text-[#F8FAFC]",
    closeBtn: "text-[#94A3B8] hover:bg-[#232B3B] hover:text-[#F8FAFC]",
    itemActive: "bg-[#10B981] text-[#052E16] font-bold shadow-sm",
    itemHover: "text-[#E2E8F0] hover:bg-[#232B3B]",
    itemDisabled: "text-[#64748B] cursor-default",
    itemIconActive: "text-[#052E16]",
    itemIconIdle: "text-[#34D399]",
    badgeActive: "bg-black/25 text-[#052E16] font-bold",
    badgeIdle: "bg-[#232B3B] text-[#CBD5E1] border border-[#334155]",
    mutedText: "text-[#94A3B8]",
    emptyIcon: "text-[#475569]",
    cardIdle: "bg-[#1E2636] border-[#2C3548] text-[#E2E8F0] hover:bg-[#263044]",
    cardActive: "bg-[#064E3B] border-[#10B981] text-[#ECFDF5]",
    gridBtnIdle: "bg-[#1E2636] hover:bg-[#283246] text-[#E2E8F0] border border-[#2C3548]",
    gridBtnActive: "bg-[#10B981] text-[#052E16] font-bold shadow",
    gridBtnBm: "bg-[#451A03] text-[#FBBF24] border border-[#D97706] font-semibold",
    addBmIdle: "border-[#10B981]/40 bg-[#064E3B]/70 text-[#6EE7B7] hover:bg-[#064E3B]",
    addBmActive: "border-[#F59E0B]/50 bg-[#451A03] text-[#FBBF24]",
    inputBg: "bg-[#111620] border border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]",
    accentIcon: "text-[#34D399]",
    primaryBtn: "bg-[#10B981] hover:bg-[#059669] text-[#052E16]",
  },
  dark: {
    drawerBg: "bg-[#11151E] border-[#262C3A] text-[#F3F4F6]",
    headerBorder: "border-[#222836]",
    tabBarBg: "bg-[#0B0E15] border-[#222836]",
    tabActive: "bg-[#10B981] text-[#052E16] font-bold shadow-sm",
    tabInactive: "text-[#9CA3AF] hover:bg-[#1C2230] hover:text-[#FFFFFF]",
    closeBtn: "text-[#9CA3AF] hover:bg-[#1C2230] hover:text-[#FFFFFF]",
    itemActive: "bg-[#10B981] text-[#052E16] font-bold shadow-sm",
    itemHover: "text-[#E5E7EB] hover:bg-[#1C2230]",
    itemDisabled: "text-[#6B7280] cursor-default",
    itemIconActive: "text-[#052E16]",
    itemIconIdle: "text-[#34D399]",
    badgeActive: "bg-black/25 text-[#052E16] font-bold",
    badgeIdle: "bg-[#1C2230] text-[#D1D5DB] border border-[#2E3646]",
    mutedText: "text-[#9CA3AF]",
    emptyIcon: "text-[#4B5563]",
    cardIdle: "bg-[#171C28] border-[#262C3A] text-[#E5E7EB] hover:bg-[#1F2636]",
    cardActive: "bg-[#064E3B] border-[#10B981] text-[#ECFDF5]",
    gridBtnIdle: "bg-[#171C28] hover:bg-[#22293A] text-[#E5E7EB] border border-[#262C3A]",
    gridBtnActive: "bg-[#10B981] text-[#052E16] font-bold shadow",
    gridBtnBm: "bg-[#451A03] text-[#FBBF24] border border-[#D97706] font-semibold",
    addBmIdle: "border-[#10B981]/40 bg-[#064E3B]/70 text-[#6EE7B7] hover:bg-[#064E3B]",
    addBmActive: "border-[#F59E0B]/50 bg-[#451A03] text-[#FBBF24]",
    inputBg: "bg-[#171C28] border border-[#323A4E] text-[#FFFFFF] placeholder:text-[#6B7280]",
    accentIcon: "text-[#34D399]",
    primaryBtn: "bg-[#10B981] hover:bg-[#059669] text-[#052E16]",
  },
};

function getPanelPalette(theme, darkMode) {
  if (theme && PANEL_THEMES[theme]) return PANEL_THEMES[theme];
  return darkMode ? PANEL_THEMES.dark : PANEL_THEMES.light;
}

function OutlineNode({
  item,
  currentPage,
  onSelect,
  depth = 0,
  pageLabel = "ص",
  palette,
}) {
  const isCurrent = Boolean(item.pageNumber && item.pageNumber === currentPage);
  return (
    <div>
      <button
        type="button"
        onClick={() => item.pageNumber && onSelect(item.pageNumber)}
        style={{ paddingInlineStart: `${12 + depth * 14}px` }}
        className={`w-full text-start py-2.5 pe-3 rounded-xl text-xs transition-all flex items-center justify-between gap-2 ${
          isCurrent
            ? palette.itemActive
            : item.pageNumber
            ? palette.itemHover
            : palette.itemDisabled
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText
            className={`w-3.5 h-3.5 shrink-0 ${
              isCurrent ? palette.itemIconActive : palette.itemIconIdle
            }`}
          />
          <span className="truncate leading-relaxed">{item.title}</span>
        </div>
        {item.pageNumber && (
          <span
            className={`text-[10px] font-mono tabular-nums shrink-0 px-2 py-0.5 rounded-md ${
              isCurrent ? palette.badgeActive : palette.badgeIdle
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
              palette={palette}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fast 3-Tab Navigator Drawer:
 *  - Tab 1: Table of Contents (الفهرس الأصلي للكتاب فقط — أو فارغ إن لم يوجد)
 *  - Tab 2: Saved Bookmarks (الإشارات المرجعية)
 *  - Tab 3: Quick Page Grid (شبكة الصفحات) — capped/windowed for zero lag on huge books
 */
export function TocPanel({
  show,
  isRTL,
  darkMode,
  theme,
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
  const palette = getPanelPalette(theme, darkMode);

  // Filter out any legacy auto-generated outline items so only real book TOC is ever shown
  const realOutline = useMemo(() => {
    if (!Array.isArray(outline)) return [];
    return outline.filter((item) => item && !item.isAuto);
  }, [outline]);

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
      className="fixed inset-0 z-30 bg-black/55 flex"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir={t.dir || "rtl"}
        className={`w-80 max-w-[86vw] h-full border-e flex flex-col shadow-2xl ${
          isRTL ? "ms-0" : "me-0"
        } ${palette.drawerBg}`}
      >
        {/* Header */}
        <div
          className={`p-3.5 border-b ${palette.headerBorder} flex items-center justify-between`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <BookOpen className={`w-4 h-4 ${palette.accentIcon}`} />
            <span>{t.idxTitle || "فهرس الكتاب والتنقل"}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${palette.closeBtn}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Tab Switcher */}
        <div
          className={`grid grid-cols-3 gap-1 p-2 border-b ${palette.tabBarBg} text-xs font-semibold`}
        >
          <button
            type="button"
            onClick={() => setActiveTab("toc")}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "toc" ? palette.tabActive : palette.tabInactive
            }`}
          >
            <List className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.tabToc || "الفهرس"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("bookmarks")}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "bookmarks" ? palette.tabActive : palette.tabInactive
            }`}
          >
            <Bookmark className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.tabBookmarks || "العلامات"}</span>
            {bookmarks.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === "bookmarks"
                    ? "bg-black/25 text-white"
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
              activeTab === "pages" ? palette.tabActive : palette.tabInactive
            }`}
          >
            <Grid className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.tabPages || "الصفحات"}</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === "toc" && (
            <div className="space-y-1">
              {realOutline.length > 0 ? (
                realOutline.map((item, idx) => (
                  <OutlineNode
                    key={idx}
                    item={item}
                    currentPage={currentPage}
                    pageLabel={t.pageNo || "ص"}
                    palette={palette}
                    onSelect={(p) => {
                      onPageClick(p);
                      onClose();
                    }}
                  />
                ))
              ) : (
                <div className="text-center py-10 px-4 space-y-3">
                  <BookOpen className={`w-9 h-9 mx-auto ${palette.emptyIcon}`} />
                  <p className={`text-xs leading-relaxed ${palette.mutedText}`}>
                    {t.noTocFound || "لا يوجد فهرس أصلي مدمج في هذا الكتاب"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("pages")}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${palette.primaryBtn}`}
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
                  isCurrentBookmarked ? palette.addBmActive : palette.addBmIdle
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
                  <Bookmark className={`w-8 h-8 mx-auto ${palette.emptyIcon}`} />
                  <p className={`text-xs font-medium ${palette.mutedText}`}>
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
                          isCurrent ? palette.cardActive : palette.cardIdle
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
                          <span
                            className={`text-[10px] font-mono ms-auto ${palette.mutedText}`}
                          >
                            {totalPages
                              ? `${Math.round((bmPage / totalPages) * 100)}%`
                              : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveBookmark?.(bmPage)}
                          title={t.deleteBookmark || t.delete || "حذف"}
                          className="w-7 h-7 rounded-lg hover:bg-red-500/15 text-red-500 flex items-center justify-center transition-colors"
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
                        ? palette.gridBtnActive
                        : isBm
                        ? palette.gridBtnBm
                        : palette.gridBtnIdle
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
 * Lightweight Reading Comfort & Paper Theme Popover (100% Solid Opaque)
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
  const palette = getPanelPalette(theme, theme === "dark" || theme === "dusk");

  const themes = [
    {
      id: "light",
      label: t.themeLightLabel || "نهاري",
      bg: "bg-white text-stone-900 border-stone-300 shadow-xs",
      sampleBg: "#FFFFFF",
      sampleText: "#1C1917",
      icon: Sun,
    },
    {
      id: "sepia",
      label: t.themeSepiaLabel || t.themeSepia || "ورق دافئ",
      bg: "bg-[#F2E7D2] text-[#3D2E1E] border-[#D5C5A5] shadow-xs",
      sampleBg: "#F2E7D2",
      sampleText: "#3D2E1E",
      icon: BookOpen,
    },
    {
      id: "dusk",
      label: t.themeDuskLabel || "مسائي",
      bg: "bg-[#1A202B] text-[#E2E5EC] border-slate-700 shadow-xs",
      sampleBg: "#1A202B",
      sampleText: "#E2E5EC",
      icon: Moon,
    },
    {
      id: "dark",
      label: t.themeDarkLabel || "ليلي داكن",
      bg: "bg-[#12151C] text-[#EAE6DF] border-white/15 shadow-xs",
      sampleBg: "#12151C",
      sampleText: "#EAE6DF",
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

  if (!show) return null;

  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      dir={t.dir || "rtl"}
      className={`absolute bottom-14 left-1/2 -translate-x-1/2 z-30 w-[340px] max-w-[92vw] border rounded-2xl shadow-2xl p-4 space-y-4 ${palette.drawerBg}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold flex items-center gap-1.5">
          <Sun className={`w-4 h-4 ${palette.accentIcon}`} />
          {t.readingSettingsTitle || "إعدادات القراءة وراحة العين"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className={`w-6 h-6 rounded-lg flex items-center justify-center ${palette.closeBtn}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 1. Theme Swatches */}
      <div className="space-y-1.5">
        <label className={`text-[11px] font-medium ${palette.mutedText}`}>
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
                className={`py-2.5 px-1.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                  th.bg
                } ${
                  active
                    ? "ring-2 ring-emerald-500 scale-[1.03] font-bold"
                    : "opacity-90 hover:opacity-100"
                }`}
              >
                <div className="flex items-center gap-1">
                  <th.icon className="w-3.5 h-3.5" />
                  <span
                    className="text-[10px] font-serif font-bold px-1 rounded"
                    style={{
                      backgroundColor: th.sampleBg,
                      color: th.sampleText,
                    }}
                  >
                    أب
                  </span>
                </div>
                <span className="text-[10px] leading-tight">{th.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Page Fit Mode */}
      <div className="space-y-1.5">
        <label className={`text-[11px] font-medium ${palette.mutedText}`}>
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
                  active ? palette.cardActive + " font-bold" : palette.cardIdle
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
          <span className={`font-medium ${palette.mutedText}`}>
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
          className="w-full accent-emerald-600 cursor-pointer"
        />
      </div>
    </div>
  );
}

/**
 * Floating "Go to page" dialog (100% Solid Opaque).
 */
export function GoToPanel({
  show,
  value,
  setValue,
  totalPages,
  onGo,
  onClose,
  darkMode = false,
  theme,
}) {
  const t = useT();
  const palette = getPanelPalette(theme, darkMode);
  if (!show) return null;
  return (
    <div
      data-viewer-ui
      onClick={(e) => e.stopPropagation()}
      dir={t.dir || "rtl"}
      className={`absolute bottom-14 left-1/2 -translate-x-1/2 z-30 border rounded-2xl shadow-2xl p-3 flex items-center gap-2 ${palette.drawerBg}`}
    >
      <span className={`text-xs font-medium whitespace-nowrap ${palette.mutedText}`}>
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
        className={`w-20 rounded-lg px-2.5 py-1.5 text-xs text-center font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${palette.inputBg}`}
      />
      <button
        type="button"
        onClick={onGo}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${palette.primaryBtn}`}
      >
        {t.goBtn || t.goToBtn}
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`p-1 rounded-lg ${palette.closeBtn}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}