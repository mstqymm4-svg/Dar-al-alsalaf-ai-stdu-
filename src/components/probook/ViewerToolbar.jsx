import {
  ChevronLeft, ChevronRight, Bookmark, BookmarkCheck,
  ZoomIn, ZoomOut, Moon, Sun, List, Maximize, ChevronDown,
  Search, Palette,
} from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Bottom toolbar for the ProBookViewer.
 * Zoom, page nav, TOC, search, bookmark, go-to, reading theme
 * (light → dark → sepia), fullscreen. The reading-progress bar is
 * tappable to jump anywhere in the book.
 */
export default function ViewerToolbar({
  currentPage,
  totalPages,
  zoom,
  theme,
  bookmarks,
  hasOutline,
  onNext,
  onPrev,
  onZoomIn,
  onZoomOut,
  onCycleTheme,
  onToggleBookmark,
  onToggleToc,
  onToggleSearch,
  onToggleGoTo,
  onSeekProgress,
  onToggleFullscreen,
  onHide,
}) {
  const t = useT();
  const dark = theme === "dark";
  const pct = totalPages ? Math.round((currentPage / totalPages) * 100) : 0;

  const themeIcon =
    theme === "dark" ? <Moon className="w-3.5 h-3.5" /> :
    theme === "sepia" ? <Palette className="w-3.5 h-3.5" /> :
    <Sun className="w-3.5 h-3.5" />;
  const themeName =
    theme === "dark" ? t.tbDark : theme === "sepia" ? t.themeSepia : t.tbLight;

  return (
    <div data-viewer-ui className={`shrink-0 border-t backdrop-blur-xl ${dark ? "border-gray-700 bg-gray-800/90" : "border-border bg-card/90"}`}>
      <div dir="ltr" className="flex items-center justify-between px-1.5 py-1.5 gap-0.5">
        <ToolBtn onClick={onZoomOut} dark={dark} title={t.tbZoomOut}>
          <ZoomOut className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn onClick={onZoomIn} dark={dark} title={t.tbZoomIn}>
          <ZoomIn className="w-3.5 h-3.5" />
        </ToolBtn>

        <ToolBtn onClick={onPrev} dark={dark} title={t.tbPrev} disabled={currentPage <= 1}>
          <ChevronLeft className="w-4 h-4" />
        </ToolBtn>
        <button
          onClick={onToggleGoTo}
          title={t.tbGoTo}
          className={`text-[11px] font-mono font-bold px-2 py-1 rounded-md shrink-0 whitespace-nowrap ${dark ? "text-gray-200 bg-gray-700/70" : "text-foreground bg-muted"}`}
        >
          {currentPage}/{totalPages}
        </button>
        <ToolBtn onClick={onNext} dark={dark} title={t.tbNext} disabled={currentPage >= totalPages}>
          <ChevronRight className="w-4 h-4" />
        </ToolBtn>

        {hasOutline && (
          <ToolBtn onClick={onToggleToc} dark={dark} title={t.idxTitle}>
            <List className="w-3.5 h-3.5" />
          </ToolBtn>
        )}
        <ToolBtn onClick={onToggleSearch} dark={dark} title={t.tbSearch}>
          <Search className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn onClick={onToggleBookmark} dark={dark} title={t.tbBookmark} active={bookmarks.includes(currentPage)}>
          {bookmarks.includes(currentPage) ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        </ToolBtn>
        <ToolBtn onClick={onCycleTheme} dark={dark} title={`${t.tbTheme}: ${themeName}`} active={theme !== "light"}>
          {themeIcon}
        </ToolBtn>
        <ToolBtn onClick={onToggleFullscreen} dark={dark} title={t.tbFullscreen} className="hidden sm:flex">
          <Maximize className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn onClick={onHide} dark={dark} title={t.tbHide}>
          <ChevronDown className="w-4 h-4" />
        </ToolBtn>
      </div>

      {/* Tappable reading-progress bar */}
      <div
        dir="ltr"
        className={`h-1.5 cursor-pointer group relative ${dark ? "bg-gray-700" : "bg-muted"}`}
        onClick={(e) => {
          if (!onSeekProgress) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          onSeekProgress(ratio);
        }}
      >
        <div
          className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ToolBtn({ children, onClick, dark, title, active, disabled, className = "" }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 shrink-0 disabled:opacity-25 disabled:cursor-default ${
        active
          ? "bg-primary/15 text-primary"
          : dark
          ? "hover:bg-gray-700 text-gray-200"
          : "hover:bg-muted text-foreground"
      } ${className}`}
    >
      {children}
    </button>
  );
}